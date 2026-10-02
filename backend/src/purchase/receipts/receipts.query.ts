import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurGoodsReceipt, PurGoodsReceiptLine, PurPurchaseOrder, PurPurchaseOrderLine } from '@prisma/client';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toQty } from '../../platform/http/decimal';
import { BusinessRuleError, NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { orderStatusLabel, type OrderStatus } from '../orders/order.rules';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { LinkedDocsService } from '../shared/linked-docs.service';
import { PUR_ENTITY } from '../shared/purchase.constants';
import { plainQty, qtyWithUnit } from '../shared/text.rules';
import type { ReceiptListQueryDto } from './dto/receipt.dto';
import { allowedReceiptActions, openQty, RECEIVABLE_PO_STATUSES, type ReceiptStatus } from './receipt.rules';

export const RECEIPT_STATUSES = ['DRAFT', 'CONFIRMED'] as const;
export const GOODS_RECEIVED_EVENT = 'purchase.goods.received';

export type ReceiptWithLines = PurGoodsReceipt & { lines: PurGoodsReceiptLine[] };
type PoWithLines = PurPurchaseOrder & { lines: PurPurchaseOrderLine[] };
/** Stock column on the list: where the stock-in event for Inventory stands. */
export type StockState = 'NONE' | 'QUEUED' | 'POSTED' | 'FAILED' | 'OLD_SYSTEM';

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));

/** "80 tins", or "3 items" when the lines use different units. */
function quantityText(lines: { qty: Prisma.Decimal; uomCode: string }[]): string {
  const units = new Set(lines.map((l) => l.uomCode));
  if (units.size === 1) return qtyWithUnit(sum(lines.map((l) => l.qty)), lines[0]!.uomCode);
  return `${lines.length} items`;
}

/** Reading goods receipts: waiting to be received and the receipt list (P14), one receipt (P15). */
@Injectable()
export class ReceiptsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly attachments: AttachmentsService,
    private readonly linkedDocs: LinkedDocsService,
    private readonly permissions: PermissionRegistry,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
  ) {}

  async load(tenantId: string, id: string): Promise<ReceiptWithLines> {
    const receipt = await this.prisma.purGoodsReceipt.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!receipt) throw new NotFoundError('Goods receipt');
    return receipt;
  }

  actions(ctx: RequestContext, receipt: Pick<PurGoodsReceipt, 'status' | 'isMigrated'>) {
    return allowedReceiptActions({
      status: receipt.status as ReceiptStatus,
      isMigrated: receipt.isMigrated,
      canEdit: this.permissions.has(ctx.user.roles, P.RECEIPT_EDIT),
      canConfirm: this.permissions.has(ctx.user.roles, P.RECEIPT_CONFIRM),
    });
  }

  /** Where each receipt's stock-in event stands. */
  private async stockStates(tenantId: string, receipts: Pick<PurGoodsReceipt, 'id' | 'status' | 'isMigrated'>[]): Promise<Map<string, StockState>> {
    const ids = receipts.filter((r) => r.status === 'CONFIRMED' && !r.isMigrated).map((r) => r.id);
    const events = ids.length
      ? await this.prisma.sysOutbox.findMany({ where: { tenantId, name: GOODS_RECEIVED_EVENT, aggregateId: { in: ids } }, select: { aggregateId: true, status: true } })
      : [];
    return new Map(
      receipts.map((r) => {
        if (r.isMigrated) return [r.id, 'OLD_SYSTEM'];
        if (r.status !== 'CONFIRMED') return [r.id, 'NONE'];
        const e = events.find((x) => x.aggregateId === r.id);
        return [r.id, !e ? 'NONE' : e.status === 'DISPATCHED' ? 'POSTED' : e.status === 'FAILED' ? 'FAILED' : 'QUEUED'];
      }),
    );
  }

  /**
   * Why a PO cannot be received right now, or null. Rule 1 and FlowP4 step 1: only released or partly received
   * orders with something open; not while a cancel order for the balance is waiting.
   */
  receivableProblem(po: PoWithLines, pendingCancelNo: string | null): string | null {
    if (!(RECEIVABLE_PO_STATUSES as readonly string[]).includes(po.status)) {
      return `${po.docNo} is ${orderStatusLabel(po.status as OrderStatus, { balanceCancelled: po.balanceCancelled, approved: false }).toLowerCase()}, so goods cannot be received against it.`;
    }
    if (!po.lines.some((l) => openQty(l).gt(0))) return `Everything on ${po.docNo} has been received.`;
    if (pendingCancelNo) return `${pendingCancelNo} is cancelling the balance of ${po.docNo}. Finish or delete it first.`;
    return null;
  }

  // ── Waiting to be received (P14 top) ──────────────────────────────────────

  async waiting(ctx: RequestContext) {
    const today = this.clock.today();
    const [orders, branches, queued] = await Promise.all([
      this.prisma.purPurchaseOrder.findMany({
        where: { tenantId: ctx.tenantId, status: { in: [...RECEIVABLE_PO_STATUSES] }, branchCode: { in: ctx.user.branchCodes } },
        include: {
          lines: { orderBy: { lineNo: 'asc' } },
          receipts: { where: { status: 'DRAFT' }, select: { id: true, docNo: true, docDate: true } },
          cancelOrders: { where: { status: 'DRAFT' }, select: { id: true, docNo: true } },
        },
      }),
      this.masterData.listBranches(ctx.tenantId),
      this.prisma.sysOutbox.findMany({
        where: { tenantId: ctx.tenantId, name: GOODS_RECEIVED_EVENT, status: { not: 'DISPATCHED' } },
        select: { aggregateId: true },
      }),
    ]);
    const canReceive = this.permissions.has(ctx.user.roles, P.RECEIPT_EDIT);

    const rows = orders
      .map((po) => {
        const open = po.lines.map((l) => ({ line: l, qty: openQty(l) })).filter((x) => x.qty.gt(0));
        if (!open.length) return null;
        const draft = po.receipts[0] ?? null;
        const cancel = po.cancelOrders[0] ?? null;
        const expected = isoDate(po.promisedDate ?? po.expectedDate);
        const first = open[0]!.line;
        const notes: string[] = [];
        if (draft) notes.push(`${draft.docNo} being counted`);
        else if (po.status === 'PARTIAL') notes.push(`Balance of ${plainQty(sum(po.lines.map((l) => l.orderedQty)))}`);
        if (po.branchCode !== ctx.branchCode) notes.push(`${(branches.find((b) => b.code === po.branchCode)?.name ?? po.branchCode).replace(/\s+branch$/i, '')} branch`);
        return {
          poId: po.id,
          poNo: po.docNo,
          isMigrated: po.isMigrated,
          supplierName: po.supplierName,
          branchCode: po.branchCode,
          item: { code: first.itemCode, name: first.itemName, more: open.length - 1 },
          openText: quantityText(open.map((x) => ({ qty: x.qty, uomCode: x.line.uomCode }))),
          openQty: toQty(sum(open.map((x) => x.qty))),
          expected,
          arrivedToday: Boolean(draft && isoDate(draft.docDate) === today),
          lateDays: expected && expected < today ? daysBetween(expected, today) : 0,
          note: notes.join(' · ') || null,
          draftReceipt: draft ? { id: draft.id, docNo: draft.docNo } : null,
          cancelOrder: cancel ? { id: cancel.id, docNo: cancel.docNo } : null,
          action: cancel ? null : draft ? ('CONTINUE' as const) : canReceive ? ('RECEIVE' as const) : null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      // Being counted first, then by expected date; orders being cancelled last.
      .sort(
        (a, b) =>
          Number(Boolean(b.draftReceipt)) - Number(Boolean(a.draftReceipt)) ||
          Number(Boolean(a.cancelOrder)) - Number(Boolean(b.cancelOrder)) ||
          (a.expected ?? '9999').localeCompare(b.expected ?? '9999') ||
          a.poNo.localeCompare(b.poNo),
      );

    const arrived = rows.filter((r) => r.arrivedToday);
    const late = rows.filter((r) => r.lateDays > 0 && !r.arrivedToday).sort((a, b) => b.lateDays - a.lateDays);
    const queuedReceipts = new Set(queued.map((q) => q.aggregateId)).size;
    return {
      items: rows,
      kpis: {
        waiting: { count: rows.length, units: toQty(sum(rows.map((r) => dec(r.openQty)))) },
        arrivedToday: { count: arrived.length, first: arrived[0]?.poNo ?? null },
        late: { count: late.length, worst: late[0] ? { poNo: late[0].poNo, days: late[0].lateDays } : null },
        waitingForInventory: { count: queuedReceipts },
      },
      inventoryConnected: this.stock.connected,
    };
  }

  // ── Receipt list (P14 bottom) ─────────────────────────────────────────────

  async list(ctx: RequestContext, query: ReceiptListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate' }, '-docDate');
    const q = query.q?.trim();
    const supplier = query.supplier?.trim();
    const docDate = dateRange(query);
    const base: Prisma.PurGoodsReceiptWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(supplier && { supplierName: { contains: supplier } }),
      ...(q && { OR: [{ docNo: { contains: q } }, { poNo: { contains: q } }, { supplierDoNo: { contains: q } }, { supplierName: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, RECEIPT_STATUSES);
    const where: Prisma.PurGoodsReceiptWhereInput = { ...base, ...(status && { status }) };
    const [rows, total, grouped] = await Promise.all([
      this.prisma.purGoodsReceipt.findMany({ where, include: { lines: true }, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.purGoodsReceipt.count({ where }),
      this.prisma.purGoodsReceipt.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const stock = await this.stockStates(ctx.tenantId, rows);
    return toListResponse(
      rows.map((r) => {
        const received = sum(r.lines.map((l) => l.receivedQty));
        const openBefore = sum(r.lines.map((l) => l.openQtyBefore));
        return {
          id: r.id,
          docNo: r.docNo,
          docDate: isoDate(r.docDate),
          poId: r.poId,
          poNo: r.poNo,
          supplierName: r.supplierName,
          supplierDoNo: r.supplierDoNo,
          receivedQty: toQty(received),
          openQtyBefore: toQty(openBefore),
          shortQty: r.status === 'CONFIRMED' ? toQty(openBefore.sub(received)) : '0.0000',
          receivedByName: r.receivedByName,
          stock: stock.get(r.id)!,
          status: r.status,
          isMigrated: r.isMigrated,
        };
      }),
      total,
      query,
      buildStatusCounts(grouped, RECEIPT_STATUSES),
    );
  }

  // ── New receipt for a PO (P15 /new?po=) ───────────────────────────────────

  async loadPo(ctx: RequestContext, poId: string) {
    const po = await this.prisma.purPurchaseOrder.findFirst({
      where: { id: poId, tenantId: ctx.tenantId },
      include: {
        lines: { orderBy: { lineNo: 'asc' } },
        receipts: { where: { status: 'DRAFT' }, select: { id: true, docNo: true } },
        cancelOrders: { where: { status: 'DRAFT' }, select: { docNo: true } },
      },
    });
    if (!po) throw new NotFoundError('Purchase order');
    if (!ctx.user.branchCodes.includes(po.branchCode)) throw new BusinessRuleError('BRANCH_NOT_ALLOWED', `${po.docNo} belongs to a branch you do not work in.`);
    return po;
  }

  async template(ctx: RequestContext, poId: string) {
    const po = await this.loadPo(ctx, poId);
    const draft = po.receipts[0];
    if (draft) throw new BusinessRuleError('DRAFT_EXISTS', `${draft.docNo} is already open for ${po.docNo}. Continue that receipt instead.`);
    const problem = this.receivableProblem(po, po.cancelOrders[0]?.docNo ?? null);
    if (problem) throw new BusinessRuleError('NOT_RECEIVABLE', problem);
    const [branches, warehouses] = await Promise.all([this.masterData.listBranches(ctx.tenantId), this.masterData.listWarehouses(ctx.tenantId, po.branchCode)]);
    return {
      po: this.poSummary(po, branches),
      receivedBy: { code: ctx.user.code, name: ctx.user.name, title: ctx.user.jobTitle },
      docDate: this.clock.today(),
      warehouseCode: po.warehouseCode,
      warehouses: warehouses.filter((w) => w.isActive),
      lines: po.lines
        .filter((l) => openQty(l).gt(0))
        .map((l) => ({
          poLineId: l.id,
          lineNo: l.lineNo,
          itemCode: l.itemCode,
          itemName: l.itemName,
          uomCode: l.uomCode,
          orderedQty: toQty(l.orderedQty),
          receivedBeforeQty: toQty(l.receivedQty),
          openQty: toQty(openQty(l)),
        })),
      inventoryConnected: this.stock.connected,
    };
  }

  private poSummary(po: PoWithLines, branches: { code: string; name: string }[]) {
    return {
      id: po.id,
      docNo: po.docNo,
      docDate: isoDate(po.docDate),
      status: po.status,
      statusLabel: orderStatusLabel(po.status as OrderStatus, { balanceCancelled: po.balanceCancelled, approved: false }),
      isMigrated: po.isMigrated,
      supplier: { code: po.supplierCode, name: po.supplierName },
      branch: { code: po.branchCode, name: branches.find((b) => b.code === po.branchCode)?.name ?? po.branchCode },
      expectedDate: isoDate(po.promisedDate ?? po.expectedDate),
      ordered: toQty(sum(po.lines.map((l) => l.orderedQty))),
      received: toQty(sum(po.lines.map((l) => l.receivedQty))),
      open: toQty(sum(po.lines.map((l) => openQty(l)))),
      uomCode: new Set(po.lines.map((l) => l.uomCode)).size === 1 ? po.lines[0]!.uomCode : null,
    };
  }

  // ── One receipt (P15) ─────────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const receipt = await this.load(ctx.tenantId, id);
    const po = await this.prisma.purPurchaseOrder.findFirstOrThrow({
      where: { id: receipt.poId, tenantId: ctx.tenantId },
      include: { lines: { orderBy: { lineNo: 'asc' } }, cancelOrders: { where: { status: 'DRAFT' }, select: { docNo: true } } },
    });
    const [branches, warehouses, users, links, activity, files, stock] = await Promise.all([
      this.masterData.listBranches(ctx.tenantId),
      this.masterData.listWarehouses(ctx.tenantId, receipt.branchCode),
      this.masterData.listUsers(ctx.tenantId),
      this.linkedDocs.forDocument(ctx.tenantId, PUR_ENTITY.RECEIPT, receipt.id),
      this.activity.listFor(ctx.tenantId, PUR_ENTITY.RECEIPT, receipt.id),
      this.attachments.listFor(ctx.tenantId, PUR_ENTITY.RECEIPT, receipt.id),
      this.stockStates(ctx.tenantId, [receipt]),
    ]);
    const poLine = (lineId: string) => po.lines.find((l) => l.id === lineId);
    const draft = receipt.status === 'DRAFT';
    return {
      id: receipt.id,
      docNo: receipt.docNo,
      docDate: isoDate(receipt.docDate),
      status: receipt.status,
      isMigrated: receipt.isMigrated,
      version: receipt.version,
      po: this.poSummary(po, branches),
      // A draft can only be confirmed while the PO is still receivable.
      poProblem: draft ? this.receivableProblem(po, po.cancelOrders[0]?.docNo ?? null) : null,
      supplier: { code: receipt.supplierCode, name: receipt.supplierName },
      branch: { code: receipt.branchCode, name: branches.find((b) => b.code === receipt.branchCode)?.name ?? receipt.branchCode },
      warehouse: { code: receipt.warehouseCode, name: receipt.warehouseName },
      warehouses: warehouses.filter((w) => w.isActive || w.code === receipt.warehouseCode),
      supplierDoNo: receipt.supplierDoNo,
      vehicleNo: receipt.vehicleNo,
      receivedBy: { code: receipt.receivedByCode, name: receipt.receivedByName, title: users.find((u) => u.code === receipt.receivedByCode)?.jobTitle ?? null },
      arrivedAt: receipt.arrivedAt?.toISOString() ?? null,
      confirmedAt: receipt.confirmedAt?.toISOString() ?? null,
      shortAction: receipt.shortAction,
      remarks: receipt.remarks,
      lines: receipt.lines.map((l) => {
        const pl = poLine(l.poLineId);
        return {
          id: l.id,
          lineNo: l.lineNo,
          poLineId: l.poLineId,
          itemCode: l.itemCode,
          itemName: l.itemName,
          uomCode: l.uomCode,
          orderedQty: toQty(l.orderedQty),
          openQtyBefore: toQty(l.openQtyBefore),
          // What is open on the PO line now (a draft may be counted again).
          openQty: toQty(draft && pl ? openQty(pl) : l.openQtyBefore),
          receivedBeforeQty: toQty(draft && pl ? pl.receivedQty : dec(l.orderedQty).sub(l.openQtyBefore)),
          receivedQty: toQty(l.receivedQty),
          condition: l.condition,
          locationCode: l.locationCode,
        };
      }),
      attachments: files.map((f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, kind: f.kind, downloadUrl: f.downloadUrl })),
      stock: stock.get(receipt.id)!,
      inventoryConnected: this.stock.connected,
      links,
      activity,
      allowedActions: this.actions(ctx, receipt),
    };
  }
}
