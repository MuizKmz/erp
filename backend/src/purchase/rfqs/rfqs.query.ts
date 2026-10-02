import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurRfq, PurRfqLine, PurRfqReplyLine, PurRfqSupplier } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { businessDate } from '../../platform/clock/clock.rules';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, roundMoney, toMoney, toPrice, toQty, toRmText } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { poApprovalNeed } from '../shared/approval-limit.rules';
import { LinkedDocsService } from '../shared/linked-docs.service';
import { DOC_LINK, PUR_ENTITY } from '../shared/purchase.constants';
import { PurchaseSettingsService } from '../shared/purchase-settings.service';
import type { RfqListQueryDto } from './dto/rfq.dto';
import { addDays, allowedRfqActions, compareReplies, leadTimeText, type RfqStatus } from './rfq.rules';

export const RFQ_STATUSES = ['DRAFT', 'WAITING', 'READY', 'AWARDED', 'CLOSED'] as const;

export type RfqSupplierWithLines = PurRfqSupplier & { replyLines: PurRfqReplyLine[] };
export type RfqFull = PurRfq & { lines: PurRfqLine[]; suppliers: RfqSupplierWithLines[] };

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const INCLUDE = {
  lines: { orderBy: { lineNo: 'asc' } },
  suppliers: { orderBy: { askedAt: 'asc' }, include: { replyLines: true } },
} satisfies Prisma.PurRfqInclude;

/** Reading RFQs: the list with reply dots (P07) and the side-by-side comparison (P08). */
@Injectable()
export class RfqsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly attachments: AttachmentsService,
    private readonly linkedDocs: LinkedDocsService,
    private readonly permissions: PermissionRegistry,
    private readonly settings: PurchaseSettingsService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async load(tenantId: string, id: string): Promise<RfqFull> {
    const rfq = await this.prisma.purRfq.findFirst({ where: { id, tenantId }, include: INCLUDE });
    if (!rfq) throw new NotFoundError('Request for quote');
    return rfq;
  }

  actions(ctx: RequestContext, rfq: PurRfq & { suppliers: Pick<PurRfqSupplier, 'status'>[] }) {
    return allowedRfqActions({
      status: rfq.status as RfqStatus,
      isMigrated: rfq.isMigrated,
      canManage: this.permissions.has(ctx.user.roles, P.RFQ_MANAGE),
      anyWaiting: rfq.suppliers.some((s) => s.status === 'ASKED'),
      anyReplied: rfq.suppliers.some((s) => s.status === 'REPLIED'),
    });
  }

  /** "Buyer", "PRQ-0003", "SO-0008" */
  private source(rfq: PurRfq) {
    if (rfq.requestId) return { type: 'REQUEST' as const, no: rfq.sourceNo, id: rfq.requestId, label: rfq.sourceNo ?? 'Request' };
    if (rfq.sourceNo?.startsWith('SO-')) return { type: 'SALES_ORDER' as const, no: rfq.sourceNo, id: null, label: rfq.sourceNo };
    if (rfq.sourceNo) return { type: 'REQUEST' as const, no: rfq.sourceNo, id: null, label: rfq.sourceNo };
    return { type: 'BUYER' as const, no: null, id: null, label: 'Buyer' };
  }

  /** The draft PO each RFQ was awarded to. */
  private async awardedOrders(tenantId: string, rfqIds: string[]) {
    if (!rfqIds.length) return new Map<string, { id: string | null; docNo: string }>();
    const links = await this.prisma.sysDocLink.findMany({
      where: { tenantId, fromType: PUR_ENTITY.RFQ, fromId: { in: rfqIds }, linkType: DOC_LINK.AWARDED },
    });
    return new Map(links.map((l) => [l.fromId!, { id: l.toId, docNo: l.toNo }]));
  }

  // ── List (P07) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: RfqListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', replyBy: 'replyBy' }, '-docDate');
    const item = query.item?.trim();
    const supplier = query.supplier?.trim();
    const docDate = dateRange(query);
    const base: Prisma.PurRfqWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.buyer && { buyerCode: query.buyer }),
      ...(item && { lines: { some: { OR: [{ itemCode: { contains: item } }, { itemName: { contains: item } }] } } }),
      ...(supplier && { suppliers: { some: { OR: [{ supplierCode: { contains: supplier } }, { supplierName: { contains: supplier } }] } } }),
      ...(query.q?.trim() && { OR: [{ docNo: { contains: query.q.trim() } }, { summary: { contains: query.q.trim() } }] }),
    };
    const status = statusFromKey(query.status, RFQ_STATUSES);
    const where: Prisma.PurRfqWhereInput = { ...base, ...(status && { status }) };

    const [rows, total, grouped, open] = await Promise.all([
      this.prisma.purRfq.findMany({ where, include: INCLUDE, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.purRfq.count({ where }),
      this.prisma.purRfq.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.purRfq.findMany({
        where: { tenantId: ctx.tenantId, status: { in: ['WAITING', 'READY'] }, isMigrated: false },
        include: INCLUDE,
        orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }],
      }),
    ]);
    const [awarded, suppliers] = await Promise.all([
      this.awardedOrders(ctx.tenantId, rows.map((r) => r.id)),
      this.masterData.listSuppliers(ctx.tenantId, [...new Set(rows.map((r) => r.awardedSupplierCode).filter((c): c is string => !!c))]),
    ]);
    const today = this.clock.today();

    return {
      ...toListResponse(
        rows.map((r) => {
          const winner = suppliers.find((s) => s.code === r.awardedSupplierCode);
          return {
            id: r.id,
            docNo: r.docNo,
            docDate: isoDate(r.docDate),
            sentAt: r.sentAt?.toISOString() ?? null,
            summary: r.summary,
            source: this.source(r),
            replies: { replied: r.suppliers.filter((s) => s.status !== 'ASKED').length, asked: r.suppliers.length },
            replyBy: isoDate(r.replyBy),
            awardedTo: r.awardedSupplierCode
              ? { code: r.awardedSupplierCode, name: winner?.shortName ?? r.awardedSupplierName, order: awarded.get(r.id) ?? null }
              : null,
            closeReason: r.closeReason,
            status: r.status,
            isMigrated: r.isMigrated,
            version: r.version,
          };
        }),
        total,
        query,
        buildStatusCounts(grouped, RFQ_STATUSES),
      ),
      // "Replies still open": every supplier on an RFQ that is still waiting.
      openReplies: open.flatMap((r) =>
        r.suppliers.map((s) => ({
            rfqId: r.id,
            rfqNo: r.docNo,
            supplierCode: s.supplierCode,
            supplierName: s.supplierName,
            askedAt: s.askedAt.toISOString(),
            remindedAt: s.remindedAt?.toISOString() ?? null,
            status: s.status,
            // Unit price only when the RFQ has a single item; otherwise the reply is just "Quoted".
            unitPrice: s.status === 'REPLIED' && r.lines.length === 1 && s.replyLines[0] ? toPrice(s.replyLines[0].unitPrice) : null,
            leadTimeText: s.status === 'REPLIED' && s.leadTimeDays !== null ? leadTimeText(s.leadTimeDays) : null,
            // Shown when the reply is due within two days.
            dueSoon: s.status === 'ASKED' && r.replyBy ? isoDate(r.replyBy)! <= addDays(today, 2) : false,
            replyBy: isoDate(r.replyBy),
            canRemind: s.status === 'ASKED' && this.actions(ctx, r).includes('remind'),
          })),
      ),
    };
  }

  // ── Compare (P08) ─────────────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const rfq = await this.load(ctx.tenantId, id);
    const codes = rfq.suppliers.map((s) => s.supplierCode);
    const [suppliers, items, stats, rules, branches, links, activity, awarded, quotes] = await Promise.all([
      this.masterData.listSuppliers(ctx.tenantId, codes),
      this.masterData.findItems(ctx.tenantId, rfq.lines.map((l) => l.itemCode)),
      this.prisma.purSupplierStat.findMany({ where: { tenantId: ctx.tenantId, supplierCode: { in: codes } } }),
      this.settings.poLimitRules(ctx.tenantId),
      this.masterData.listBranches(ctx.tenantId),
      this.linkedDocs.forDocument(ctx.tenantId, PUR_ENTITY.RFQ, rfq.id),
      this.activity.listFor(ctx.tenantId, PUR_ENTITY.RFQ, rfq.id),
      this.awardedOrders(ctx.tenantId, [rfq.id]),
      Promise.all(rfq.suppliers.map((s) => this.attachments.listFor(ctx.tenantId, PUR_ENTITY.RFQ_SUPPLIER, s.id))),
    ]);
    const branchName = branches.find((b) => b.code === rfq.branchCode)?.name ?? rfq.branchCode;
    const lineNoById = new Map(rfq.lines.map((l) => [l.id, l.lineNo]));
    const pricesOf = (s: RfqSupplierWithLines) => new Map(s.replyLines.map((r) => [lineNoById.get(r.rfqLineId)!, r.unitPrice]));
    const replied = rfq.suppliers.filter((s) => s.status === 'REPLIED');
    const compare = compareReplies(
      rfq.lines.map((l) => ({ lineNo: l.lineNo, qty: l.qty })),
      replied.map((s) => ({ supplierCode: s.supplierCode, prices: pricesOf(s), leadTimeDays: s.leadTimeDays })),
    );
    // Delivery dates count from the award, or from today while the RFQ is open.
    const fromDate = rfq.awardedAt ? businessDate(rfq.awardedAt) : this.clock.today();
    const neededBy = isoDate(rfq.neededBy);
    const preferred = new Set(items.map((i) => i.preferredSupplierCode).filter(Boolean));

    return {
      id: rfq.id,
      docNo: rfq.docNo,
      docDate: isoDate(rfq.docDate),
      status: rfq.status,
      isMigrated: rfq.isMigrated,
      version: rfq.version,
      buyer: { code: rfq.buyerCode, name: rfq.buyerName },
      branch: { code: rfq.branchCode, name: branchName },
      source: this.source(rfq),
      summary: rfq.summary,
      sentAt: rfq.sentAt?.toISOString() ?? null,
      replyBy: isoDate(rfq.replyBy),
      neededBy,
      remarks: rfq.remarks,
      awardReason: rfq.awardReason,
      awardedAt: rfq.awardedAt?.toISOString() ?? null,
      awardedSupplierCode: rfq.awardedSupplierCode,
      awardedOrder: awarded.get(rfq.id) ?? null,
      closeReason: rfq.closeReason,
      lines: rfq.lines.map((l) => ({
        lineNo: l.lineNo,
        itemCode: l.itemCode,
        itemName: l.itemName,
        uomCode: l.uomCode,
        taxCode: l.taxCode,
        taxRate: l.taxRate.toFixed(4),
        qty: toQty(l.qty),
      })),
      suppliers: rfq.suppliers.map((s, i) => {
        const master = suppliers.find((m) => m.code === s.supplierCode);
        const stat = stats.find((x) => x.supplierCode === s.supplierCode);
        const total = compare.totals.get(s.supplierCode) ?? null;
        const prices = pricesOf(s);
        const tax = total === null ? null : rfq.lines.reduce((sum, l) => sum.add(roundMoney(roundMoney(dec(l.qty).mul(dec(prices.get(l.lineNo)!))).mul(l.taxRate))), dec(0));
        const totalWithTax = total === null ? null : dec(total).add(tax!);
        const need = totalWithTax === null ? null : poApprovalNeed({ branchCode: rfq.branchCode, branchName, total: totalWithTax, rules });
        const deliveryBy = s.leadTimeDays === null ? null : addDays(fromDate, s.leadTimeDays);
        return {
          id: s.id,
          code: s.supplierCode,
          name: s.supplierName,
          shortName: master?.shortName ?? null,
          email: s.email,
          isPreferred: preferred.has(s.supplierCode),
          status: s.status,
          askedAt: s.askedAt.toISOString(),
          remindedAt: s.remindedAt?.toISOString() ?? null,
          repliedAt: s.repliedAt?.toISOString() ?? null,
          leadTimeDays: s.leadTimeDays,
          leadTimeText: s.leadTimeDays === null ? null : leadTimeText(s.leadTimeDays),
          deliveryBy,
          late: Boolean(deliveryBy && neededBy && deliveryBy > neededBy),
          paymentTermDays: s.paymentTermDays,
          validUntil: isoDate(s.validUntil),
          quoteRef: s.quoteRef,
          note: s.replyNote,
          prices: s.replyLines.map((r) => ({
            lineNo: lineNoById.get(r.rfqLineId)!,
            unitPrice: toPrice(r.unitPrice),
            minOrderQty: r.minOrderQty === null ? null : toQty(r.minOrderQty),
          })),
          total,
          totalWithTax: totalWithTax === null ? null : toMoney(totalWithTax),
          approval: need ? { required: need.required, reason: need.reason, text: need.limit ? `${need.required ? 'Yes · over' : 'No · under'} ${toRmText(need.limit)}` : 'No' } : null,
          onTime: stat ? { pct: Number(stat.onTimePct12m).toFixed(0), deliveries: stat.deliveries12m } : null,
          quotes: quotes[i]!.map((q) => ({ id: q.id, fileName: q.fileName, downloadUrl: q.downloadUrl })),
          isAwarded: s.isAwarded,
        };
      }),
      compare: {
        cheapest: compare.cheapest,
        fastest: compare.fastest,
        lowestPrice: Object.fromEntries(compare.lowestPrice),
      },
      links,
      activity,
      allowedActions: this.actions(ctx, rfq),
    };
  }
}
