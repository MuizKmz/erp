import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SalSalesOrder, SalSalesOrderLine } from '@prisma/client';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty, toRate } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { CreditService, type CreditOutcome } from '../shared/credit.service';
import { SalesLinkedDocsService } from '../shared/linked-docs.service';
import { CREDIT_DOC, SAL_ENTITY } from '../shared/sales.constants';
import type { OrderListQueryDto } from './dto/order.dto';
import { allowedOrderActions, creditLabel, SO_STATUSES, statusLabel, stockShortfall, type SoStatus } from './order.rules';

export type OrderWithLines = SalSalesOrder & { lines: SalSalesOrderLine[] };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));
const open = (l: SalSalesOrderLine) => {
  const q = l.orderedQty.sub(l.deliveredQty).sub(l.cancelledQty);
  return q.gt(0) ? q : dec(0);
};

/** Reading sales orders: the list (S10) and one order with its credit check and approval (S11, S12). */
@Injectable()
export class OrdersQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly approvals: ApprovalsService,
    private readonly permissions: PermissionRegistry,
    private readonly credit: CreditService,
    private readonly linked: SalesLinkedDocsService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
  ) {}

  async load(tenantId: string, id: string): Promise<OrderWithLines> {
    const row = await this.prisma.salSalesOrder.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Sales order');
    return row;
  }

  /** The credit check as it stands now, for a draft (S12 panel and the Release button). */
  async liveCredit(ctx: RequestContext, order: OrderWithLines): Promise<CreditOutcome | null> {
    if (order.status !== 'DRAFT' || order.isMigrated) return null;
    const customer = await this.masterData.findCustomer(ctx.tenantId, order.customerCode);
    if (!customer) return null;
    return this.credit.check(ctx.tenantId, {
      customer, docType: CREDIT_DOC.SALES_ORDER, thisDocument: toMoney(order.total), branchCode: order.branchCode, excludeOrderId: order.id,
    });
  }

  actions(ctx: RequestContext, order: OrderWithLines, credit: CreditOutcome | null) {
    const has = (p: string) => this.permissions.has(ctx.user.roles, p);
    return allowedOrderActions({
      status: order.status as SoStatus,
      isMigrated: order.isMigrated,
      creditNeedsApproval: credit ? credit.check.action === 'APPROVAL' : order.creditResult === 'OVER_LIMIT',
      creditBlocked: credit ? credit.check.action === 'BLOCK' : false,
      approved: Boolean(order.approvedAt),
      hasOpenBalance: order.lines.some((l) => open(l).gt(0)),
      hasToInvoice: order.lines.some((l) => l.deliveredQty.gt(l.invoicedQty)),
      canEdit: has(P.ORDER_EDIT),
      canRelease: has(P.ORDER_RELEASE),
      canDeliver: has(P.DELIVERY_EDIT),
      canInvoice: has(P.INVOICE_EDIT),
      canProforma: has(P.PROFORMA_EDIT),
      canCancel: has(P.CANCEL_ORDER_EDIT),
    });
  }

  // ── List (S10) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: OrderListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', total: 'total', customer: 'customerName' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const base: Prisma.SalSalesOrderWhereInput = {
      tenantId: ctx.tenantId,
      revision: 0,
      ...(docDate && { docDate }),
      ...(query.customer?.trim() && { customerName: { contains: query.customer.trim() } }),
      ...(query.agent && { agentCode: query.agent }),
      ...(query.branch && { branchCode: query.branch }),
      ...(q && { OR: [{ docNo: { contains: q } }, { customerName: { contains: q } }, { customerPoRef: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, SO_STATUSES);
    const where: Prisma.SalSalesOrderWhereInput = { ...base, ...(status && { status }) };
    const [rows, total, grouped] = await Promise.all([
      this.prisma.salSalesOrder.findMany({ where, include: { lines: true }, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.salSalesOrder.count({ where }),
      this.prisma.salSalesOrder.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const invoiced = await this.prisma.salInvoice.groupBy({
      by: ['salesOrderNo'],
      where: { tenantId: ctx.tenantId, status: 'RELEASED', salesOrderNo: { in: rows.map((r) => r.docNo) } },
      _sum: { total: true },
    });
    return toListResponse(
      rows.map((o) => ({
        id: o.id,
        docNo: o.docNo,
        docDate: iso(o.docDate),
        customerName: o.customerName,
        isBuyToOrder: o.orderTypeCode === 'BTO',
        agentName: o.agentName,
        total: toMoney(o.total),
        orderedQty: toQty(sum(o.lines.map((l) => l.orderedQty))),
        deliveredQty: toQty(sum(o.lines.map((l) => l.deliveredQty))),
        invoicedAmount: toMoney(invoiced.find((i) => i.salesOrderNo === o.docNo)?._sum.total ?? 0),
        status: o.status,
        statusLabel: statusLabel(o.status as SoStatus, o.balanceCancelled),
        balanceCancelled: o.balanceCancelled,
        credit: creditLabel(o.creditResult, o.status as SoStatus),
        overLimit: o.creditResult === 'OVER_LIMIT' || o.creditResult === 'BLOCKED',
        isMigrated: o.isMigrated,
        version: o.version,
        // The list does not run a live credit check; the stored result decides whether Release is offered.
        allowedActions: this.actions(ctx, o, null),
      })),
      total,
      query,
      buildStatusCounts(grouped, SO_STATUSES),
    );
  }

  // ── One order (S11, S12) ──────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const order = await this.load(ctx.tenantId, id);
    const codes = order.lines.map((l) => l.itemCode);
    const [credit, activity, links, approvals, branches, taxes, priceLists, items, stock, customer] = await Promise.all([
      this.liveCredit(ctx, order),
      this.activity.listFor(ctx.tenantId, SAL_ENTITY.ORDER, order.id),
      this.linked.forDocument(ctx.tenantId, SAL_ENTITY.ORDER, order.id),
      this.approvals.listForEntity(ctx.tenantId, SAL_ENTITY.ORDER, order.id),
      this.masterData.listBranches(ctx.tenantId),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.masterData.listPriceLists(ctx.tenantId),
      this.masterData.findItems(ctx.tenantId, codes),
      this.stock.listStock(ctx.tenantId, codes),
      this.masterData.findCustomer(ctx.tenantId, order.customerCode),
    ]);
    const taxName = (code: string) => taxes.find((t) => t.code === code)?.name ?? code;
    const latest = approvals[0] ?? null;
    const decidedStep = latest?.steps.find((s) => s.decidedAt);
    const waitingStep = latest?.status === 'PENDING' ? latest.steps.find((s) => s.status === 'WAITING') : null;

    // Stock: live for drafts (warns only), and what was logged at release for released orders.
    const onHand = (code: string) => sum(stock.filter((s) => s.itemCode === code && s.warehouseCode === order.warehouseCode).map((s) => dec(s.onHand)));
    const shortfall = stockShortfall(order.lines.map((l) => ({
      itemCode: l.itemCode, qty: l.orderedQty, onHand: onHand(l.itemCode), isStock: items.find((i) => i.code === l.itemCode)?.type === 'STOCK' && !l.isBuyToOrder,
    })));
    const releaseNote = activity.find((a) => a.action === 'stock_warning')?.message ?? null;
    const taxLines = [...new Set(order.lines.map((l) => l.taxCode))].map((code) => ({
      code, name: taxName(code), amount: toMoney(sum(order.lines.filter((l) => l.taxCode === code).map((l) => l.taxAmount))),
    }));
    const quotation = order.quotationId ? await this.prisma.salQuotation.findFirst({ where: { id: order.quotationId }, select: { id: true, docNo: true } }) : null;

    return {
      id: order.id,
      docNo: order.docNo,
      revision: order.revision,
      docDate: iso(order.docDate),
      status: order.status,
      statusLabel: statusLabel(order.status as SoStatus, order.balanceCancelled),
      balanceCancelled: order.balanceCancelled,
      isMigrated: order.isMigrated,
      version: order.version,
      customer: { code: order.customerCode, name: order.customerName, active: customer?.status === 'ACTIVE' },
      contactName: order.contactName,
      branch: { code: order.branchCode, name: branches.find((b) => b.code === order.branchCode)?.name ?? order.branchCode },
      agent: { code: order.agentCode, name: order.agentName },
      warehouseCode: order.warehouseCode,
      deliveryWantedBy: iso(order.deliveryWantedBy),
      promisedDate: iso(order.promisedDate),
      currency: order.currency,
      taxMode: order.taxMode,
      creditTermDays: order.creditTermDays,
      priceList: { code: order.priceListCode, name: priceLists.find((p) => p.code === order.priceListCode)?.name ?? order.priceListCode },
      customerPoRef: order.customerPoRef,
      project: order.project,
      deliveryAddress: order.deliveryAddress,
      orderTypeCode: order.orderTypeCode,
      quotation: quotation ? { id: quotation.id, no: quotation.docNo } : null,
      enquiryNo: order.enquiryNo,
      lines: order.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        itemCode: l.itemCode,
        itemName: l.itemName,
        uomCode: l.uomCode,
        taxCode: l.taxCode,
        taxName: taxName(l.taxCode),
        taxRate: toRate(l.taxRate),
        listPrice: l.listPrice ? toPrice(l.listPrice) : null,
        unitPrice: toPrice(l.unitPrice),
        discountPct: l.discountPct.toFixed(2),
        orderedQty: toQty(l.orderedQty),
        deliveredQty: toQty(l.deliveredQty),
        invoicedQty: toQty(l.invoicedQty),
        cancelledQty: toQty(l.cancelledQty),
        balanceQty: toQty(open(l)),
        grossAmount: toMoney(l.grossAmount),
        discountAmount: toMoney(l.discountAmount),
        amount: toMoney(l.amount),
        taxAmount: toMoney(l.taxAmount),
        isBuyToOrder: l.isBuyToOrder,
        purchaseOrderNo: l.purchaseOrderNo,
      })),
      totals: { subtotal: toMoney(order.subtotal), discountTotal: toMoney(order.discountTotal), taxLines, rounding: toMoney(order.rounding), total: toMoney(order.total) },
      quantities: {
        ordered: toQty(sum(order.lines.map((l) => l.orderedQty))),
        delivered: toQty(sum(order.lines.map((l) => l.deliveredQty))),
        uomCode: order.lines[0]?.uomCode ?? '',
      },
      credit: {
        result: credit?.check.result ?? order.creditResult,
        /** For a draft: the check now. Otherwise what was stored at save ("Credit at save"). */
        snapshot: credit?.snapshot ?? order.creditSnapshot,
        live: Boolean(credit),
        needsApproval: credit ? credit.check.action === 'APPROVAL' && !order.approvedAt : false,
        blocked: credit ? credit.check.action === 'BLOCK' : false,
        approverRole: credit?.approverRole ?? null,
      },
      approval: {
        state: !latest ? 'NONE' : latest.status === 'PENDING' ? 'PENDING' : latest.status === 'APPROVED' ? 'APPROVED' : latest.status === 'REJECTED' ? 'REJECTED' : 'NONE',
        reason: latest?.reason ?? null,
        note: latest?.requesterNote ?? null,
        requestedBy: latest?.requestedByName ?? null,
        requestedAt: latest?.createdAt ?? null,
        waitingFor: waitingStep ? (waitingStep.approverName ?? waitingStep.approverRole) : null,
        decidedBy: decidedStep?.decidedByName ?? null,
        decidedAt: decidedStep?.decidedAt ?? null,
        comment: decidedStep?.comment ?? null,
      },
      stock: {
        draftWarning: order.status === 'DRAFT' ? shortfall : null,
        releaseNote,
        inventoryConnected: this.stock.connected,
      },
      releasedAt: order.releasedAt?.toISOString() ?? null,
      releasedByName: order.releasedByName,
      links,
      activity,
      allowedActions: this.actions(ctx, order, credit),
    };
  }
}
