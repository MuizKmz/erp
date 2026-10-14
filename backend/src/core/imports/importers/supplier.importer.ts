import { Injectable } from '@nestjs/common';
import type { MdmContractPrice, MdmSupplier } from '@prisma/client';
import type { RequestContext } from '../../../platform/context/request-context';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { CORE_DOC_TYPE } from '../../core.constants';
import { CORE_PERMISSIONS as P } from '../../core.permissions';
import { CreateSupplierDto, UpdateSupplierDto } from '../../suppliers/dto/supplier.dto';
import type { ContractPrice } from '../../suppliers/suppliers.rules';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { duplicateOf, parseYesNo } from '../imports.rules';
import { finder, outcome, problem, validateDto, type Importer, type PlannedRow } from './importer';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const contractOf = (c: MdmContractPrice): ContractPrice => ({ itemCode: c.itemCode, unitPrice: c.unitPrice, validFrom: isoDay(c.validFrom), validTo: c.validTo ? isoDay(c.validTo) : null });

/** A stored supplier as the form's request would send it, with its contract prices unchanged. */
function requestOf(s: MdmSupplier, contracts: ContractPrice[]): Record<string, unknown> {
  return {
    name: s.name,
    shortName: s.shortName,
    category: s.category,
    isWalkIn: s.isWalkIn,
    contactName: s.contactName,
    email: s.email,
    phone: s.phone,
    address: s.address,
    tin: s.tin,
    idType: s.idType,
    regNo: s.regNo,
    sstNo: s.sstNo,
    serviceTaxNo: s.serviceTaxNo,
    einvoiceEmail: s.einvoiceEmail,
    paymentTermDays: s.paymentTermDays,
    currency: s.currency,
    contractPrices: contracts.map((c) => ({ itemCode: c.itemCode, unitPrice: String(c.unitPrice), validFrom: c.validFrom, validTo: c.validTo })),
  };
}

/** Suppliers from CSV (C14): an empty code adds one with the next S-#### number, a known code updates it (rule 12). */
@Injectable()
export class SupplierImporter implements Importer {
  readonly permission = P.SUPPLIER_EDIT;
  readonly numbering = CORE_DOC_TYPE.SUPPLIER;

  constructor(
    private readonly prisma: PrismaService,
    private readonly suppliers: SuppliersService,
  ) {}

  async plan(ctx: RequestContext, rows: Record<string, string>[]): Promise<PlannedRow[]> {
    const tenantId = ctx.tenantId;
    const codes = rows.map((r) => r.code!.trim().toUpperCase() || null);
    const known = codes.filter((c): c is string => !!c);
    const [existing, contracts, terms] = await Promise.all([
      this.prisma.mdmSupplier.findMany({ where: { tenantId, code: { in: known } } }),
      this.prisma.mdmContractPrice.findMany({ where: { tenantId, supplierCode: { in: known } }, orderBy: [{ itemCode: 'asc' }, { validFrom: 'asc' }] }),
      this.prisma.mdmCreditTerm.findMany({ where: { tenantId } }),
    ]);
    const supplier = new Map(existing.map((s) => [s.code, s]));
    const term = finder(terms, (t) => [t.days, t.name, `${t.days} days`]);
    const dupes = duplicateOf(codes);

    const planned: PlannedRow[] = [];
    for (const [i, row] of rows.entries()) {
      const v = (key: string) => (row[key] ?? '').trim();
      const code = codes[i];
      if (dupes[i] !== null) {
        planned.push(problem(`Row ${dupes[i]! + 1} already has ${code}.`));
        continue;
      }
      const before = code ? supplier.get(code) : undefined;
      if (code && !before) {
        planned.push(problem(`${code} is not in Master Data. Leave the code empty to add a new supplier.`));
        continue;
      }
      const beforeContracts = before ? contracts.filter((c) => c.supplierCode === before.code).map(contractOf) : [];
      const plain: Record<string, unknown> = before ? requestOf(before, beforeContracts) : { isWalkIn: false, currency: 'MYR', idType: 'BRN', contractPrices: [] };
      const errors: string[] = [];
      const text = (key: string, field: string, f: (s: string) => string = (s) => s) => {
        if (v(key)) plain[field] = f(v(key));
      };
      text('name', 'name');
      text('shortName', 'shortName');
      text('supplies', 'category');
      if (v('walkIn')) {
        const walkIn = parseYesNo(v('walkIn'));
        if (walkIn === undefined) errors.push('Walk-in shop must be Yes or No.');
        else plain.isWalkIn = walkIn;
      }
      if (v('paymentTerm')) {
        const t = term(v('paymentTerm'));
        if (t) plain.paymentTermDays = t.days;
        else errors.push(`Payment term ${v('paymentTerm')} is not on the credit terms list.`);
      }
      text('currency', 'currency', (s) => s.toUpperCase());
      text('tin', 'tin', (s) => s.toUpperCase());
      text('idType', 'idType', (s) => s.toUpperCase());
      text('idNumber', 'regNo', (s) => s.toUpperCase());
      text('salesTaxNo', 'sstNo');
      text('serviceTaxNo', 'serviceTaxNo');
      text('einvoiceEmail', 'einvoiceEmail');
      text('contact', 'contactName');
      text('email', 'email');
      text('phone', 'phone');
      text('address', 'address');
      if (plain.paymentTermDays === undefined) plain.paymentTermDays = 30;

      const display = {
        code: before?.code ?? '',
        name: String(plain.name ?? ''),
        supplies: String(plain.category ?? ''),
        paymentTerm: terms.find((t) => t.days === plain.paymentTermDays)?.name ?? v('paymentTerm'),
        tin: String(plain.tin ?? '') || '—',
      };
      if (errors.length) {
        planned.push({ ...problem(errors[0]!), code: before?.code ?? null, display });
        continue;
      }
      const checked = before ? await validateDto(UpdateSupplierDto, { ...plain, version: before.version }) : await validateDto(CreateSupplierDto, plain);
      if (checked.errors.length) {
        planned.push({ ...problem(checked.errors[0]!), code: before?.code ?? null, display });
        continue;
      }
      const preview = await this.suppliers.preview(ctx, checked.dto, before ?? null, beforeContracts);
      planned.push({
        ...outcome(preview, !before, 'supplier'),
        code: before?.code ?? null,
        display,
        apply: before
          ? async () => (await this.suppliers.update(ctx, before.id, checked.dto as UpdateSupplierDto)).code
          : async () => (await this.suppliers.create(ctx, checked.dto as CreateSupplierDto)).code,
      });
    }
    return planned;
  }
}
