import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SalDelivery, SalDeliveryLine, SalSalesOrder, SalSalesOrderLine } from '@prisma/client';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { CreditService, type CreditOutcome } from '../shared/credit.service';
import { DepositsService } from '../shared/deposits.service';
import { SalesLinkedDocsService } from '../shared/linked-docs.service';
import { CREDIT_DOC, SAL_ENTITY } from '../shared/sales.constants';
import {
  allowedDeliveryActions,
  deliveredPct,
  deliveryStatusLabel,
  deliveryValue,
  DO_STATUSES,
  dueWithin,
  openToDeliver,
  waitingState,
  type DoStatus,
} from './delivery.rules';
import type { DeliveryListQueryDto } from './dto/delivery.dto';

export type OrderWithLines = SalSalesOrder & { lines: SalSalesOrderLine[] };
export type DeliveryWithLines = SalDelivery & { lines: SalDeliveryLine[]; salesOrder: OrderWithLines | null };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));

/** Reading delivery orders: the waiting list and DO list (S15) and one DO to confirm (S16). */
@Injectable()
export class DeliveriesQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly attachments: AttachmentsService,
    private readonly permissions: PermissionRegistry,
    private readonly credit: CreditService,
    private readonly linked: SalesLinkedDocsService,
    private readonly deposits: DepositsService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
  ) {}

  async load(tenantId: string, id: string): Promise<DeliveryWithLines> {
    const row = await this.prisma.salDelivery.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { lineNo: 'asc' } }, salesOrder: { include: { lines: { orderBy: { lineNo: 'asc' } } } } },
    });
    if (!row) throw new NotFoundError('Delivery order');
    return row;
  }

  /** Released proformas that Finance has not seen paid yet, per sales order: they hold delivery (rule 9). */
  async unpaidProformas(tenantId: string, orderIds: string[]) {
    const unpaid = await this.deposits.unpaidForOrders(tenantId, orderIds);
    return new Map([...unpaid].map(([orderId, p]) => [orderId, { docNo: p.proforma.docNo, amount: toMoney(p.proforma.amount.sub(p.received)) }]));
  }

  /** Quantities on draft cancel orders, per sales order line: a balance being cancelled is not waiting to be delivered. */
  private async draftCancelQty(tenantId: string, soLineIds: string[]) {
    const rows = await this.prisma.salCancelOrderLine.findMany({
      where: { tenantId, soLineId: { in: soLineIds }, cancelOrder: { status: 'DRAFT' } },
      select: { soLineId: true, cancelQty: true },
    });
    const map = new Map<string, Prisma.Decimal>();
    for (const r of rows) map.set(r.soLineId!, (map.get(r.soLineId!) ?? dec(0)).add(r.cancelQty));
    return map;
  }

  /** The DO lines joined with their order lines, with the balance as it stands now (draft) or at confirm. */
  linesOf(d: DeliveryWithLines) {
    return d.lines.map((l) => {
      const so = d.salesOrder?.lines.find((x) => x.id === l.soLineId) ?? null;
      const confirmed = d.status === 'CONFIRMED' || d.isMigrated;
      const before = confirmed || !so ? l.deliveredBeforeQty : so.deliveredQty;
      const balance = confirmed || !so ? l.orderedQty.sub(l.deliveredBeforeQty) : openToDeliver(so);
      return { line: l, so, before, balance: balance.gt(0) ? balance : dec(0) };
    });
  }

  /** The credit check for a draft DO: what is delivered now, against the customer's limits (policy "Delivery order"). */
  async liveCredit(ctx: RequestContext, d: DeliveryWithLines): Promise<CreditOutcome | null> {
    if (d.status !== 'DRAFT' || d.isMigrated || !d.salesOrder) return null;
    const customer = await this.masterData.findCustomer(ctx.tenantId, d.customerCode);
    if (!customer) return null;
    const value = deliveryValue(this.linesOf(d).filter((x) => x.so).map((x) => ({ qty: x.line.qty, unitPrice: x.so!.unitPrice, discountPct: x.so!.discountPct, taxRate: x.so!.taxRate })));
    return this.credit.check(ctx.tenantId, { customer, docType: CREDIT_DOC.DELIVERY, thisDocument: toMoney(value), branchCode: d.branchCode, excludeOrderId: d.salesOrder.id });
  }

  actions(ctx: RequestContext, d: DeliveryWithLines, credit: CreditOutcome | null, approvalPending: boolean) {
    const has = (p: string) => this.permissions.has(ctx.user.roles, p);
    return allowedDeliveryActions({
      status: d.status as DoStatus,
      isMigrated: d.isMigrated,
      approvalPending,
      creditNeedsApproval: credit ? credit.check.action === 'APPROVAL' : false,
      approved: Boolean(d.approvedAt),
      canEdit: has(P.DELIVERY_EDIT),
      canConfirm: has(P.DELIVERY_CONFIRM),
    });
  }

  // ── Waiting list and KPIs (S15) ───────────────────────────────────────────

  async overview(ctx: RequestContext) {
    const today = this.clock.today();
    const orders = await this.prisma.salSalesOrder.findMany({
      where: { tenantId: ctx.tenantId, isMigrated: false, status: { in: ['RELEASED', 'PARTIAL'] } },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: [{ deliveryWantedBy: 'asc' }, { docNo: 'asc' }],
    });
    const lineIds = orders.flatMap((o) => o.lines.map((l) => l.id));
    const codes = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.itemCode)))];
    const [cancelling, items, stock, proformas, drafts, month] = await Promise.all([
      this.draftCancelQty(ctx.tenantId, lineIds),
      this.masterData.findItems(ctx.tenantId, codes),
      this.stock.listStock(ctx.tenantId, codes),
      this.unpaidProformas(ctx.tenantId, orders.map((o) => o.id)),
      this.prisma.salDelivery.findMany({ where: { tenantId: ctx.tenantId, status: 'DRAFT', isMigrated: false }, select: { id: true, docNo: true, salesOrderId: true }, orderBy: { docNo: 'asc' } }),
      this.prisma.salDelivery.findMany({
        where: { tenantId: ctx.tenantId, status: 'CONFIRMED', isMigrated: false, docDate: { gte: new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`) } },
        include: { lines: true },
      }),
    ]);

    const rows = orders.flatMap((o) =>
      o.lines
        .map((l) => ({ l, balance: openToDeliver(l).sub(cancelling.get(l.id) ?? dec(0)) }))
        .filter((x) => x.balance.gt(0))
        .map(({ l, balance }) => {
          const onHand = sum(stock.filter((s) => s.itemCode === l.itemCode && s.warehouseCode === o.warehouseCode).map((s) => dec(s.onHand)));
          const proforma = proformas.get(o.id) ?? null;
          const draft = drafts.find((d) => d.salesOrderId === o.id) ?? null;
          return {
            orderId: o.id,
            orderNo: o.docNo,
            customerName: o.customerName,
            lineNo: l.lineNo,
            itemCode: l.itemCode,
            itemName: l.itemName,
            uomCode: l.uomCode,
            balance: toQty(balance),
            wantedBy: iso(o.deliveryWantedBy),
            onHand: toQty(onHand),
            isBuyToOrder: l.isBuyToOrder,
            purchaseOrderNo: l.purchaseOrderNo,
            state: waitingState({ isBuyToOrder: l.isBuyToOrder, isStock: items.find((i) => i.code === l.itemCode)?.type === 'STOCK', balance, onHand, unpaidProformaNo: proforma?.docNo ?? null }),
            proforma,
            draft: draft ? { id: draft.id, docNo: draft.docNo } : null,
            balanceDec: balance,
          };
        }),
    );
    const waitingOrders = [...new Set(rows.map((r) => r.orderNo))];
    const due = [...new Set(rows.filter((r) => dueWithin(r.wantedBy, today, 14)).map((r) => r.orderNo))];
    const monthUnits = sum(month.flatMap((d) => d.lines.map((l) => l.qty)));

    return {
      kpis: {
        waiting: { orders: waitingOrders.length, units: toQty(sum(rows.map((r) => r.balanceDec))) },
        dueSoon: { orders: due.length, orderNos: due },
        drafts: { count: drafts.length, docNos: drafts.map((d) => d.docNo) },
        deliveredThisMonth: { units: toQty(monthUnits), deliveries: month.length },
      },
      waiting: rows.map(({ balanceDec: _b, ...r }) => r),
      inventoryConnected: this.stock.connected,
    };
  }

  // ── Delivery order list (S15) ─────────────────────────────────────────────

  async list(ctx: RequestContext, query: DeliveryListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', customer: 'customerName' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const base: Prisma.SalDeliveryWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.customer?.trim() && { customerName: { contains: query.customer.trim() } }),
      ...(q && { OR: [{ docNo: { contains: q } }, { customerName: { contains: q } }, { salesOrderNo: { contains: q } }, { consignmentNote: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, DO_STATUSES);
    const where: Prisma.SalDeliveryWhereInput = { ...base, ...(status && { status }) };
    const [rows, total, grouped] = await Promise.all([
      this.prisma.salDelivery.findMany({ where, include: { lines: true }, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.salDelivery.count({ where }),
      this.prisma.salDelivery.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    return toListResponse(
      rows.map((d) => ({
        id: d.id,
        docNo: d.docNo,
        docDate: iso(d.docDate),
        customerName: d.customerName,
        salesOrderId: d.salesOrderId,
        salesOrderNo: d.salesOrderNo,
        qty: toQty(sum(d.lines.map((l) => l.qty))),
        vehicle: d.vehicle,
        driver: d.driver,
        consignmentNote: d.consignmentNote,
        status: d.status,
        statusLabel: deliveryStatusLabel(d.status as DoStatus),
        isMigrated: d.isMigrated,
        version: d.version,
      })),
      total,
      query,
      buildStatusCounts(grouped, DO_STATUSES),
    );
  }

  // ── One delivery order (S16) ──────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const d = await this.load(ctx.tenantId, id);
    const order = d.salesOrder;
    const codes = d.lines.map((l) => l.itemCode);
    const [credit, activity, links, approvals, files, stock, proformas] = await Promise.all([
      this.liveCredit(ctx, d),
      this.activity.listFor(ctx.tenantId, SAL_ENTITY.DELIVERY, d.id),
      this.linked.forDocument(ctx.tenantId, SAL_ENTITY.DELIVERY, d.id),
      this.approvals.listForEntity(ctx.tenantId, SAL_ENTITY.DELIVERY, d.id),
      this.attachments.listFor(ctx.tenantId, SAL_ENTITY.DELIVERY, d.id),
      this.stock.listStock(ctx.tenantId, codes),
      order && d.status === 'DRAFT' ? this.unpaidProformas(ctx.tenantId, [order.id]) : Promise.resolve(new Map<string, { docNo: string; amount: string }>()),
    ]);
    const latest = approvals[0] ?? null;
    const decidedStep = latest?.steps.find((s) => s.decidedAt);
    const waitingStep = latest?.status === 'PENDING' ? latest.steps.find((s) => s.status === 'WAITING') : null;
    const lines = this.linesOf(d);

    // Order progress after this DO, over all the order's lines (not only the ones on this DO).
    const orderLines = order?.lines ?? [];
    const orderedTotal = sum(orderLines.map((l) => l.orderedQty));
    const deliveredAfter =
      d.status === 'CONFIRMED' ? sum(orderLines.map((l) => l.deliveredQty)) : sum(orderLines.map((l) => l.deliveredQty)).add(sum(d.lines.map((l) => l.qty)));
    const hold = order ? (proformas.get(order.id) ?? null) : null;

    return {
      id: d.id,
      docNo: d.docNo,
      docDate: iso(d.docDate),
      status: d.status,
      statusLabel: deliveryStatusLabel(d.status as DoStatus),
      isMigrated: d.isMigrated,
      version: d.version,
      customer: { code: d.customerCode, name: d.customerName },
      branchCode: d.branchCode,
      warehouseCode: d.warehouseCode,
      vehicle: d.vehicle,
      driver: d.driver,
      consignmentNote: d.consignmentNote,
      deliverTo: d.deliverTo,
      receiver: d.receiver,
      warehouseNote: d.warehouseNote,
      order: order
        ? {
            id: order.id,
            no: order.docNo,
            status: order.status,
            wantedBy: iso(order.deliveryWantedBy),
            agentName: order.agentName,
            ordered: toQty(orderedTotal),
            deliveredAfter: toQty(deliveredAfter),
            pct: deliveredPct(deliveredAfter, orderedTotal),
            leftAfter: toQty(sum(lines.map((x) => x.balance.sub(x.line.qty)))),
          }
        : { id: null, no: d.salesOrderNo, status: null, wantedBy: null, agentName: null, ordered: '0', deliveredAfter: '0', pct: 0, leftAfter: '0' },
      lines: lines.map(({ line: l, before, balance }) => ({
        id: l.id,
        lineNo: l.lineNo,
        itemCode: l.itemCode,
        itemName: l.itemName,
        uomCode: l.uomCode,
        orderedQty: toQty(l.orderedQty),
        deliveredBeforeQty: toQty(before),
        balanceQty: toQty(balance),
        qty: toQty(l.qty),
        leftAfterQty: toQty(balance.sub(l.qty).gt(0) ? balance.sub(l.qty) : dec(0)),
        inStock: toQty(sum(stock.filter((s) => s.itemCode === l.itemCode && s.warehouseCode === d.warehouseCode).map((s) => dec(s.onHand)))),
      })),
      depositHold: hold ? { proformaNo: hold.docNo, amount: hold.amount } : null,
      credit: {
        result: credit?.check.result ?? d.creditResult,
        snapshot: credit?.snapshot ?? d.creditSnapshot,
        live: Boolean(credit),
        warning: credit && credit.check.action === 'WARN' ? credit.snapshot : null,
        needsApproval: credit ? credit.check.action === 'APPROVAL' && !d.approvedAt : false,
        blocked: credit ? credit.check.action === 'BLOCK' : false,
        approverRole: credit?.approverRole ?? null,
      },
      approval: {
        state: !latest ? 'NONE' : latest.status === 'PENDING' ? 'PENDING' : latest.status === 'APPROVED' ? 'APPROVED' : latest.status === 'REJECTED' ? 'REJECTED' : 'NONE',
        reason: latest?.reason ?? null,
        waitingFor: waitingStep ? (waitingStep.approverName ?? waitingStep.approverRole) : null,
        decidedBy: decidedStep?.decidedByName ?? null,
        comment: decidedStep?.comment ?? null,
      },
      attachments: files.map((f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, kind: f.kind, downloadUrl: f.downloadUrl })),
      inventoryConnected: this.stock.connected,
      confirmedAt: d.confirmedAt?.toISOString() ?? null,
      confirmedByName: d.confirmedByName,
      links,
      activity,
      allowedActions: this.actions(ctx, d, credit, latest?.status === 'PENDING'),
    };
  }
}
