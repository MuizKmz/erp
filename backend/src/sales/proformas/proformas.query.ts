import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SalProforma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { dateRange, parseSort } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { DepositsService } from '../shared/deposits.service';
import { SalesLinkedDocsService } from '../shared/linked-docs.service';
import { SAL_ENTITY } from '../shared/sales.constants';
import type { ProformaListQueryDto } from './dto/proforma.dto';
import { allowedProformaActions, proformaLabel, requestLabel, type PfRequestKind, type PfStatus } from './proforma.rules';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));
const TAB: Record<string, PfStatus[]> = { draft: ['DRAFT'], sent: ['SENT'], paid: ['PAID'], used: ['USED'], cancelled: ['CANCELLED'] };

/** Reading proformas: the list (S21), one proforma (S22) and the orders a new proforma can be made for. */
@Injectable()
export class ProformasQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly deposits: DepositsService,
    private readonly linked: SalesLinkedDocsService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async load(tenantId: string, id: string): Promise<SalProforma> {
    const row = await this.prisma.salProforma.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundError('Proforma');
    return row;
  }

  actions(ctx: RequestContext, p: SalProforma, status: PfStatus) {
    return allowedProformaActions({ status, isMigrated: p.isMigrated, canEdit: this.permissions.has(ctx.user.roles, P.PROFORMA_EDIT) });
  }

  // ── List and KPIs (S21) ───────────────────────────────────────────────────

  /** Paid is worked out from Finance receipts, so the tabs are filtered in memory after the database filters. */
  async list(ctx: RequestContext, query: ProformaListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', amount: 'amount', customer: 'customerName' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const rows = await this.prisma.salProforma.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(docDate && { docDate }),
        ...(query.customer?.trim() && { customerName: { contains: query.customer.trim() } }),
        ...(query.order?.trim() && { salesOrderNo: { contains: query.order.trim() } }),
        ...(query.request && { requestKind: query.request }),
        ...(q && { OR: [{ docNo: { contains: q } }, { customerName: { contains: q } }, { salesOrderNo: { contains: q } }] }),
      },
      orderBy: [{ [sort.field]: sort.direction }, { docNo: sort.direction }],
    });
    const all = (await this.deposits.withReceived(ctx.tenantId, rows)).map(({ proforma: p, received, status }) => ({
      id: p.id,
      docNo: p.docNo,
      docDate: iso(p.docDate),
      customerName: p.customerName,
      salesOrderId: p.salesOrderId,
      salesOrderNo: p.salesOrderNo,
      request: requestLabel(p.requestKind as PfRequestKind, p.depositPct),
      amount: toMoney(p.amount),
      received: received.gt(0) ? toMoney(received) : null,
      status,
      label: proformaLabel(status, p.usedOnInvoice),
      usedOnInvoice: p.usedOnInvoice,
      isMigrated: p.isMigrated,
      version: p.version,
    }));
    const count = (s: PfStatus[]) => all.filter((r) => s.includes(r.status)).length;
    const keys = query.status ? TAB[query.status] : undefined;
    const filtered = keys ? all.filter((r) => keys.includes(r.status)) : all;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
      statusCounts: { all: all.length, draft: count(['DRAFT']), sent: count(['SENT']), paid: count(['PAID']), used: count(['USED']), cancelled: count(['CANCELLED']) },
      kpis: await this.kpis(ctx),
      lastUsed: await this.lastUsed(ctx.tenantId),
    };
  }

  /** This month's deposits: requested, received, and still waiting (drafts and sent ones). */
  private async kpis(ctx: RequestContext) {
    const today = this.clock.today();
    const rows = await this.prisma.salProforma.findMany({ where: { tenantId: ctx.tenantId, status: { not: 'CANCELLED' }, docDate: { gte: new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`) } }, orderBy: { docNo: 'desc' } });
    const withReceived = await this.deposits.withReceived(ctx.tenantId, rows);
    const paid = withReceived.filter((x) => x.received.gt(0));
    const waiting = withReceived.filter((x) => x.status === 'DRAFT' || x.status === 'SENT');
    return {
      requested: { amount: toMoney(sum(rows.map((r) => r.amount))), count: rows.length },
      received: { amount: toMoney(sum(paid.map((x) => x.received))), count: paid.length },
      waiting: { amount: toMoney(sum(waiting.map((x) => x.proforma.amount.sub(x.received)))), docs: waiting.map((x) => ({ docNo: x.proforma.docNo, status: x.status === 'DRAFT' ? 'draft' : 'sent' })) },
    };
  }

  private async lastUsed(tenantId: string) {
    const p = await this.prisma.salProforma.findFirst({ where: { tenantId, status: 'USED' }, orderBy: { usedAt: 'desc' } });
    return p ? { docNo: p.docNo, invoiceNo: p.usedOnInvoice, usedAt: p.usedAt?.toISOString() ?? null } : null;
  }

  // ── Orders a new proforma can be made for ─────────────────────────────────

  /** Released orders with something still to deliver and no open proforma (draft, sent or paid but not used). */
  async orders(ctx: RequestContext) {
    const orders = await this.prisma.salSalesOrder.findMany({
      where: { tenantId: ctx.tenantId, isMigrated: false, status: { in: ['RELEASED', 'PARTIAL'] }, proformas: { none: { status: { in: ['DRAFT', 'SENT', 'PAID'] } } } },
      include: { lines: true },
      orderBy: { docNo: 'asc' },
    });
    return {
      items: orders
        .filter((o) => o.lines.some((l) => l.orderedQty.sub(l.deliveredQty).sub(l.cancelledQty).gt(0)))
        .map((o) => ({ id: o.id, docNo: o.docNo, customerName: o.customerName, total: toMoney(o.total), docDate: iso(o.docDate) })),
    };
  }

  // ── One proforma (S22) ────────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const p = await this.load(ctx.tenantId, id);
    const [[withReceived], activity, links, order, taxes, others, receipts] = await Promise.all([
      this.deposits.withReceived(ctx.tenantId, [p]),
      this.activity.listFor(ctx.tenantId, SAL_ENTITY.PROFORMA, p.id),
      this.linked.forDocument(ctx.tenantId, SAL_ENTITY.PROFORMA, p.id),
      p.salesOrderId ? this.prisma.salSalesOrder.findFirst({ where: { id: p.salesOrderId }, include: { lines: { orderBy: { lineNo: 'asc' } } } }) : null,
      this.masterData.listTaxCodes(ctx.tenantId),
      this.prisma.salProforma.findMany({ where: { tenantId: ctx.tenantId, customerCode: p.customerCode, id: { not: p.id } }, orderBy: { docDate: 'desc' }, take: 5 }),
      this.prisma.finReceiptStub.findMany({ where: { tenantId: ctx.tenantId, appliesToType: 'PROFORMA', appliesToNo: p.docNo }, orderBy: { receiptDate: 'asc' } }),
    ]);
    const status = withReceived!.status;
    const otherViews = await this.deposits.withReceived(ctx.tenantId, others);
    const taxName = (code: string) => taxes.find((t) => t.code === code)?.name ?? code;
    return {
      id: p.id,
      docNo: p.docNo,
      docDate: iso(p.docDate),
      status,
      label: proformaLabel(status, p.usedOnInvoice),
      isMigrated: p.isMigrated,
      version: p.version,
      customer: { code: p.customerCode, name: p.customerName },
      attention: p.attention,
      agent: { code: p.agentCode, name: p.agentName },
      order: order ? { id: order.id, no: order.docNo, status: order.status } : { id: null, no: p.salesOrderNo, status: null },
      payBy: iso(p.payBy),
      currency: p.currency,
      requestKind: p.requestKind as PfRequestKind,
      depositPct: p.depositPct ? p.depositPct.toDecimalPlaces(2).toString() : null,
      request: requestLabel(p.requestKind as PfRequestKind, p.depositPct),
      orderValue: { subtotal: toMoney(p.orderSubtotal), tax: toMoney(p.orderTax), total: toMoney(p.orderTotal), taxName: order ? [...new Set(order.lines.map((l) => taxName(l.taxCode)))].join(', ') : 'Tax' },
      amount: toMoney(p.amount),
      received: toMoney(withReceived!.received),
      receipts: receipts.map((r) => ({ receiptNo: r.receiptNo, date: iso(r.receiptDate), amount: toMoney(r.amount), method: r.method })),
      usedOnInvoice: p.usedOnInvoice,
      usedAt: p.usedAt?.toISOString() ?? null,
      note: p.note,
      lines: (order?.lines ?? []).map((l) => ({
        lineNo: l.lineNo, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, qty: toQty(l.orderedQty), unitPrice: toPrice(l.unitPrice),
        discountPct: l.discountPct.toFixed(2), taxName: taxName(l.taxCode), amount: toMoney(l.amount),
      })),
      otherProformas: otherViews.map((o) => ({ id: o.proforma.id, docNo: o.proforma.docNo, docDate: iso(o.proforma.docDate), amount: toMoney(o.proforma.amount), label: proformaLabel(o.status, o.proforma.usedOnInvoice) })),
      releasedAt: p.releasedAt?.toISOString() ?? null,
      links,
      activity,
      allowedActions: this.actions(ctx, p, status),
    };
  }
}
