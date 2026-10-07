import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SalCashSale, SalCashSaleLine } from '@prisma/client';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty, toRate } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { SalesLinkedDocsService } from '../shared/linked-docs.service';
import { SAL_ENTITY } from '../shared/sales.constants';
import { allowedCashSaleActions, changeDue, consolidatedDue, CS_STATUSES, PAYMENT_LABELS, type CsStatus, type PaymentMethod } from './cash-sale.rules';
import type { CashListQueryDto } from './dto/cash-sale.dto';

export type CashSaleWithLines = SalCashSale & { lines: SalCashSaleLine[] };
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));

/** Reading cash sales: the list and KPIs (S23) and one sale at the counter (S24). */
@Injectable()
export class CashSalesQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly linked: SalesLinkedDocsService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
  ) {}

  async load(tenantId: string, id: string): Promise<CashSaleWithLines> {
    const row = await this.prisma.salCashSale.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Cash sale');
    return row;
  }

  actions(ctx: RequestContext, c: SalCashSale) {
    return allowedCashSaleActions({ status: c.status as CsStatus, isMigrated: c.isMigrated, canEdit: this.permissions.has(ctx.user.roles, P.CASH_SALE_EDIT) });
  }

  eInvoiceLabel(c: SalCashSale): string {
    if (c.isMigrated) return 'Old system';
    if (c.ownEInvoice) return c.status === 'RELEASED' ? 'Own e-Invoice · pending' : 'Own e-Invoice';
    return 'Consolidated';
  }

  // ── List and KPIs (S23) ───────────────────────────────────────────────────

  async list(ctx: RequestContext, query: CashListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', total: 'total' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const base: Prisma.SalCashSaleWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.buyer?.trim() && { buyerName: { contains: query.buyer.trim() } }),
      ...(query.method && { paymentMethod: query.method }),
      ...(query.counter && { counterName: query.counter }),
      ...(q && { OR: [{ docNo: { contains: q } }, { buyerName: { contains: q } }, { summary: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, CS_STATUSES);
    const where = { ...base, ...(status && { status }) };
    const [rows, total, grouped, counters] = await Promise.all([
      this.prisma.salCashSale.findMany({ where, orderBy: [toOrderBy(sort), { createdAt: sort.direction }, { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.salCashSale.count({ where }),
      this.prisma.salCashSale.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.salCashSale.findMany({ where: { tenantId: ctx.tenantId, counterName: { not: null } }, distinct: ['counterName'], select: { counterName: true } }),
    ]);
    const response = toListResponse(
      rows.map((c) => ({
        id: c.id,
        docNo: c.docNo,
        docDate: iso(c.docDate),
        buyer: c.buyerName?.trim() || 'Walk-in',
        summary: c.summary,
        paidBy: PAYMENT_LABELS[c.paymentMethod as PaymentMethod] ?? c.paymentMethod,
        total: toMoney(c.total),
        eInvoice: this.eInvoiceLabel(c),
        ownPending: !c.isMigrated && c.ownEInvoice && c.status === 'RELEASED',
        status: c.status,
        isMigrated: c.isMigrated,
        version: c.version,
      })),
      total,
      query,
      buildStatusCounts(grouped, CS_STATUSES),
    );
    return { ...response, kpis: await this.kpis(ctx), counters: counters.map((c) => c.counterName!).sort() };
  }

  private async kpis(ctx: RequestContext) {
    const today = this.clock.today();
    const month = await this.prisma.salCashSale.findMany({ where: { tenantId: ctx.tenantId, docDate: { gte: new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`) } }, orderBy: { docNo: 'asc' } });
    const todays = month.filter((c) => iso(c.docDate) === today);
    const monthTotal = sum(month.map((c) => c.total));
    const byMethod = new Map<string, Prisma.Decimal>();
    for (const c of month) byMethod.set(c.paymentMethod, (byMethod.get(c.paymentMethod) ?? dec(0)).add(c.total));
    const shares = [...byMethod]
      .map(([method, amount]) => ({ method, label: PAYMENT_LABELS[method as PaymentMethod] ?? method, pct: monthTotal.gt(0) ? Math.round(amount.div(monthTotal).mul(100).toNumber()) : 0 }))
      .sort((a, b) => b.pct - a.pct);
    const drafts = todays.filter((c) => c.status === 'DRAFT').map((c) => c.docNo);
    return {
      today: { amount: toMoney(sum(todays.map((c) => c.total))), count: todays.length, drafts },
      month: { amount: toMoney(monthTotal), count: month.length, name: new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }) },
      paidBy: shares,
      consolidated: { count: month.filter((c) => !c.ownEInvoice).length, due: consolidatedDue(today) },
    };
  }

  // ── One sale (S24) ────────────────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const c = await this.load(ctx.tenantId, id);
    const codes = c.lines.map((l) => l.itemCode);
    const [activity, links, taxes, stock, users] = await Promise.all([
      this.activity.listFor(ctx.tenantId, SAL_ENTITY.CASH_SALE, c.id),
      this.linked.forDocument(ctx.tenantId, SAL_ENTITY.CASH_SALE, c.id),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.stock.listStock(ctx.tenantId, codes),
      this.masterData.listUsers(ctx.tenantId),
    ]);
    const taxName = (code: string) => taxes.find((t) => t.code === code)?.name ?? code;
    const onHand = (code: string) => sum(stock.filter((s) => s.itemCode === code && s.warehouseCode === c.warehouseCode).map((s) => dec(s.onHand)));
    const short = c.status === 'DRAFT' ? c.lines.filter((l) => onHand(l.itemCode).lt(l.qty)).map((l) => `${l.itemCode} ${toQty(onHand(l.itemCode)).replace(/\.0+$/, '')} in stock`) : [];
    const received = c.status === 'RELEASED' || c.amountReceived.gt(0) ? c.amountReceived : dec(0);
    const balance = c.total.sub(received.gt(c.total) ? c.total : received);
    return {
      id: c.id,
      docNo: c.docNo,
      docDate: iso(c.docDate),
      status: c.status,
      isMigrated: c.isMigrated,
      version: c.version,
      counterName: c.counterName,
      customer: { code: c.customerCode, name: c.customerName },
      servedBy: { code: c.servedByCode, name: users.find((u) => u.code === c.servedByCode)?.name ?? c.servedByName },
      buyerName: c.buyerName,
      buyerPhone: c.buyerPhone,
      buyerTin: c.buyerTin,
      ownEInvoice: c.ownEInvoice,
      eInvoice: this.eInvoiceLabel(c),
      consolidatedDue: c.ownEInvoice ? null : consolidatedDue(iso(c.docDate)!),
      taxMode: c.taxMode,
      branchCode: c.branchCode,
      warehouseCode: c.warehouseCode,
      paymentMethod: c.paymentMethod as PaymentMethod,
      paymentRef: c.paymentRef,
      amountReceived: toMoney(c.amountReceived),
      change: toMoney(c.status === 'RELEASED' ? c.changeAmount : changeDue(c.paymentMethod as PaymentMethod, c.total, c.amountReceived)),
      balance: toMoney(balance.gt(0) ? balance : dec(0)),
      lines: c.lines.map((l) => ({
        id: l.id, lineNo: l.lineNo, itemCode: l.itemCode, itemName: l.itemName, uomCode: l.uomCode, taxCode: l.taxCode, taxName: taxName(l.taxCode), taxRate: toRate(l.taxRate),
        qty: toQty(l.qty), unitPrice: toPrice(l.unitPrice), discountPct: l.discountPct.toString(), amount: toMoney(l.amount), taxAmount: toMoney(l.taxAmount),
      })),
      totals: {
        beforeTax: toMoney(c.subtotal),
        tax: toMoney(c.taxTotal),
        taxName: [...new Set(c.lines.map((l) => taxName(l.taxCode)))].join(', ') || 'SST',
        rounding: toMoney(c.rounding),
        total: toMoney(c.total),
      },
      stockWarning: short.length ? short.join(', ') : null,
      inventoryConnected: this.stock.connected,
      releasedAt: c.releasedAt?.toISOString() ?? null,
      links,
      activity,
      allowedActions: this.actions(ctx, c),
    };
  }
}
