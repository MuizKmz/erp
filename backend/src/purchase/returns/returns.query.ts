import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurReturn, PurReturnLine } from '@prisma/client';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
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
import { invoiceStatusLabel } from '../invoices/invoices.query';
import { orderStatusLabel, type OrderStatus } from '../orders/order.rules';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { LinkedDocsService } from '../shared/linked-docs.service';
import { PUR_ENTITY } from '../shared/purchase.constants';
import { plainQty, qtyWithUnit } from '../shared/text.rules';
import type { ReturnListQueryDto } from './dto/return.dto';
import { allowedReturnActions, daysBetween, reasonGroup, RETURN_REASONS, returnableQty, type ReturnStatus } from './return.rules';

export const RETURN_STATUSES = ['DRAFT', 'RELEASED', 'SETTLED'] as const;
export const RETURN_RELEASED_EVENT = 'purchase.return.released';
export type ReturnWithLines = PurReturn & { lines: PurReturnLine[] };

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));

/** Reading purchase returns: the list and credit notes to chase (P22), one return (P23). */
@Injectable()
export class ReturnsQuery {
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

  async load(tenantId: string, id: string): Promise<ReturnWithLines> {
    const row = await this.prisma.purReturn.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Purchase return');
    return row;
  }

  actions(ctx: RequestContext, row: Pick<PurReturn, 'status' | 'isMigrated'>) {
    return allowedReturnActions({
      status: row.status as ReturnStatus,
      isMigrated: row.isMigrated,
      canEdit: this.permissions.has(ctx.user.roles, P.RETURN_EDIT),
      canRelease: this.permissions.has(ctx.user.roles, P.RETURN_RELEASE),
      canSettle: this.permissions.has(ctx.user.roles, P.INVOICE_EDIT),
    });
  }

  /** "Settled by": "Credit note · expected", "Credit note CW-CN-051", "Replaced · GRN-L-0388". */
  private settledBy(r: PurReturn): string {
    if (r.settleBy === 'REPLACEMENT') return r.replacementGrnNo ? `Replaced · ${r.replacementGrnNo}` : 'Replacement · expected';
    return r.creditNoteNo ? `Credit note ${r.creditNoteNo}` : 'Credit note · expected';
  }

  /** A goods receipt can be returned from when it is confirmed and something is left to send back. */
  async loadReturnableReceipt(ctx: RequestContext, grnId: string) {
    const grn = await this.prisma.purGoodsReceipt.findFirst({ where: { id: grnId, tenantId: ctx.tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!grn) throw new NotFoundError('Goods receipt');
    if (!ctx.user.branchCodes.includes(grn.branchCode)) throw new BusinessRuleError('BRANCH_NOT_ALLOWED', `${grn.docNo} belongs to a branch you do not work in.`);
    if (grn.status !== 'CONFIRMED') throw new BusinessRuleError('NOT_RECEIVED', `${grn.docNo} is not confirmed yet, so nothing has been received to return.`);
    if (!grn.lines.some((l) => returnableQty(l).gt(0))) throw new BusinessRuleError('NOTHING_TO_RETURN', `Everything received on ${grn.docNo} has already gone back.`);
    return grn;
  }

  // ── List (P22) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: ReturnListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', total: 'total' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const base: Prisma.PurReturnWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.supplier?.trim() && { supplierName: { contains: query.supplier.trim() } }),
      ...(query.grnNo?.trim() && { grnNo: { contains: query.grnNo.trim() } }),
      ...(query.reason && { reason: query.reason }),
      ...(q && { OR: [{ docNo: { contains: q } }, { grnNo: { contains: q } }, { supplierName: { contains: q } }, { rmaNo: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, RETURN_STATUSES);
    const where: Prisma.PurReturnWhereInput = { ...base, ...(status && { status }) };
    const [rows, total, grouped, reasons] = await Promise.all([
      this.prisma.purReturn.findMany({ where, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.purReturn.count({ where }),
      this.prisma.purReturn.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.purReturn.findMany({ where: { tenantId: ctx.tenantId }, distinct: ['reason'], select: { reason: true } }),
    ]);
    return {
      ...toListResponse(
        rows.map((r) => ({
          id: r.id,
          docNo: r.docNo,
          docDate: isoDate(r.docDate),
          supplierName: r.supplierName,
          summary: r.summary,
          grnId: r.grnId,
          grnNo: r.grnNo,
          reason: r.reason,
          total: toMoney(r.total),
          settledBy: this.settledBy(r),
          status: r.status,
          isMigrated: r.isMigrated,
        })),
        total,
        query,
        buildStatusCounts(grouped, RETURN_STATUSES),
      ),
      reasons: [...new Set([...RETURN_REASONS, ...reasons.map((r) => r.reason)])],
    };
  }

  /** The four cards, credit notes to chase and how returns get settled. */
  async overview(ctx: RequestContext) {
    const today = this.clock.today();
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
    const [all, month, queued] = await Promise.all([
      this.prisma.purReturn.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }] }),
      this.prisma.purReturn.findMany({ where: { tenantId: ctx.tenantId, status: { not: 'DRAFT' }, docDate: { gte: monthStart } }, include: { lines: true } }),
      this.prisma.sysOutbox.count({ where: { tenantId: ctx.tenantId, name: RETURN_RELEASED_EVENT, status: { not: 'DISPATCHED' } } }),
    ]);
    const waiting = all.filter((r) => r.status === 'RELEASED');
    const suppliers = await this.masterData.listSuppliers(ctx.tenantId, [...new Set(waiting.map((r) => r.supplierCode))]);
    const shortName = (r: PurReturn) => suppliers.find((s) => s.code === r.supplierCode)?.shortName ?? r.supplierName;
    const groups = new Map<string, number>();
    for (const r of month) groups.set(reasonGroup(r.reason), (groups.get(reasonGroup(r.reason)) ?? 0) + 1);
    const top = [...groups].sort((a, b) => b[1] - a[1])[0];
    const credited = all.filter((r) => r.status === 'SETTLED' && r.settleBy === 'CREDIT_NOTE' && r.releasedAt && r.settledAt);
    const decided = all.filter((r) => r.status !== 'DRAFT');
    const canAct = this.permissions.has(ctx.user.roles, P.RETURN_EDIT) || this.permissions.has(ctx.user.roles, P.RETURN_RELEASE);
    return {
      kpis: {
        waitingCredit: { total: toMoney(sum(waiting.map((r) => r.total))), first: waiting[0] ? `${waiting[0].docNo} · ${shortName(waiting[0])}` : null, count: waiting.length },
        thisMonth: { count: month.length, units: toQty(sum(month.flatMap((r) => r.lines.map((l) => l.qty)))) },
        topReason: top ? { name: top[0], count: top[1], of: month.length } : null,
        waitingInventory: { count: queued },
      },
      chase: waiting.map((r) => ({
        id: r.id,
        docNo: r.docNo,
        supplierName: r.supplierName,
        total: toMoney(r.total),
        settleBy: r.settleBy,
        collection: r.collection,
        rmaNo: r.rmaNo,
        canRemind: canAct,
      })),
      stats: {
        averageDaysToCredit: credited.length ? Math.round(credited.reduce((s, r) => s + daysBetween(r.releasedAt!, r.settledAt!), 0) / credited.length) : null,
        byReplacement: decided.filter((r) => r.status === 'SETTLED' && r.settleBy === 'REPLACEMENT').length,
        byCreditNote: decided.filter((r) => r.status === 'SETTLED' && r.settleBy === 'CREDIT_NOTE').length,
        of: decided.length,
      },
      inventoryConnected: this.stock.connected,
    };
  }

  /** Confirmed goods receipts with something left to return (for the receipt picker). */
  async returnableReceipts(ctx: RequestContext) {
    const rows = await this.prisma.purGoodsReceipt.findMany({
      where: { tenantId: ctx.tenantId, status: 'CONFIRMED', branchCode: { in: ctx.user.branchCodes } },
      include: { lines: true },
      orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }],
      take: 100,
    });
    return {
      items: rows
        .map((g) => {
          const left = g.lines.map((l) => ({ qty: returnableQty(l), uomCode: l.uomCode })).filter((l) => l.qty.gt(0));
          if (!left.length) return null;
          const units = new Set(left.map((l) => l.uomCode));
          return {
            id: g.id,
            docNo: g.docNo,
            docDate: isoDate(g.docDate),
            poNo: g.poNo,
            supplierName: g.supplierName,
            returnableText: units.size === 1 ? qtyWithUnit(sum(left.map((l) => l.qty)), left[0]!.uomCode) : `${left.length} items`,
          };
        })
        .filter((g): g is NonNullable<typeof g> => g !== null),
    };
  }

  // ── New return from a goods receipt (P23 /new?grn=) ───────────────────────

  async template(ctx: RequestContext, grnId: string) {
    const grn = await this.loadReturnableReceipt(ctx, grnId);
    return {
      grn: { id: grn.id, docNo: grn.docNo, poId: grn.poId, poNo: grn.poNo, isMigrated: grn.isMigrated },
      supplier: { code: grn.supplierCode, name: grn.supplierName },
      docDate: this.clock.today(),
      reasons: RETURN_REASONS,
      lines: grn.lines
        .filter((l) => returnableQty(l).gt(0))
        .map((l) => ({
          grnLineId: l.id,
          itemCode: l.itemCode,
          itemName: l.itemName,
          uomCode: l.uomCode,
          taxCode: l.taxCode,
          taxRate: l.taxRate.toFixed(4),
          receivedQty: toQty(l.receivedQty),
          returnedBeforeQty: toQty(l.returnedQty),
          unitPrice: toPrice(l.unitPrice),
        })),
      originals: await this.originals(ctx, grn.id, grn.poId),
      taxNames: Object.fromEntries((await this.masterData.listTaxCodes(ctx.tenantId)).map((t) => [t.code, t.name])),
      inventoryConnected: this.stock.connected,
    };
  }

  /** "Original documents": the receipt, the supplier invoices billed from it, the PO. */
  private async originals(ctx: RequestContext, grnId: string | null, poId: string | null) {
    const [grn, invoices, po] = await Promise.all([
      grnId ? this.prisma.purGoodsReceipt.findFirst({ where: { id: grnId, tenantId: ctx.tenantId }, include: { lines: true } }) : null,
      grnId
        ? this.prisma.purInvoice.findMany({ where: { tenantId: ctx.tenantId, lines: { some: { grnLine: { grnId } } } }, orderBy: { docDate: 'asc' } })
        : Promise.resolve([]),
      poId ? this.prisma.purPurchaseOrder.findFirst({ where: { id: poId, tenantId: ctx.tenantId } }) : null,
    ]);
    const received = grn ? sum(grn.lines.map((l) => l.receivedQty)) : dec(0);
    const short = grn ? sum(grn.lines.map((l) => l.openQtyBefore.sub(l.receivedQty))) : dec(0);
    return {
      grn: grn
        ? { id: grn.id, docNo: grn.docNo, isMigrated: grn.isMigrated, received: plainQty(received), chip: short.gt(0) ? { label: `Short ${plainQty(short)}`, group: 'partial' } : { label: 'Received', group: 'done' } }
        : null,
      invoices: invoices.map((i) => {
        const s = invoiceStatusLabel(i);
        return { id: i.id, docNo: i.docNo, isMigrated: i.isMigrated, total: toMoney(i.total), label: s.label, group: s.group };
      }),
      po: po
        ? { id: po.id, docNo: po.docNo, isMigrated: po.isMigrated, label: orderStatusLabel(po.status as OrderStatus, { balanceCancelled: po.balanceCancelled, approved: false }), status: po.status }
        : null,
    };
  }

  // ── One return (P23) ──────────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const row = await this.load(ctx.tenantId, id);
    const draft = row.status === 'DRAFT';
    const grnLines = row.grnId ? await this.prisma.purGoodsReceiptLine.findMany({ where: { grnId: row.grnId } }) : [];
    const [links, activity, files, originals, taxes] = await Promise.all([
      this.linkedDocs.forDocument(ctx.tenantId, PUR_ENTITY.RETURN, row.id),
      this.activity.listFor(ctx.tenantId, PUR_ENTITY.RETURN, row.id),
      this.attachments.listFor(ctx.tenantId, PUR_ENTITY.RETURN, row.id),
      this.originals(ctx, row.grnId, row.poId),
      this.masterData.listTaxCodes(ctx.tenantId),
    ]);
    return {
      id: row.id,
      docNo: row.docNo,
      docDate: isoDate(row.docDate),
      status: row.status,
      isMigrated: row.isMigrated,
      version: row.version,
      grn: { id: row.grnId, docNo: row.grnNo },
      po: { id: row.poId, docNo: row.poNo },
      supplier: { code: row.supplierCode, name: row.supplierName },
      reason: row.reason,
      reasons: [...new Set([...RETURN_REASONS, row.reason])],
      settleBy: row.settleBy,
      rmaNo: row.rmaNo,
      collection: row.collection,
      summary: row.summary,
      subtotal: toMoney(row.subtotal),
      taxTotal: toMoney(row.taxTotal),
      total: toMoney(row.total),
      releasedAt: row.releasedAt?.toISOString() ?? null,
      creditNoteNo: row.creditNoteNo,
      replacementGrnNo: row.replacementGrnNo,
      settledAt: row.settledAt?.toISOString() ?? null,
      settledBy: this.settledBy(row),
      remarks: row.remarks,
      lines: row.lines.map((l) => {
        const g = grnLines.find((x) => x.id === l.grnLineId);
        return {
          id: l.id,
          grnLineId: l.grnLineId,
          itemCode: l.itemCode,
          itemName: l.itemName,
          uomCode: l.uomCode,
          taxCode: l.taxCode,
          taxRate: l.taxRate.toFixed(4),
          // A draft follows the receipt as it is now; a released return keeps what it saw.
          receivedQty: toQty(draft && g ? g.receivedQty : l.receivedQty),
          returnedBeforeQty: toQty(draft && g ? g.returnedQty : l.returnedBeforeQty),
          qty: toQty(l.qty),
          unitPrice: toPrice(l.unitPrice),
          amount: toMoney(l.amount),
          taxAmount: toMoney(l.taxAmount),
        };
      }),
      taxNames: Object.fromEntries(taxes.map((t) => [t.code, t.name])),
      attachments: files.map((f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, kind: f.kind, downloadUrl: f.downloadUrl })),
      originals,
      inventoryConnected: this.stock.connected,
      links,
      activity,
      allowedActions: this.actions(ctx, row),
    };
  }
}
