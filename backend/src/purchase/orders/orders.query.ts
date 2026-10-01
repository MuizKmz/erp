import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurPurchaseOrder, PurPurchaseOrderLine } from '@prisma/client';
import { SALES_DEMAND_PORT, type SalesDemandPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty, toRate } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import {
  buildStatusCounts,
  dateRange,
  pageArgs,
  parseSort,
  statusFromKey,
  toListResponse,
  toOrderBy,
} from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { poApprovalNeed, type PoApprovalNeed } from '../shared/approval-limit.rules';
import { LinkedDocsService } from '../shared/linked-docs.service';
import { PUR_ENTITY, SYSTEM_USER } from '../shared/purchase.constants';
import { PurchaseSettingsService } from '../shared/purchase-settings.service';
import type { OrderListQueryDto } from './dto/order.dto';
import { allowedOrderActions, orderStatusLabel, rfqRequirement, type OrderStatus, type RfqCheck } from './order.rules';

export const ORDER_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'PARTIAL', 'DONE', 'CANCELLED'] as const;

export type OrderWithLines = PurPurchaseOrder & { lines: PurPurchaseOrderLine[] };

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const sumQty = (lines: PurPurchaseOrderLine[], pick: (l: PurPurchaseOrderLine) => Prisma.Decimal) =>
  lines.reduce((s, l) => s.add(pick(l)), dec(0));

export const openQtyOf = (lines: PurPurchaseOrderLine[]) =>
  sumQty(lines, (l) => l.orderedQty.sub(l.receivedQty).sub(l.cancelledQty));

/**
 * Reading purchase orders: the list (P09), the detail with everything the form shows (P10), and the
 * approval check behind "Send for approval" (P11). No writes here.
 */
@Injectable()
export class OrdersQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PurchaseSettingsService,
    private readonly approvals: ApprovalsService,
    private readonly activity: ActivityService,
    private readonly linkedDocs: LinkedDocsService,
    private readonly permissions: PermissionRegistry,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(SALES_DEMAND_PORT) private readonly sales: SalesDemandPort,
  ) {}

  async load(tenantId: string, id: string): Promise<OrderWithLines> {
    const order = await this.prisma.purPurchaseOrder.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!order) throw new NotFoundError('Purchase order');
    return order;
  }

  // ── List (P09) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: OrderListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', supplier: 'supplierName', total: 'total' }, '-docDate');
    const q = query.q?.trim();
    const supplier = query.supplier?.trim();
    const docDate = dateRange(query);
    const base: Prisma.PurPurchaseOrderWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.buyer && { buyerCode: query.buyer }),
      ...(query.branch && { branchCode: query.branch }),
      ...(supplier && { OR: [{ supplierName: { contains: supplier } }, { supplierCode: { contains: supplier } }] }),
      ...(q && { AND: [{ OR: [{ docNo: { contains: q } }, { supplierName: { contains: q } }, { sourceNo: { contains: q } }] }] }),
    };
    const status = statusFromKey(query.status, ORDER_STATUSES);
    const where: Prisma.PurPurchaseOrderWhereInput = { ...base, ...(status && { status }) };

    const [rows, total, grouped, sums] = await Promise.all([
      this.prisma.purPurchaseOrder.findMany({
        where,
        include: { lines: true, invoices: { select: { docNo: true, status: true }, where: { status: { in: ['DRAFT', 'TO_MATCH', 'PENDING_APPROVAL'] } } } },
        orderBy: [toOrderBy(sort), { docNo: sort.direction }],
        ...pageArgs(query),
      }),
      this.prisma.purPurchaseOrder.count({ where }),
      this.prisma.purPurchaseOrder.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.purPurchaseOrder.aggregate({ where, _sum: { total: true } }),
    ]);

    const pending = rows.filter((r) => r.status === 'PENDING_APPROVAL').map((r) => r.id);
    const [waitingFor, rules, branches] = await Promise.all([
      this.waitingApprovers(ctx.tenantId, pending),
      this.settings.poLimitRules(ctx.tenantId),
      this.masterData.listBranches(ctx.tenantId),
    ]);
    // Per-row actions so the list buttons (Send for approval, Release, Delete draft) only enable when they apply.
    const rowActions = (o: OrderWithLines) => {
      const branchName = branches.find((b) => b.code === o.branchCode)?.name ?? o.branchCode;
      return this.actions(ctx, o, poApprovalNeed({ branchCode: o.branchCode, branchName, total: o.total, rules }));
    };

    const items = rows.map((o) => {
      const ordered = sumQty(o.lines, (l) => l.orderedQty);
      const openInvoice = o.invoices[0];
      return {
        id: o.id,
        docNo: o.docNo,
        docDate: isoDate(o.docDate),
        supplierCode: o.supplierCode,
        supplierName: o.supplierName,
        branchCode: o.branchCode,
        buyerName: o.buyerName,
        source: this.source(o),
        total: toMoney(o.total),
        orderedQty: toQty(ordered),
        receivedQty: toQty(sumQty(o.lines, (l) => l.receivedQty)),
        billedQty: toQty(sumQty(o.lines, (l) => l.billedQty)),
        openInvoice: openInvoice
          ? { docNo: openInvoice.docNo, state: openInvoice.status === 'PENDING_APPROVAL' ? 'waiting' : openInvoice.status === 'TO_MATCH' ? 'to match' : 'draft' }
          : null,
        status: o.status,
        statusLabel: orderStatusLabel(o.status, { balanceCancelled: o.balanceCancelled, approved: Boolean(o.approvedAt) }),
        approved: o.status === 'DRAFT' && Boolean(o.approvedAt),
        isMigrated: o.isMigrated,
        waitingFor: waitingFor.get(o.id) ?? null,
        allowedActions: rowActions(o),
        version: o.version,
      };
    });

    return {
      ...toListResponse(items, total, query, buildStatusCounts(grouped, ORDER_STATUSES)),
      summary: { count: total, total: toMoney(sums._sum.total ?? 0) },
    };
  }

  /** "Buyer", "RFQ-0002", "PRQ-0004", "SO-0003 · auto", "Migrated" */
  source(o: PurPurchaseOrder): { type: string; no: string | null; id: string | null; label: string } {
    switch (o.sourceType) {
      case 'RFQ':
        return { type: 'RFQ', no: o.sourceNo, id: o.rfqId, label: o.sourceNo ?? 'RFQ' };
      case 'REQUEST':
        return { type: 'REQUEST', no: o.sourceNo, id: o.requestId, label: o.sourceNo ?? 'Request' };
      case 'SALES_ORDER':
        return { type: 'SALES_ORDER', no: o.sourceNo, id: null, label: `${o.sourceNo}${o.createdBy === SYSTEM_USER.code ? ' · auto' : ''}` };
      case 'MIGRATED':
        return { type: 'MIGRATED', no: o.sourceNo, id: null, label: 'Migrated' };
      default:
        return { type: 'BUYER', no: null, id: null, label: 'Buyer' };
    }
  }

  /** Names of the approvers each pending PO waits for: "Ahmad Zaki". */
  private async waitingApprovers(tenantId: string, orderIds: string[]): Promise<Map<string, string>> {
    if (!orderIds.length) return new Map();
    const requests = await this.prisma.sysApprovalRequest.findMany({
      where: { tenantId, entityType: PUR_ENTITY.ORDER, entityId: { in: orderIds }, status: 'PENDING' },
      include: { steps: { where: { status: 'WAITING' } } },
    });
    return new Map(requests.map((r) => [r.entityId, r.steps.map((s) => s.approverName ?? s.approverRole).join(', ')]));
  }

  // ── Approval need and RFQ rule ────────────────────────────────────────────

  async approvalNeed(tenantId: string, order: { branchCode: string; total: Prisma.Decimal | string }): Promise<PoApprovalNeed> {
    const [rules, branches] = await Promise.all([this.settings.poLimitRules(tenantId), this.masterData.listBranches(tenantId)]);
    const branchName = branches.find((b) => b.code === order.branchCode)?.name ?? order.branchCode;
    return poApprovalNeed({ branchCode: order.branchCode, branchName, total: order.total, rules });
  }

  async rfqCheck(tenantId: string, order: OrderWithLines, today: string): Promise<RfqCheck> {
    const settings = await this.settings.settings(tenantId);
    const contracts = await this.masterData.listContractPrices(tenantId, {
      supplierCode: order.supplierCode,
      itemCodes: order.lines.map((l) => l.itemCode),
      onDate: today,
    });
    const onContract = new Set(contracts.map((c) => c.itemCode));
    const replies = order.rfqId
      ? await this.prisma.purRfqSupplier.count({ where: { tenantId, rfqId: order.rfqId, status: 'REPLIED' } })
      : null;
    return rfqRequirement({
      total: order.total,
      rfqRequiredOn: settings.rfqRequiredOn,
      rfqRequiredOver: settings.rfqRequiredOver,
      minReplies: settings.rfqMinReplies,
      allLinesOnContract: order.lines.length > 0 && order.lines.every((l) => onContract.has(l.itemCode)),
      rfqReplies: replies,
    });
  }

  actions(ctx: RequestContext, order: OrderWithLines, need: PoApprovalNeed) {
    return allowedOrderActions({
      status: order.status as OrderStatus,
      isMigrated: order.isMigrated,
      approvalRequired: order.status === 'DRAFT' ? need.required : order.approvalRequired,
      approved: Boolean(order.approvedAt),
      openQty: openQtyOf(order.lines),
      can: (p) => this.permissions.has(ctx.user.roles, p),
    });
  }

  // ── Detail (P10) ──────────────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const order = await this.load(ctx.tenantId, id);
    const [need, taxes, branches, links, activity, history, salesOrder] = await Promise.all([
      this.approvalNeed(ctx.tenantId, order),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.masterData.listBranches(ctx.tenantId),
      this.linkedDocs.forDocument(ctx.tenantId, PUR_ENTITY.ORDER, order.id),
      this.activity.listFor(ctx.tenantId, PUR_ENTITY.ORDER, order.id),
      this.approvals.listForEntity(ctx.tenantId, PUR_ENTITY.ORDER, order.id),
      order.salesOrderNo ? this.sales.findSalesOrder(ctx.tenantId, order.salesOrderNo) : Promise.resolve(null),
    ]);
    const supplier = await this.masterData.findSupplier(ctx.tenantId, order.supplierCode);
    const taxName = (code: string) => taxes.find((t) => t.code === code)?.name ?? code;

    // Tax rows of the totals box, one per tax code ("SST 10%  400.00")
    const taxLines = new Map<string, Prisma.Decimal>();
    for (const l of order.lines) taxLines.set(l.taxCode, (taxLines.get(l.taxCode) ?? dec(0)).add(l.taxAmount));

    const ordered = sumQty(order.lines, (l) => l.orderedQty);
    const received = sumQty(order.lines, (l) => l.receivedQty);
    const open = openQtyOf(order.lines);
    const units = [...new Set(order.lines.map((l) => l.uomCode))];

    return {
      id: order.id,
      docNo: order.docNo,
      docDate: isoDate(order.docDate),
      status: order.status,
      statusLabel: orderStatusLabel(order.status, { balanceCancelled: order.balanceCancelled, approved: Boolean(order.approvedAt) }),
      balanceCancelled: order.balanceCancelled,
      isMigrated: order.isMigrated,
      version: order.version,
      branch: { code: order.branchCode, name: branches.find((b) => b.code === order.branchCode)?.name ?? order.branchCode },
      poTypeCode: order.poTypeCode,
      supplier: { code: order.supplierCode, name: order.supplierName, email: supplier?.email ?? null, status: supplier?.status ?? null },
      buyer: { code: order.buyerCode, name: order.buyerName },
      warehouse: { code: order.warehouseCode, name: order.warehouseName },
      expectedDate: isoDate(order.expectedDate),
      promisedDate: isoDate(order.promisedDate),
      supplierSays: order.supplierSays,
      paymentTermDays: order.paymentTermDays,
      currency: order.currency,
      taxMode: order.taxMode,
      supplierQuoteRef: order.supplierQuoteRef,
      noteToSupplier: order.noteToSupplier,
      remarks: order.remarks,
      source: this.source(order),
      draftedBySystem: order.createdBy === SYSTEM_USER.code,
      createdAt: order.createdAt.toISOString(),
      salesOrder: order.salesOrderNo
        ? { no: order.salesOrderNo, customerName: order.customerName ?? salesOrder?.customerName ?? null, total: salesOrder?.soTotal ?? null }
        : null,
      lines: order.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        itemId: l.itemId,
        itemCode: l.itemCode,
        itemName: l.itemName,
        uomCode: l.uomCode,
        taxCode: l.taxCode,
        taxName: taxName(l.taxCode),
        taxRate: toRate(l.taxRate),
        unitPrice: toPrice(l.unitPrice),
        orderedQty: toQty(l.orderedQty),
        receivedQty: toQty(l.receivedQty),
        billedQty: toQty(l.billedQty),
        returnedQty: toQty(l.returnedQty),
        cancelledQty: toQty(l.cancelledQty),
        openQty: toQty(l.orderedQty.sub(l.receivedQty).sub(l.cancelledQty)),
        amount: toMoney(l.amount),
        taxAmount: toMoney(l.taxAmount),
        salesOrderNo: l.salesOrderNo,
      })),
      totals: {
        subtotal: toMoney(order.subtotal),
        taxTotal: toMoney(order.taxTotal),
        total: toMoney(order.total),
        taxLines: [...taxLines].map(([code, amount]) => ({ code, name: taxName(code), amount: toMoney(amount) })),
      },
      quantities: {
        ordered: toQty(ordered),
        received: toQty(received),
        open: toQty(open),
        uomCode: units.length === 1 ? units[0]! : null,
      },
      approval: this.approvalCard(order, need, history),
      links,
      activity,
      allowedActions: this.actions(ctx, order, need),
    };
  }

  /** The "Approval" side card: not needed, needed, waiting, approved or rejected — and why. */
  private approvalCard(
    order: OrderWithLines,
    need: PoApprovalNeed,
    history: Awaited<ReturnType<ApprovalsService['listForEntity']>>,
  ) {
    const latest = history[0];
    const steps = (latest?.steps ?? []).map((s) => ({
      approverName: s.approverName ?? s.approverRole,
      approverRole: s.approverRole,
      status: s.status,
      decidedByName: s.decidedByName,
      decidedAt: s.decidedAt,
      comment: s.comment,
    }));
    const released = order.releasedAt ? { byName: order.releasedByName, at: order.releasedAt.toISOString() } : null;

    let state: 'NOT_NEEDED' | 'NEEDED' | 'PENDING' | 'APPROVED' | 'REJECTED';
    if (order.status === 'PENDING_APPROVAL') state = 'PENDING';
    else if (order.approvedAt) state = 'APPROVED';
    else if (order.status === 'DRAFT' && latest?.status === 'REJECTED') state = 'REJECTED';
    else if (order.status === 'DRAFT') state = need.required ? 'NEEDED' : 'NOT_NEEDED';
    else state = order.approvalRequired ? 'APPROVED' : 'NOT_NEEDED';

    const rejected = latest?.status === 'REJECTED' ? latest.steps.find((s) => s.status === 'REJECTED') : undefined;
    return {
      state,
      reason: order.status === 'DRAFT' || !order.approvalRequired ? need.reason : (latest?.reason ?? need.reason),
      waitingFor: order.status === 'PENDING_APPROVAL' ? steps.filter((s) => s.status === 'WAITING').map((s) => s.approverName).join(', ') : null,
      requestNote: latest?.requesterNote ?? null,
      steps: latest && latest.status !== 'CANCELLED' ? steps : [],
      rejection: rejected ? { byName: rejected.decidedByName, at: rejected.decidedAt, comment: rejected.comment } : null,
      released,
    };
  }

  // ── Approval check (P11) ──────────────────────────────────────────────────

  async approvalCheck(ctx: RequestContext, id: string, today: string) {
    const order = await this.load(ctx.tenantId, id);
    const [need, rfq, users, salesOrder] = await Promise.all([
      this.approvalNeed(ctx.tenantId, order),
      this.rfqCheck(ctx.tenantId, order, today),
      this.masterData.listUsers(ctx.tenantId),
      order.salesOrderNo ? this.sales.findSalesOrder(ctx.tenantId, order.salesOrderNo) : Promise.resolve(null),
    ]);
    const first = need.steps[0];
    // Approvers to choose from: active users with the step's role in the PO's branch, never the buyer.
    const candidates = first
      ? users
          .filter((u) => u.isActive && u.roles.includes(first.approverRole) && u.branchCodes.includes(order.branchCode) && u.code !== order.buyerCode)
          .map((u) => ({ code: u.code, name: u.name, role: first.approverRole }))
      : [];

    // "20 × custom 3-seater sofa" for one line, else "3 lines"
    const firstLine = order.lines[0];
    const what =
      order.lines.length === 1 && firstLine
        ? `${dec(firstLine.orderedQty).toDecimalPlaces(4).toString()} × ${firstLine.itemName.charAt(0).toLowerCase()}${firstLine.itemName.slice(1)}`
        : `${order.lines.length} lines`;

    const margin =
      salesOrder && dec(salesOrder.soTotal).gt(0)
        ? dec(salesOrder.soTotal).sub(order.total).div(salesOrder.soTotal).mul(100).toDecimalPlaces(0).toString()
        : null;

    return {
      docNo: order.docNo,
      version: order.version,
      required: need.required,
      reason: need.reason,
      approver: first ? { role: first.approverRole, defaultCode: first.approverCode, defaultName: first.approverName } : null,
      candidates,
      second: need.second,
      steps: need.steps,
      rfq,
      summary: {
        supplierName: order.supplierName,
        what,
        total: toMoney(order.total),
        salesOrder: salesOrder ? { no: salesOrder.soNo, total: salesOrder.soTotal, marginPct: margin } : null,
      },
    };
  }
}
