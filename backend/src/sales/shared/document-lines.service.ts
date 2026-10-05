import { Inject, Injectable } from '@nestjs/common';
import { MASTER_DATA_PORT, type MasterDataPort, type MdCustomer } from '../../master-data/master-data.port';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { dec } from '../../platform/http/decimal';
import { BusinessRuleError, ConfigurationError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { lineProblems } from '../orders/order.rules';
import { SAL_ROLE } from './sales.constants';
import { saleLineTotals, saleTotals } from './totals.rules';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export interface SaleLineInput {
  itemCode: string;
  qty: string;
  unitPrice: string;
  discountPct?: string;
}

/**
 * What every Sales document with lines needs from Master Data: an active customer, the branch, warehouse and agent,
 * and lines of sellable items not excluded in the branch with price list, tax and cost copied at that moment.
 */
@Injectable()
export class SalesDocumentLines {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async activeCustomer(ctx: RequestContext, code: string, what = 'an order'): Promise<MdCustomer> {
    const customer = await this.masterData.findCustomer(ctx.tenantId, code);
    if (!customer) throw ValidationFailedError.field('customerCode', 'Pick the customer from Master Data.');
    if (customer.isCash) throw ValidationFailedError.field('customerCode', 'The walk-in customer is for cash sales only. Pick a customer account.');
    if (customer.status !== 'ACTIVE') {
      throw ValidationFailedError.field('customerCode', customer.status === 'PROSPECT'
        ? `${customer.name} is still a prospect. Add them to Master Data before making ${what}.`
        : `${customer.name} is blocked in Master Data and cannot be used.`);
    }
    return customer;
  }

  /** The customer's branch when the user works there, else the branch the user is working in. */
  branchFor(ctx: RequestContext, customer: MdCustomer): string {
    return ctx.user.branchCodes.includes(customer.branchCode) ? customer.branchCode : ctx.branchCode;
  }

  async warehouseFor(ctx: RequestContext, branchCode: string): Promise<string> {
    const warehouses = await this.masterData.listWarehouses(ctx.tenantId, branchCode);
    const main = warehouses.find((w) => w.code.endsWith('-MAIN') && w.isActive) ?? warehouses.find((w) => w.isActive);
    if (!main) throw new ConfigurationError(`Branch ${branchCode} has no warehouse to deliver from. Add one in Master Data.`);
    return main.code;
  }

  /** The agent is the person saving when they are a sales agent, else the customer's default agent. */
  async agentFor(ctx: RequestContext, customer: MdCustomer): Promise<{ code: string; name: string }> {
    if (ctx.user.roles.includes(SAL_ROLE.AGENT) || !customer.defaultAgentCode) return { code: ctx.user.code, name: ctx.user.name };
    const agent = (await this.masterData.listUsers(ctx.tenantId)).find((u) => u.code === customer.defaultAgentCode);
    return agent ? { code: agent.code, name: agent.name } : { code: ctx.user.code, name: ctx.user.name };
  }

  /** Lines from Master Data: sellable and active items not excluded in the branch, price list, tax and cost copied now. */
  async buildLines(ctx: RequestContext, customer: MdCustomer, branchCode: string, docDate: string, input: SaleLineInput[]) {
    const problems: FieldError[] = lineProblems(input.map((l, index) => ({ index, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? '0' })));
    const codes = [...new Set(input.map((l) => l.itemCode))];
    const [items, taxes, prices, excluded, setting] = await Promise.all([
      this.masterData.findItems(ctx.tenantId, codes),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.masterData.listPrices(ctx.tenantId, { priceListCode: customer.priceListCode, itemCodes: codes, onDate: docDate }),
      this.excludedItems(ctx.tenantId, branchCode, codes, docDate),
      this.prisma.salSetting.findUnique({ where: { tenantId: ctx.tenantId } }),
    ]);
    const lines = input.map((l, index) => {
      const item = items.find((i) => i.code === l.itemCode);
      const field = `lines[${index}].itemCode`;
      if (!item) { problems.push({ field, message: 'Pick an item from Master Data.' }); return null; }
      if (item.status !== 'ACTIVE') { problems.push({ field, message: `${item.code} is ${item.status.toLowerCase()} in Master Data and cannot be sold.` }); return null; }
      if (!item.isSellable) { problems.push({ field, message: `${item.code} is not for sale in Master Data.` }); return null; }
      const ex = excluded.find((e) => e.itemCode === item.code);
      if (ex) { problems.push({ field, message: `${item.code} is excluded from sale in this branch (${ex.reason}).` }); return null; }
      const tax = taxes.find((t) => t.code === (item.salesTaxCode ?? item.purchaseTaxCode));
      if (!tax) { problems.push({ field, message: `${item.code} has no sales tax code in Master Data.` }); return null; }
      const totals = saleLineTotals({ qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? '0', taxRate: tax.rate });
      const list = prices.find((p) => p.itemCode === item.code);
      return {
        itemId: item.id, itemCode: item.code, itemName: item.name, uomCode: item.salesUomCode, taxCode: tax.code, taxRate: dec(tax.rate),
        listPrice: list ? dec(list.unitPrice) : null, unitPrice: dec(l.unitPrice), discountPct: dec(l.discountPct ?? '0'), qty: dec(l.qty),
        grossAmount: totals.grossAmount, discountAmount: totals.discountAmount, amount: totals.amount, taxAmount: totals.taxAmount,
        isBuyToOrder: item.isBuyToOrder, unitCost: item.standardCost ? dec(item.standardCost) : null,
      };
    });
    if (problems.length) throw new ValidationFailedError(problems);
    const built = lines.filter((l): l is NonNullable<typeof l> => l !== null);
    const t = saleTotals(built, 'EXCLUSIVE', setting?.roundTo5Sen ?? true);
    const costKnown = built.every((l) => l.unitCost !== null);
    return {
      lines: built,
      totals: { subtotal: t.subtotal, discountTotal: t.discountTotal, taxTotal: t.taxTotal, rounding: t.rounding, total: t.total },
      costTotal: costKnown ? built.reduce((s, l) => s.add(l.unitCost!.mul(l.qty)), dec(0)).toDecimalPlaces(2) : null,
      anyBuyToOrder: built.some((l) => l.isBuyToOrder),
    };
  }

  excludedItems(tenantId: string, branchCode: string, codes: string[], onDate: string) {
    const on = day(onDate);
    return this.prisma.salExcludedItem.findMany({
      where: { tenantId, branchCode, itemCode: { in: codes }, removedAt: null, fromDate: { lte: on }, OR: [{ untilDate: null }, { untilDate: { gte: on } }] },
    });
  }

  /** Release re-checks that nothing became unsellable since the document was saved. */
  async checkStillSellable(ctx: RequestContext, branchCode: string, codes: string[]) {
    const [items, excluded] = await Promise.all([
      this.masterData.findItems(ctx.tenantId, codes),
      this.excludedItems(ctx.tenantId, branchCode, codes, this.clock.today()),
    ]);
    for (const code of codes) {
      const item = items.find((i) => i.code === code);
      if (!item || item.status !== 'ACTIVE' || !item.isSellable) throw new BusinessRuleError('ITEM_NOT_SELLABLE', `${code} can no longer be sold. Remove the line and save again.`);
      const ex = excluded.find((e) => e.itemCode === code);
      if (ex) throw new BusinessRuleError('ITEM_EXCLUDED', `${code} is now excluded from sale in this branch (${ex.reason}). Remove the line and save again.`);
    }
  }

  /** The named approver: someone holding the approver role in the branch, never the requester. */
  async approver(ctx: RequestContext, role: string, branchCode: string) {
    const candidates = (await this.masterData.listUsers(ctx.tenantId)).filter(
      (u) => u.isActive && u.roles.includes(role) && u.branchCodes.includes(branchCode) && u.code !== ctx.user.code,
    );
    const chosen = candidates[0];
    if (!chosen) throw new ConfigurationError(`Nobody holds the ${role.replace(/_/g, ' ').toLowerCase()} role in this branch to approve. Add one in Master Data.`);
    return { approverRole: role, approverCode: chosen.code, approverName: chosen.name };
  }
}
