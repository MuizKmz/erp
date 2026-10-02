import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurRequest, PurRequestLine } from '@prisma/client';
import { SALES_DEMAND_PORT, STOCK_PORT, type SalesDemandPort, type StockPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { DemandService, ON_ORDER_STATUSES } from '../demand/demand.service';
import { LinkedDocsService } from '../shared/linked-docs.service';
import { DOC_LINK, PUR_ENTITY } from '../shared/purchase.constants';
import { allowedRequestActions, type RequestStatus } from './request.rules';
import type { RequestListQueryDto } from './dto/request.dto';

export const REQUEST_STATUSES = ['DRAFT', 'SUBMITTED', 'CONVERTED', 'REJECTED'] as const;

export type RequestWithLines = PurRequest & { lines: PurRequestLine[] };

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Reading purchase requests: the list (P05) and the request with everything its screen shows (P06). */
@Injectable()
export class RequestsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly linkedDocs: LinkedDocsService,
    private readonly permissions: PermissionRegistry,
    private readonly demand: DemandService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
    @Inject(SALES_DEMAND_PORT) private readonly sales: SalesDemandPort,
  ) {}

  async load(tenantId: string, id: string): Promise<RequestWithLines> {
    const request = await this.prisma.purRequest.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!request) throw new NotFoundError('Purchase request');
    return request;
  }

  actions(ctx: RequestContext, request: Pick<PurRequest, 'status' | 'isMigrated' | 'requestedByCode'>) {
    return allowedRequestActions({
      status: request.status as RequestStatus,
      isMigrated: request.isMigrated,
      isRequester: request.requestedByCode === ctx.user.code,
      can: (p) => this.permissions.has(ctx.user.roles, p),
    });
  }

  // ── List (P05) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: RequestListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', neededBy: 'neededBy', estValue: 'estValue' }, '-docDate');
    const q = query.q?.trim();
    const requester = query.requester?.trim();
    const docDate = dateRange(query);
    const base: Prisma.PurRequestWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.department && { department: query.department }),
      ...(query.branch && { branchCode: query.branch }),
      ...(requester && { requestedByName: { contains: requester } }),
      ...(q && { OR: [{ docNo: { contains: q } }, { summary: { contains: q } }, { requestedByName: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, REQUEST_STATUSES);
    const where: Prisma.PurRequestWhereInput = { ...base, ...(status && { status }) };

    const [rows, total, grouped, departments] = await Promise.all([
      this.prisma.purRequest.findMany({ where, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.purRequest.count({ where }),
      this.prisma.purRequest.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.purRequest.findMany({ where: { tenantId: ctx.tenantId, department: { not: null } }, distinct: ['department'], select: { department: true } }),
    ]);
    const turnedInto = await this.turnedInto(ctx.tenantId, rows.map((r) => r.id));

    return {
      ...toListResponse(
        rows.map((r) => ({
          id: r.id,
          docNo: r.docNo,
          docDate: isoDate(r.docDate),
          requestedByName: r.requestedByName,
          requesterTitle: r.requesterTitle,
          department: r.department,
          branchCode: r.branchCode,
          summary: r.summary,
          neededBy: isoDate(r.neededBy),
          estValue: toMoney(r.estValue),
          turnedInto: turnedInto.get(r.id) ?? [],
          rejectReason: r.rejectReason,
          status: r.status,
          isMigrated: r.isMigrated,
          allowedActions: this.actions(ctx, r),
          version: r.version,
        })),
        total,
        query,
        buildStatusCounts(grouped, REQUEST_STATUSES),
      ),
      departments: departments.map((d) => d.department!).sort(),
    };
  }

  /**
   * "Turned into": each document a request became, with the PO an RFQ was awarded to:
   * [[RFQ-0002, PO-0005]], [[PO-0004]], or [[PO-0007], [PO-0008]] when split by supplier.
   */
  async turnedInto(tenantId: string, requestIds: string[]) {
    type Ref = { type: string; id: string | null; docNo: string };
    const result = new Map<string, Ref[][]>();
    if (!requestIds.length) return result;
    const first = await this.prisma.sysDocLink.findMany({
      where: { tenantId, fromType: PUR_ENTITY.REQUEST, fromId: { in: requestIds }, linkType: DOC_LINK.CONVERTED },
      orderBy: { toNo: 'asc' },
    });
    const rfqIds = first.filter((l) => l.toType === PUR_ENTITY.RFQ && l.toId).map((l) => l.toId!);
    const awarded = rfqIds.length
      ? await this.prisma.sysDocLink.findMany({ where: { tenantId, fromType: PUR_ENTITY.RFQ, fromId: { in: rfqIds }, linkType: DOC_LINK.AWARDED } })
      : [];
    for (const link of first) {
      const chain: Ref[] = [{ type: link.toType, id: link.toId, docNo: link.toNo }];
      for (const a of awarded.filter((x) => x.fromId === link.toId)) chain.push({ type: a.toType, id: a.toId, docNo: a.toNo });
      result.set(link.fromId!, [...(result.get(link.fromId!) ?? []), chain]);
    }
    return result;
  }

  // ── Detail (P06) ──────────────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const request = await this.load(ctx.tenantId, id);
    const codes = [...new Set(request.lines.map((l) => l.itemCode))];
    const [branches, links, activity, insights] = await Promise.all([
      this.masterData.listBranches(ctx.tenantId),
      this.linkedDocs.forDocument(ctx.tenantId, PUR_ENTITY.REQUEST, request.id),
      this.activity.listFor(ctx.tenantId, PUR_ENTITY.REQUEST, request.id),
      // A decided request shows prices as they were when Purchasing decided; an open one shows the latest.
      this.insights(ctx.tenantId, codes, request.decidedAt ?? undefined),
    ]);
    return {
      id: request.id,
      docNo: request.docNo,
      docDate: isoDate(request.docDate),
      status: request.status,
      isMigrated: request.isMigrated,
      version: request.version,
      requestedBy: { code: request.requestedByCode, name: request.requestedByName, title: request.requesterTitle },
      department: request.department,
      branch: { code: request.branchCode, name: branches.find((b) => b.code === request.branchCode)?.name ?? request.branchCode },
      neededBy: isoDate(request.neededBy),
      priority: request.priority,
      source: request.source,
      reason: request.reason,
      summary: request.summary,
      estValue: toMoney(request.estValue),
      rejectReason: request.rejectReason,
      submittedAt: request.submittedAt?.toISOString() ?? null,
      decidedAt: request.decidedAt?.toISOString() ?? null,
      lines: request.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        itemCode: l.itemCode,
        itemName: l.itemName,
        uomCode: l.uomCode,
        taxCode: l.taxCode,
        qty: toQty(l.qty),
        lastPrice: toPrice(l.unitPrice),
        estAmount: toMoney(l.estAmount),
        preferredSupplierCode: l.preferredSupplierCode,
        preferredSupplierName: l.preferredSupplierName,
      })),
      insights,
      turnedInto: (await this.turnedInto(ctx.tenantId, [request.id])).get(request.id) ?? [],
      links,
      activity,
      allowedActions: this.actions(ctx, request),
    };
  }

  /**
   * The right-hand panel per item (PurRequestForm.html): stock today, open sales orders using it,
   * and the last three purchase orders (up to `pricesAsOf` when given).
   */
  private async insights(tenantId: string, itemCodes: string[], pricesAsOf?: Date) {
    const upTo = pricesAsOf ? { lte: pricesAsOf } : undefined;
    if (!itemCodes.length) return {};
    const [items, stock, sales, openLines, history, poLines, lastPrices] = await Promise.all([
      this.masterData.findItems(tenantId, itemCodes),
      this.stock.listStock(tenantId, itemCodes),
      this.sales.listOpenDemand(tenantId, itemCodes),
      this.prisma.purPurchaseOrderLine.findMany({
        where: { tenantId, itemCode: { in: itemCodes }, po: { status: { in: [...ON_ORDER_STATUSES] } } },
        select: { itemCode: true, orderedQty: true, receivedQty: true, cancelledQty: true },
      }),
      this.prisma.purPriceHistory.findMany({
        where: { tenantId, itemCode: { in: itemCodes }, docNo: { not: null }, ...(upTo && { docDate: upTo }) },
        orderBy: { docDate: 'desc' },
      }),
      this.prisma.purPurchaseOrderLine.findMany({
        where: { tenantId, itemCode: { in: itemCodes }, po: { releasedAt: { not: null }, ...(upTo && { docDate: upTo }) } },
        select: { itemCode: true, orderedQty: true, unitPrice: true, po: { select: { docNo: true, docDate: true, supplierName: true } } },
      }),
      this.demand.lastPrices(tenantId, itemCodes),
    ]);

    const out: Record<string, unknown> = {};
    for (const code of itemCodes) {
      const item = items.find((i) => i.code === code);
      const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));
      const past = [
        ...history.filter((h) => h.itemCode === code).map((h) => ({ docNo: h.docNo!, docDate: h.docDate, supplierName: h.supplierName, qty: h.qty, unitPrice: h.unitPrice, note: h.note })),
        ...poLines.filter((l) => l.itemCode === code).map((l) => ({ docNo: l.po.docNo, docDate: l.po.docDate, supplierName: l.po.supplierName, qty: l.orderedQty, unitPrice: l.unitPrice, note: null })),
      ]
        .sort((a, b) => b.docDate.getTime() - a.docDate.getTime() || b.docNo.localeCompare(a.docNo))
        .slice(0, 3);
      out[code] = {
        uomCode: item?.uomCode ?? null,
        stock: {
          onHand: toQty(sum(stock.filter((s) => s.itemCode === code).map((s) => dec(s.onHand)))),
          usedLast30Days: toQty(sum(stock.filter((s) => s.itemCode === code).map((s) => dec(s.usedLast30Days)))),
          reorderLevel: item?.reorderLevel ?? null,
          onOrder: toQty(sum(openLines.filter((l) => l.itemCode === code).map((l) => l.orderedQty.sub(l.receivedQty).sub(l.cancelledQty)))),
        },
        salesOrders: sales.filter((s) => s.itemCode === code).map((s) => ({ soNo: s.soNo, customerName: s.customerName, qty: s.qty, kind: s.kind })),
        lastPrice: lastPrices.get(code) ? toPrice(lastPrices.get(code)!) : null,
        priceHistory: past.map((p) => ({
          docNo: p.docNo,
          docDate: isoDate(p.docDate),
          supplierName: p.supplierName,
          qty: p.qty === null ? null : toQty(p.qty),
          unitPrice: toPrice(p.unitPrice),
          note: p.note,
        })),
      };
    }
    return out;
  }
}
