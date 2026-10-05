import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ClockService } from '../../platform/clock/clock.service';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { SAL_ROLE } from '../shared/sales.constants';

class SearchQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

class ItemSearchQuery extends SearchQuery {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  branchCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  group?: string;

  /** "Only items that can be sold" (S04). Off shows not-for-sale items greyed out with the reason. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  sellableOnly?: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Master Data pickers for Sales screens — /api/v1/sales/lookups. Read only, through MasterDataPort. */
@Controller('sales/lookups')
@RequirePermission(P.VIEW)
export class SalesLookupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
  ) {}

  /** Active customers for documents (prospects and blocked customers are left out; the walk-in customer too). */
  @Get('customers')
  async customers(@CurrentContext() ctx: RequestContext, @Query() query: SearchQuery) {
    const rows = await this.masterData.searchCustomers(ctx.tenantId, { q: query.q, activeOnly: true, limit: 20 });
    return {
      items: rows.filter((c) => !c.isCash).map((c) => ({
        code: c.code, name: c.name, branchCode: c.branchCode, contactName: c.contactName, deliveryAddress: c.deliveryAddress,
        creditTermDays: c.creditTermDays, priceListCode: c.priceListCode, creditLimit: c.creditLimit, defaultAgentCode: c.defaultAgentCode,
      })),
    };
  }

  /**
   * S04 · Add item from Master Data: price list price, last price sold to this customer, stock at the branch,
   * and why an item cannot be added (excluded in the branch, not for sale). Out of stock only warns.
   */
  @Get('items')
  async items(@CurrentContext() ctx: RequestContext, @Query() query: ItemSearchQuery) {
    const today = this.clock.today();
    const customer = query.customerCode ? await this.masterData.findCustomer(ctx.tenantId, query.customerCode) : null;
    const branchCode = query.branchCode ?? customer?.branchCode ?? ctx.branchCode;
    const found = await this.masterData.searchSellableItems(ctx.tenantId, { q: query.q, itemGroup: query.group || undefined, sellableOnly: query.sellableOnly ?? false, limit: 30 });
    // Purchase-only items (raw materials) are never offered on sales documents.
    const items = found.filter((i) => i.isSellable || !i.isPurchasable);
    const codes = items.map((i) => i.code);
    const on = new Date(`${today}T00:00:00.000Z`);
    const [taxes, prices, warehouses, stock, excluded, sold] = await Promise.all([
      this.masterData.listTaxCodes(ctx.tenantId),
      customer ? this.masterData.listPrices(ctx.tenantId, { priceListCode: customer.priceListCode, itemCodes: codes, onDate: today }) : Promise.resolve([]),
      this.masterData.listWarehouses(ctx.tenantId, branchCode),
      this.stock.listStock(ctx.tenantId, codes),
      this.prisma.salExcludedItem.findMany({
        where: { tenantId: ctx.tenantId, branchCode, itemCode: { in: codes }, removedAt: null, fromDate: { lte: on }, OR: [{ untilDate: null }, { untilDate: { gte: on } }] },
      }),
      customer
        ? this.prisma.salInvoiceLine.findMany({
            where: { tenantId: ctx.tenantId, itemCode: { in: codes }, invoice: { customerCode: customer.code, status: 'RELEASED' } },
            include: { invoice: { select: { docNo: true, docDate: true } } },
            orderBy: { invoice: { docDate: 'desc' } },
          })
        : Promise.resolve([]),
    ]);
    const branchWarehouses = new Set(warehouses.filter((w) => !w.code.includes('DMG')).map((w) => w.code));
    return {
      branchCode,
      priceListCode: customer?.priceListCode ?? null,
      items: items.map((i) => {
        const tax = taxes.find((t) => t.code === (i.salesTaxCode ?? i.purchaseTaxCode));
        const ex = excluded.find((e) => e.itemCode === i.code);
        const last = sold.find((s) => s.itemCode === i.code);
        const inStock = stock.filter((s) => s.itemCode === i.code && branchWarehouses.has(s.warehouseCode)).reduce((sum, s) => sum.add(dec(s.onHand)), dec(0));
        const blocked = !i.isSellable ? 'NOT_FOR_SALE' : ex ? 'EXCLUDED' : null;
        const price = prices.find((p) => p.itemCode === i.code);
        return {
          code: i.code, name: i.name, group: i.itemGroup, uomCode: i.salesUomCode, type: i.type, isBuyToOrder: i.isBuyToOrder,
          taxCode: tax?.code ?? '', taxName: tax?.name ?? '', taxRate: tax?.rate ?? '0.0000',
          listPrice: blocked || !price ? null : toPrice(price.unitPrice),
          lastSold: blocked || !last ? null : { price: toPrice(last.unitPrice), date: iso(last.invoice.docDate), docNo: last.invoice.docNo },
          inStock: i.type === 'STOCK' ? toQty(inStock) : null,
          state: blocked ?? (i.type === 'STOCK' && inStock.lte(0) && !i.isBuyToOrder ? 'OUT_OF_STOCK' : 'ACTIVE'),
          reason: blocked === 'EXCLUDED' ? ex!.reason : null,
        };
      }),
      groups: [...new Set(found.map((i) => i.itemGroup))].sort(),
    };
  }

  @Get('agents')
  async agents(@CurrentContext() ctx: RequestContext) {
    const users = await this.masterData.listUsers(ctx.tenantId);
    return { items: users.filter((u) => u.isActive && u.roles.includes(SAL_ROLE.AGENT)).map((u) => ({ code: u.code, name: u.name, branchCodes: u.branchCodes })) };
  }

  @Get('branches')
  async branches(@CurrentContext() ctx: RequestContext) {
    return { items: (await this.masterData.listBranches(ctx.tenantId)).filter((b) => b.isActive).map((b) => ({ code: b.code, name: b.name })) };
  }

  /** The customer card on documents: what Master Data says, plus what they owe (from Sales and the Finance stub). */
  @Get('customer-card')
  async customerCard(@CurrentContext() ctx: RequestContext, @Query() query: SearchQuery) {
    const c = query.q ? await this.masterData.findCustomer(ctx.tenantId, query.q) : null;
    if (!c) return null;
    const [priceLists, users] = await Promise.all([this.masterData.listPriceLists(ctx.tenantId), this.masterData.listUsers(ctx.tenantId)]);
    return {
      code: c.code, name: c.name, status: c.status, category: c.category, area: c.area, creditTermDays: c.creditTermDays,
      creditLimit: c.creditLimit ? toMoney(c.creditLimit) : null, overdueLimit: c.overdueLimit ? toMoney(c.overdueLimit) : null,
      priceList: priceLists.find((p) => p.code === c.priceListCode)?.name ?? c.priceListCode,
      defaultAgent: users.find((u) => u.code === c.defaultAgentCode)?.name ?? null,
    };
  }
}
