import { Injectable } from '@nestjs/common';
import type { MdmItem, MdmUomConversion } from '@prisma/client';
import type { RequestContext } from '../../../platform/context/request-context';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { CORE_PERMISSIONS as P } from '../../core.permissions';
import { CreateItemDto, UpdateItemDto } from '../../items/dto/item.dto';
import { ITEM_TYPES, TYPE_LABEL, type Conversion } from '../../items/items.rules';
import { ItemsService } from '../../items/items.service';
import { duplicateOf, parseAmount, parseYesNo } from '../imports.rules';
import { finder, outcome, problem, validateDto, type Importer, type PlannedRow } from './importer';

const conversionOf = (c: MdmUomConversion): Conversion => ({ fromUom: c.fromUom, toUom: c.toUom, factor: c.factor.toString() });

/** A stored item as the form's request would send it, with its conversions unchanged. */
function requestOf(i: MdmItem, conversions: Conversion[]): Record<string, unknown> {
  return {
    name: i.name,
    itemGroup: i.itemGroup,
    type: i.type,
    baseUom: i.baseUom,
    barcode: i.barcode,
    einvoiceClassification: i.einvoiceClassification,
    isPurchasable: i.isPurchasable,
    isBuyToOrder: i.isBuyToOrder,
    purchaseUom: i.purchaseUom,
    purchaseTaxCode: i.purchaseTaxCode,
    preferredSupplierCode: i.preferredSupplierCode,
    reorderLevel: i.reorderLevel?.toString() ?? null,
    packSize: i.packSize.toString(),
    isSellable: i.isSellable,
    salesUom: i.salesUom,
    salesTaxCode: i.salesTaxCode,
    standardCost: i.standardCost?.toString() ?? null,
    conversions: conversions.map((c) => ({ ...c, factor: String(c.factor) })),
  };
}

/** "Non-stock", "non stock", "NON_STOCK" → NON_STOCK */
const typeFinder = finder([...ITEM_TYPES], (t) => [t, TYPE_LABEL[t], TYPE_LABEL[t].replace('-', ' '), TYPE_LABEL[t].replace('-', '')]);

/** Items from CSV (C14): items keep the code typed; a known code updates the item, a new one adds it (rule 12). */
@Injectable()
export class ItemImporter implements Importer {
  readonly permission = P.ITEM_EDIT;

  constructor(
    private readonly prisma: PrismaService,
    private readonly items: ItemsService,
  ) {}

  async plan(ctx: RequestContext, rows: Record<string, string>[]): Promise<PlannedRow[]> {
    const tenantId = ctx.tenantId;
    const where = { tenantId };
    const codes = rows.map((r) => r.code!.trim().toUpperCase() || null);
    const known = codes.filter((c): c is string => !!c);
    const [existing, conversions, groups, units, taxes, suppliers] = await Promise.all([
      this.prisma.mdmItem.findMany({ where: { tenantId, code: { in: known } } }),
      this.prisma.mdmUomConversion.findMany({ where: { tenantId, itemCode: { in: known } } }),
      this.prisma.mdmItemGroup.findMany({ where }),
      this.prisma.mdmUom.findMany({ where, select: { code: true } }),
      this.prisma.mdmTaxCode.findMany({ where, select: { code: true }, distinct: ['code'] }),
      this.prisma.mdmSupplier.findMany({ where, select: { code: true } }),
    ]);
    const item = new Map(existing.map((i) => [i.code, i]));
    const group = finder(groups, (g) => [g.name]);
    const unit = finder(units, (u) => [u.code]);
    const tax = finder(taxes, (t) => [t.code]);
    const supplier = finder(suppliers, (s) => [s.code]);
    const dupes = duplicateOf(codes);

    const planned: PlannedRow[] = [];
    for (const [i, row] of rows.entries()) {
      const v = (key: string) => (row[key] ?? '').trim();
      const code = codes[i];
      if (!code) {
        planned.push(problem('Give the item code: items keep the code you type.'));
        continue;
      }
      if (dupes[i] !== null) {
        planned.push(problem(`Row ${dupes[i]! + 1} already has ${code}.`));
        continue;
      }
      const before = item.get(code);
      const beforeConversions = before ? conversions.filter((c) => c.itemCode === code).map(conversionOf) : [];
      const plain: Record<string, unknown> = before
        ? requestOf(before, beforeConversions)
        : { code, type: 'STOCK', isPurchasable: true, isBuyToOrder: false, isSellable: false, packSize: '1', conversions: [] };
      const errors: string[] = [];
      const text = (key: string, field: string, f: (s: string) => string = (s) => s) => {
        if (v(key)) plain[field] = f(v(key));
      };
      const pick = <T>(key: string, find: (value: string) => T | undefined, words: string, set: (found: T) => void) => {
        if (!v(key)) return;
        const found = find(v(key));
        if (found) set(found);
        else errors.push(words.replace('%', v(key)));
      };
      const yesNo = (key: string, field: string, label: string) => {
        if (!v(key)) return;
        const value = parseYesNo(v(key));
        if (value === undefined) errors.push(`${label} must be Yes or No.`);
        else plain[field] = value;
      };
      text('name', 'name');
      pick('group', group, 'Item group % is not on the item groups list.', (g) => (plain.itemGroup = g.name));
      pick('type', typeFinder, 'Type % is not one of Stock, Non-stock, Service or Asset.', (t) => (plain.type = t));
      pick('baseUnit', unit, 'Unit % is not in Master Data.', (u) => (plain.baseUom = u.code));
      pick('purchaseUnit', unit, 'Unit % is not in Master Data.', (u) => (plain.purchaseUom = u.code));
      pick('salesUnit', unit, 'Unit % is not in Master Data.', (u) => (plain.salesUom = u.code));
      pick('purchaseTax', tax, 'Tax code % is not in Master Data.', (t) => (plain.purchaseTaxCode = t.code));
      pick('salesTax', tax, 'Tax code % is not in Master Data.', (t) => (plain.salesTaxCode = t.code));
      pick('preferredSupplier', supplier, 'Supplier % is not in Master Data.', (s) => (plain.preferredSupplierCode = s.code));
      text('barcode', 'barcode');
      text('classification', 'einvoiceClassification');
      yesNo('canBuy', 'isPurchasable', 'Can be bought');
      yesNo('buyToOrder', 'isBuyToOrder', 'Buy to order');
      yesNo('canSell', 'isSellable', 'Can be sold');
      text('reorderLevel', 'reorderLevel', parseAmount);
      text('packSize', 'packSize', parseAmount);
      text('standardCost', 'standardCost', parseAmount);

      const display = {
        code: before ? code : `New · ${code}`,
        name: String(plain.name ?? ''),
        group: String(plain.itemGroup ?? v('group')),
        baseUnit: String(plain.baseUom ?? v('baseUnit')),
        purchaseTax: plain.isPurchasable ? String(plain.purchaseTaxCode ?? '—') : '—',
        salesTax: plain.isSellable ? String(plain.salesTaxCode ?? '—') : '—',
      };
      if (errors.length) {
        planned.push({ ...problem(errors[0]!), code, display });
        continue;
      }
      const checked = before ? await validateDto(UpdateItemDto, { ...plain, version: before.version }) : await validateDto(CreateItemDto, plain);
      if (checked.errors.length) {
        planned.push({ ...problem(checked.errors[0]!), code, display });
        continue;
      }
      const preview = await this.items.preview(ctx, checked.dto, before ?? null, beforeConversions);
      planned.push({
        ...outcome(preview, !before, 'item'),
        code,
        display,
        apply: before
          ? async () => (await this.items.update(ctx, before.id, checked.dto as UpdateItemDto)).code
          : async () => (await this.items.create(ctx, checked.dto as CreateItemDto)).code,
      });
    }
    return planned;
  }
}
