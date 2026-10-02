import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurCancelOrder, PurCancelOrderLine } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty } from '../../platform/http/decimal';
import { BusinessRuleError, NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { orderStatusLabel, type OrderStatus } from '../orders/order.rules';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { openQty } from '../receipts/receipt.rules';
import { LinkedDocsService } from '../shared/linked-docs.service';
import { PUR_ENTITY } from '../shared/purchase.constants';
import { qtyWithUnit } from '../shared/text.rules';
import { documentTotals, lineTotals } from '../shared/totals.rules';
import type { CancelOrderListQueryDto } from './dto/cancel-order.dto';
import { allowedCancelOrderActions, CANCEL_REASONS, type CancelOrderStatus } from './cancel-order.rules';

export const CANCEL_ORDER_STATUSES = ['DRAFT', 'RELEASED'] as const;
export const CANCELLABLE_PO_STATUSES = ['RELEASED', 'PARTIAL'] as const;
export type CancelOrderWithLines = PurCancelOrder & { lines: PurCancelOrderLine[] };

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** "10 packs", or "3 items" when the lines use different units. */
const quantityText = (lines: { qty: Prisma.Decimal; uomCode: string }[]) =>
  new Set(lines.map((l) => l.uomCode)).size === 1 ? qtyWithUnit(sum(lines.map((l) => l.qty)), lines[0]!.uomCode) : `${lines.length} items`;

/** Reading cancellations: the list and orders with an open balance (P12), one cancellation (P13). */
@Injectable()
export class CancelOrdersQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly attachments: AttachmentsService,
    private readonly linkedDocs: LinkedDocsService,
    private readonly permissions: PermissionRegistry,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async load(tenantId: string, id: string): Promise<CancelOrderWithLines> {
    const row = await this.prisma.purCancelOrder.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Cancel order');
    return row;
  }

  actions(ctx: RequestContext, row: Pick<PurCancelOrder, 'status' | 'isMigrated'>) {
    return allowedCancelOrderActions({
      status: row.status as CancelOrderStatus,
      isMigrated: row.isMigrated,
      canEdit: this.permissions.has(ctx.user.roles, P.CANCEL_ORDER_EDIT),
      canRelease: this.permissions.has(ctx.user.roles, P.CANCEL_ORDER_RELEASE),
    });
  }

  /** A PO can have its balance cancelled while released or partly received, with something open. */
  async loadCancellablePo(ctx: RequestContext, poId: string, ignoreDraftId?: string) {
    const po = await this.prisma.purPurchaseOrder.findFirst({
      where: { id: poId, tenantId: ctx.tenantId },
      include: { lines: { orderBy: { lineNo: 'asc' } }, cancelOrders: { where: { status: 'DRAFT' }, select: { id: true, docNo: true } } },
    });
    if (!po) throw new NotFoundError('Purchase order');
    if (!ctx.user.branchCodes.includes(po.branchCode)) throw new BusinessRuleError('BRANCH_NOT_ALLOWED', `${po.docNo} belongs to a branch you do not work in.`);
    if (!(CANCELLABLE_PO_STATUSES as readonly string[]).includes(po.status)) {
      const label = orderStatusLabel(po.status as OrderStatus, { balanceCancelled: po.balanceCancelled, approved: false }).toLowerCase();
      throw new BusinessRuleError('NOT_CANCELLABLE', `${po.docNo} is ${label}. Only released or partly received orders have a balance to cancel.`);
    }
    if (!po.lines.some((l) => openQty(l).gt(0))) throw new BusinessRuleError('NOTHING_OPEN', `Everything on ${po.docNo} has been received or cancelled.`);
    const draft = po.cancelOrders.find((c) => c.id !== ignoreDraftId);
    if (draft) throw new BusinessRuleError('DRAFT_EXISTS', `${draft.docNo} is already cancelling the balance of ${po.docNo}. Continue that one instead.`);
    return po;
  }

  // ── List (P12) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: CancelOrderListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', totalValue: 'totalValue' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const base: Prisma.PurCancelOrderWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.supplier?.trim() && { supplierName: { contains: query.supplier.trim() } }),
      ...(query.poNo?.trim() && { poNo: { contains: query.poNo.trim() } }),
      ...(query.reason && { reason: query.reason }),
      ...(q && { OR: [{ docNo: { contains: q } }, { poNo: { contains: q } }, { supplierName: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, CANCEL_ORDER_STATUSES);
    const where: Prisma.PurCancelOrderWhereInput = { ...base, ...(status && { status }) };
    const [rows, total, grouped, reasons] = await Promise.all([
      this.prisma.purCancelOrder.findMany({ where, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.purCancelOrder.count({ where }),
      this.prisma.purCancelOrder.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.purCancelOrder.findMany({ where: { tenantId: ctx.tenantId }, distinct: ['reason'], select: { reason: true } }),
    ]);
    return {
      ...toListResponse(
        rows.map((r) => ({
          id: r.id,
          docNo: r.docNo,
          docDate: isoDate(r.docDate),
          poId: r.poId,
          poNo: r.poNo,
          supplierName: r.supplierName,
          summary: r.summary,
          totalValue: toMoney(r.totalValue),
          reason: r.reason,
          status: r.status,
          isMigrated: r.isMigrated,
        })),
        total,
        query,
        buildStatusCounts(grouped, CANCEL_ORDER_STATUSES),
      ),
      reasons: [...new Set([...CANCEL_REASONS, ...reasons.map((r) => r.reason)])],
    };
  }

  /** "Orders with an open balance": released or partial, past or within three days of the expected date, not being received. */
  async openBalances(ctx: RequestContext) {
    const today = this.clock.today();
    const orders = await this.prisma.purPurchaseOrder.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: [...CANCELLABLE_PO_STATUSES] },
        branchCode: { in: ctx.user.branchCodes },
        expectedDate: { lte: new Date(`${addDays(today, 3)}T00:00:00.000Z`) },
        // Goods being counted right now are arriving, not a balance to cancel.
        receipts: { none: { status: 'DRAFT' } },
      },
      include: { lines: true, cancelOrders: { where: { status: 'DRAFT' }, select: { id: true, docNo: true } } },
      orderBy: [{ expectedDate: 'asc' }, { docNo: 'asc' }],
    });
    const canEdit = this.permissions.has(ctx.user.roles, P.CANCEL_ORDER_EDIT);
    return {
      items: orders
        .map((po) => {
          const open = po.lines.map((l) => ({ qty: openQty(l), uomCode: l.uomCode })).filter((l) => l.qty.gt(0));
          if (!open.length) return null;
          const draft = po.cancelOrders[0] ?? null;
          const expected = isoDate(po.expectedDate);
          return {
            poId: po.id,
            poNo: po.docNo,
            isMigrated: po.isMigrated,
            supplierName: po.supplierName,
            openText: quantityText(open),
            expected,
            late: Boolean(expected && expected < today),
            supplierSays: po.supplierSays ?? (po.promisedDate ? `Coming ${po.promisedDate.getUTCDate()} ${new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(po.promisedDate)}` : null),
            cancelOrder: draft,
            // The supplier promised a date: receive it when it comes; otherwise the balance can be cancelled.
            action: draft ? null : po.promisedDate ? ('RECEIVE' as const) : canEdit ? ('CANCEL' as const) : null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    };
  }

  // ── New cancellation for a PO ─────────────────────────────────────────────

  /** Every order whose balance can be cancelled now (for the purchase order picker). */
  async cancellableOrders(ctx: RequestContext) {
    const orders = await this.prisma.purPurchaseOrder.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: [...CANCELLABLE_PO_STATUSES] },
        branchCode: { in: ctx.user.branchCodes },
        cancelOrders: { none: { status: 'DRAFT' } },
      },
      include: { lines: true },
      orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }],
    });
    return {
      items: orders
        .map((po) => {
          const open = po.lines.map((l) => ({ qty: openQty(l), uomCode: l.uomCode })).filter((l) => l.qty.gt(0));
          return open.length ? { id: po.id, docNo: po.docNo, isMigrated: po.isMigrated, supplierName: po.supplierName, openText: quantityText(open) } : null;
        })
        .filter((o): o is NonNullable<typeof o> => o !== null),
    };
  }

  async template(ctx: RequestContext, poId: string) {
    const po = await this.loadCancellablePo(ctx, poId);
    return {
      po: this.poSummary(po),
      docDate: this.clock.today(),
      askedBy: { code: ctx.user.code, name: ctx.user.name },
      reasons: CANCEL_REASONS,
      lines: po.lines
        .filter((l) => openQty(l).gt(0))
        .map((l) => ({
          poLineId: l.id,
          itemCode: l.itemCode,
          itemName: l.itemName,
          uomCode: l.uomCode,
          taxRate: l.taxRate.toFixed(4),
          orderedQty: toQty(l.orderedQty),
          receivedQty: toQty(l.receivedQty),
          openQty: toQty(openQty(l)),
          unitPrice: toPrice(l.unitPrice),
        })),
      supplier: await this.supplierRecord(ctx, po.supplierCode),
    };
  }

  /** "PO-L-0861 today": order total, what was received, how much is open. */
  private poSummary(po: Prisma.PurPurchaseOrderGetPayload<{ include: { lines: true } }>) {
    const received = documentTotals(po.lines.map((l) => lineTotals({ qty: l.receivedQty, unitPrice: l.unitPrice, taxRate: l.taxRate })));
    return {
      id: po.id,
      docNo: po.docNo,
      isMigrated: po.isMigrated,
      status: po.status,
      statusLabel: orderStatusLabel(po.status as OrderStatus, { balanceCancelled: po.balanceCancelled, approved: false }),
      supplier: { code: po.supplierCode, name: po.supplierName },
      total: toMoney(po.total),
      receivedValue: toMoney(received.total),
      ordered: toQty(sum(po.lines.map((l) => l.orderedQty))),
      received: toQty(sum(po.lines.map((l) => l.receivedQty))),
      open: toQty(sum(po.lines.map((l) => openQty(l)))),
      uomCode: new Set(po.lines.map((l) => l.uomCode)).size === 1 ? po.lines[0]!.uomCode : null,
    };
  }

  /** "Supplier record": on-time rate, balances cancelled this year, status in Master Data. */
  private async supplierRecord(ctx: RequestContext, supplierCode: string) {
    const yearStart = new Date(`${this.clock.today().slice(0, 4)}-01-01T00:00:00.000Z`);
    const [supplier, stat, cancelled] = await Promise.all([
      this.masterData.findSupplier(ctx.tenantId, supplierCode),
      this.prisma.purSupplierStat.findFirst({ where: { tenantId: ctx.tenantId, supplierCode } }),
      this.prisma.purCancelOrder.count({ where: { tenantId: ctx.tenantId, supplierCode, docDate: { gte: yearStart } } }),
    ]);
    return {
      code: supplierCode,
      status: supplier?.status ?? null,
      onTimePct: stat ? Number(stat.onTimePct12m).toFixed(0) : null,
      cancelledThisYear: cancelled,
    };
  }

  // ── One cancellation (P13) ────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const row = await this.load(ctx.tenantId, id);
    const po = row.poId ? await this.prisma.purPurchaseOrder.findFirst({ where: { id: row.poId, tenantId: ctx.tenantId }, include: { lines: true } }) : null;
    const draft = row.status === 'DRAFT';
    const [links, activity, poActivity, files, supplier] = await Promise.all([
      this.linkedDocs.forDocument(ctx.tenantId, PUR_ENTITY.CANCEL_ORDER, row.id),
      this.activity.listFor(ctx.tenantId, PUR_ENTITY.CANCEL_ORDER, row.id),
      po ? this.activity.listFor(ctx.tenantId, PUR_ENTITY.ORDER, po.id) : Promise.resolve([]),
      this.attachments.listFor(ctx.tenantId, PUR_ENTITY.CANCEL_ORDER, row.id),
      this.supplierRecord(ctx, row.supplierCode),
    ]);
    const poLine = (id: string | null) => po?.lines.find((l) => l.id === id);
    const letter = files.find((f) => f.kind === 'SUPPLIER_LETTER')?.fileName ?? row.supplierLetter;
    return {
      id: row.id,
      docNo: row.docNo,
      docDate: isoDate(row.docDate),
      status: row.status,
      isMigrated: row.isMigrated,
      version: row.version,
      po: po ? this.poSummary(po) : { id: null, docNo: row.poNo, isMigrated: true, status: null, statusLabel: null, supplier: { code: row.supplierCode, name: row.supplierName }, total: null, receivedValue: null, ordered: null, received: null, open: null, uomCode: null },
      supplierName: row.supplierName,
      reason: row.reason,
      reasons: [...new Set([...CANCEL_REASONS, row.reason])],
      supplierLetter: letter ?? null,
      askedBy: { code: row.askedByCode, name: row.askedByName },
      summary: row.summary,
      totalValue: toMoney(row.totalValue),
      remarks: row.remarks,
      releasedAt: row.releasedAt?.toISOString() ?? null,
      releasedByCode: row.releasedByCode,
      lines: row.lines.map((l) => {
        const pl = poLine(l.poLineId);
        return {
          id: l.id,
          poLineId: l.poLineId,
          itemCode: l.itemCode,
          itemName: l.itemName,
          uomCode: l.uomCode,
          taxRate: l.taxRate.toFixed(4),
          orderedQty: toQty(l.orderedQty),
          // A draft follows the PO as it is now; a released cancellation keeps what it saw.
          receivedQty: toQty(draft && pl ? pl.receivedQty : l.receivedQty),
          openQty: toQty(draft && pl ? openQty(pl) : l.openQty),
          cancelQty: toQty(l.cancelQty),
          unitPrice: toPrice(l.unitPrice),
          amount: toMoney(l.amount),
          taxAmount: toMoney(l.taxAmount),
        };
      }),
      attachments: files.map((f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, kind: f.kind, downloadUrl: f.downloadUrl })),
      supplier,
      // What happened on the PO before (goods received), shown with the cancellation's own activity.
      activity: [...poActivity.filter((a) => a.action === 'received'), ...activity],
      links,
      allowedActions: this.actions(ctx, row),
    };
  }
}
