import { HttpException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { OutboxConsumers } from '../../platform/outbox/outbox.consumers';
import type { OutboxEnvelope } from '../../platform/outbox/outbox.types';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { DemandService } from '../demand/demand.service';
import { OrdersService } from '../orders/orders.service';
import { DOC_LINK, EXTERNAL_ENTITY, PUR_ROLE, SYSTEM_USER } from '../shared/purchase.constants';
import { PurchaseSettingsService } from '../shared/purchase-settings.service';
import { draftRemark, planBuyToOrder, readReleasedSalesOrder } from './buy-to-order.rules';

/** The event Purchase listens to, and the one it answers with so Sales can show the PO on the order line. */
export const SALES_ORDER_RELEASED = 'sales.order.released';
export const BUY_TO_ORDER_HANDLED = 'purchase.buy_to_order.handled';
const HANDLER = 'purchase.draft-po-for-buy-to-order';

const AUTO_DRAFT_OFF = 'Auto-draft for buy-to-order lines is off in Purchase. A PO the buyer raises by hand is not linked to this line.';

/**
 * Purchase listens to `sales.order.released` (EVENTS.md → Purchase listens to). When the setting
 * "Auto-draft a PO for buy-to-order sales lines" is on, it drafts one PO per supplier for the buy-to-order lines,
 * created by the system for the branch's buyer and linked to the sales order (DRAFTED_FROM). It always answers
 * with `purchase.buy_to_order.handled`: which line went on which PO, or why it did not.
 */
@Injectable()
export class BuyToOrderListener implements OnModuleInit {
  private readonly logger = new Logger(BuyToOrderListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumers: OutboxConsumers,
    private readonly orders: OrdersService,
    private readonly demand: DemandService,
    private readonly settings: PurchaseSettingsService,
    private readonly outbox: OutboxWriter,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  onModuleInit(): void {
    this.consumers.listen(SALES_ORDER_RELEASED, HANDLER, (event, tx) => this.onSalesOrderReleased(event, tx));
  }

  async onSalesOrderReleased(event: OutboxEnvelope, tx: Tx): Promise<void> {
    const order = readReleasedSalesOrder(event.payload);
    if (!order) {
      this.logger.warn(`${event.name} ${event.id} has no usable sales order in its payload; ignored`);
      return;
    }
    const wanted = order.lines.filter((l) => l.isBuyToOrder);
    if (wanted.length === 0) return;

    const tenantId = event.tenantId;
    const [setting, branches, warehouses, users] = await Promise.all([
      this.settings.settings(tenantId),
      this.masterData.listBranches(tenantId),
      this.masterData.listWarehouses(tenantId, order.branchCode),
      this.masterData.listUsers(tenantId),
    ]);
    const ctx: RequestContext = {
      tenantId,
      branchCode: order.branchCode,
      correlationId: event.correlationId,
      user: {
        id: SYSTEM_USER.code, tenantId, code: SYSTEM_USER.code, name: SYSTEM_USER.name, email: '', roles: [],
        branchCodes: branches.map((b) => b.code), department: null, jobTitle: null,
      },
    };
    const answer = (lines: { soLineNo: number; itemCode: string; poNo: string | null; problem: string | null }[]) =>
      this.outbox.publish(tx, ctx, [{
        name: BUY_TO_ORDER_HANDLED,
        aggregateType: EXTERNAL_ENTITY.SALES_ORDER,
        aggregateId: event.aggregateId,
        payload: { soNo: order.soNo, autoDraft: setting.autoDraftBuyToOrder, lines: lines.sort((a, b) => a.soLineNo - b.soLineNo) },
      }]);

    if (!setting.autoDraftBuyToOrder) {
      await answer(wanted.map((l) => ({ soLineNo: l.lineNo, itemCode: l.itemCode, poNo: null, problem: AUTO_DRAFT_OFF })));
      return;
    }

    const codes = [...new Set(wanted.map((l) => l.itemCode))];
    const [items, suppliers, contracts, lastPrices, existingLines] = await Promise.all([
      this.masterData.findItems(tenantId, codes),
      this.masterData.listSuppliers(tenantId),
      this.masterData.listContractPrices(tenantId, { itemCodes: codes, onDate: this.clock.today() }),
      this.demand.lastPrices(tenantId, codes),
      tx.purPurchaseOrderLine.findMany({
        where: { tenantId, salesOrderNo: order.soNo, po: { status: { not: 'CANCELLED' } } },
        select: { itemCode: true, po: { select: { docNo: true } } },
      }),
    ]);
    const plan = planBuyToOrder({
      order,
      items,
      suppliers,
      onlyActiveSuppliers: setting.onlyActiveSuppliers,
      contracts,
      lastPrices,
      existing: new Map(existingLines.map((l) => [l.itemCode, l.po.docNo])),
    });

    const warehouseCode = order.warehouseCode ?? warehouses.find((w) => w.code.endsWith('-MAIN'))?.code ?? warehouses[0]?.code ?? '';
    const buyer = users
      .filter((u) => u.isActive && u.roles.includes(PUR_ROLE.BUYER) && u.branchCodes.includes(order.branchCode))
      .sort((a, b) => a.code.localeCompare(b.code))[0];
    const result: { soLineNo: number; itemCode: string; poNo: string | null; problem: string | null }[] = [
      ...plan.alreadyOrdered.map((l) => ({ soLineNo: l.soLineNo, itemCode: l.itemCode, poNo: l.poNo, problem: null })),
      ...plan.skipped.map((l) => ({ soLineNo: l.soLineNo, itemCode: l.itemCode, poNo: null, problem: l.reason })),
    ];

    for (const draft of plan.drafts) {
      let prepared: Awaited<ReturnType<OrdersService['prepareDraft']>>;
      try {
        // Validation only, nothing written yet: a Master Data problem (e.g. the warehouse closed) is reported back
        // to Sales instead of retried forever. Anything failing after this rolls the whole event back and retries.
        prepared = await this.orders.prepareDraft(ctx, {
          supplierCode: draft.supplierCode,
          warehouseCode,
          poTypeCode: 'BTO',
          remarks: draftRemark(order.soNo, draft.lines),
          lines: draft.lines.map((l) => ({ itemCode: l.itemCode, qty: l.qty, unitPrice: l.unitPrice })),
        });
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        const body = err.getResponse() as { message?: string; errors?: { message: string }[] };
        const problem = body.errors?.[0]?.message ?? body.message ?? err.message;
        result.push(...draft.lines.map((l) => ({ soLineNo: l.soLineNo, itemCode: l.itemCode, poNo: null, problem })));
        continue;
      }
      const po = await this.orders.insertDraft(tx, ctx, prepared, {
        sourceType: 'SALES_ORDER',
        sourceNo: order.soNo,
        salesOrderNo: order.soNo,
        customerName: order.customerName ?? undefined,
        buyer: buyer ? { code: buyer.code, name: buyer.name } : undefined,
        message: `Drafted by the system when ${order.soNo} was released`,
      });
      await this.orders.link(tx, ctx, { type: EXTERNAL_ENTITY.SALES_ORDER, id: event.aggregateId, no: order.soNo }, po, DOC_LINK.DRAFTED_FROM);
      result.push(...draft.lines.map((l) => ({ soLineNo: l.soLineNo, itemCode: l.itemCode, poNo: po.docNo, problem: null })));
    }
    await answer(result);
  }
}
