import { Injectable } from '@nestjs/common';
import type { MdmPriceList, MdmPriceListItem } from '@prisma/client';
import { ClockService } from '../../../platform/clock/clock.service';
import type { RequestContext } from '../../../platform/context/request-context';
import { dec } from '../../../platform/http/decimal';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { CORE_PERMISSIONS as P } from '../../core.permissions';
import { UpdatePriceListDto } from '../../price-lists/dto/price-list.dto';
import { isHistory, priceText, type PriceRow } from '../../price-lists/price-lists.rules';
import { PriceListsService } from '../../price-lists/price-lists.service';
import { dayText } from '../../shared/audit.rules';
import { duplicateOf, parseAmount, parseDate } from '../imports.rules';
import { finder, outcome, problem, resultText, validateDto, type Importer, type PlannedRow } from './importer';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const rowOf = (p: MdmPriceListItem): PriceRow => ({ itemCode: p.itemCode, uomCode: p.uomCode, unitPrice: p.unitPrice, validFrom: isoDay(p.validFrom) });
const keyOf = (p: Pick<PriceRow, 'itemCode' | 'uomCode' | 'validFrom'>) => `${p.itemCode}|${p.uomCode}|${p.validFrom}`;

/**
 * The list's request with one price added or changed: its fields as they are, and its prices from today on (history
 * stays on the server), with this price in place of the one with the same item, unit and date. Returns where it sits.
 */
function requestWith(list: MdmPriceList, prices: PriceRow[], price: PriceRow, today: string) {
  const sent = prices.filter((p) => !isHistory(p, today));
  let index = sent.findIndex((p) => keyOf(p) === keyOf(price));
  if (index < 0) index = sent.push(price) - 1;
  else sent[index] = price;
  const request = {
    name: list.name,
    currency: list.currency,
    taxInclusive: list.taxInclusive,
    validFrom: isoDay(list.validFrom),
    validTo: list.validTo ? isoDay(list.validTo) : null,
    prices: sent.map((p) => ({ itemCode: p.itemCode, uomCode: p.uomCode, unitPrice: dec(p.unitPrice).toString(), validFrom: p.validFrom })),
    version: list.version,
  };
  return { request, index };
}

/**
 * Price-list prices from CSV (C14). Each row adds or changes one dated price through the price list's own save, with
 * its rules: today or later, inside the list's dates, above 0, for an item Sales can sell in one of its units.
 */
@Injectable()
export class PriceImporter implements Importer {
  readonly permission = P.PRICE_LIST_EDIT;

  constructor(
    private readonly prisma: PrismaService,
    private readonly priceLists: PriceListsService,
    private readonly clock: ClockService,
  ) {}

  async plan(ctx: RequestContext, rows: Record<string, string>[]): Promise<PlannedRow[]> {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const [lists, items] = await Promise.all([
      this.prisma.mdmPriceList.findMany({ where: { tenantId } }),
      this.prisma.mdmItem.findMany({ where: { tenantId, code: { in: rows.map((r) => r.item!.trim().toUpperCase()) } }, select: { code: true, name: true, baseUom: true, salesUom: true } }),
    ]);
    const list = finder(lists, (l) => [l.code, l.name]);
    const item = new Map(items.map((i) => [i.code, i]));
    const prices = await this.prisma.mdmPriceListItem.findMany({ where: { tenantId, priceListCode: { in: lists.map((l) => l.code) } } });
    const pricesOf = (code: string) => prices.filter((p) => p.priceListCode === code).map(rowOf);

    // Read each row first, so a price can be in the file only once.
    const read = rows.map((row) => {
      const v = (key: string) => (row[key] ?? '').trim();
      const l = list(v('priceList'));
      const itemCode = v('item').toUpperCase();
      const it = item.get(itemCode);
      const uomCode = v('unit').toUpperCase() || it?.salesUom || it?.baseUom || '';
      const from = parseDate(v('from'));
      const price = parseAmount(v('price'));
      const display = { priceList: l?.code ?? v('priceList'), item: itemCode, unit: uomCode, price: /^\d+(\.\d+)?$/.test(price) ? priceText(price) : price, from: from ? dayText(from) : v('from') };
      let error: string | null = null;
      if (!l) error = `Price list ${v('priceList')} is not in Master Data.`;
      else if (!it) error = `Item ${itemCode} is not in Master Data.`;
      else if (!from) error = `From ${v('from')} is not a date. Write it as 1/11/2026 or 2026-11-01.`;
      return { l, itemCode, uomCode, from, price, display, error, key: l && from ? `${l.code}|${itemCode}|${uomCode}|${from}` : null };
    });
    const dupes = duplicateOf(read.map((r) => r.key));

    const planned: PlannedRow[] = [];
    for (const [i, r] of read.entries()) {
      if (r.error) {
        planned.push({ ...problem(r.error), display: r.display });
        continue;
      }
      if (dupes[i] !== null) {
        planned.push({ ...problem(`Row ${dupes[i]! + 1} already has this price.`), display: r.display });
        continue;
      }
      const l = r.l!;
      const price: PriceRow = { itemCode: r.itemCode, uomCode: r.uomCode, unitPrice: r.price, validFrom: r.from! };
      const before = pricesOf(l.code);
      const existing = before.find((p) => keyOf(p) === keyOf(price));
      // A price that has started is history: the same price again changes nothing; another one is the rules' problem.
      if (existing && isHistory(existing, today) && /^\d+(\.\d+)?$/.test(r.price) && dec(existing.unitPrice).eq(dec(r.price))) {
        planned.push({ status: 'unchanged', code: null, display: r.display, result: 'No change' });
        continue;
      }
      const { request, index } = requestWith(l, before, price, today);
      const checked = await validateDto(UpdatePriceListDto, request);
      if (checked.errors.length) {
        planned.push({ ...problem(checked.errors[0]!), display: r.display });
        continue;
      }
      const preview = await this.priceLists.preview(ctx, checked.dto, l, before);
      const own = preview.errors.find((e) => e.field === `prices[${index}]`);
      const result = outcome(own ? { ...preview, errors: [own] } : preview, !existing, 'price');
      if (result.status === 'update' && existing) result.result = `Update: ${priceText(existing.unitPrice)} → ${priceText(r.price)}`;
      planned.push({
        ...result,
        result: resultText(result.result),
        code: null,
        display: r.display,
        // Rows of one list are saved one after another, so each starts again from the list as it is now.
        apply: async () => {
          const now = await this.prisma.mdmPriceList.findFirstOrThrow({ where: { id: l.id, tenantId } });
          const nowPrices = (await this.prisma.mdmPriceListItem.findMany({ where: { tenantId, priceListCode: l.code } })).map(rowOf);
          const fresh = await validateDto(UpdatePriceListDto, requestWith(now, nowPrices, price, this.clock.today()).request);
          await this.priceLists.update(ctx, l.id, fresh.dto);
          return l.code;
        },
      });
    }
    return planned;
  }
}
