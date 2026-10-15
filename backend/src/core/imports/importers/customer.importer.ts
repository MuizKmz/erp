import { Inject, Injectable } from '@nestjs/common';
import type { MdmCustomer } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../../master-data/master-data.port';
import type { RequestContext } from '../../../platform/context/request-context';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { CORE_DOC_TYPE } from '../../core.constants';
import { CORE_PERMISSIONS as P } from '../../core.permissions';
import { CreateCustomerDto, UpdateCustomerDto } from '../../customers/dto/customer.dto';
import { CustomersService } from '../../customers/customers.service';
import { duplicateOf, parseAmount } from '../imports.rules';
import { amountText, finder, outcome, problem, validateDto, type Importer, type PlannedRow } from './importer';

/** A stored customer as the form's request would send it, so blank cells leave it as it is. */
function requestOf(c: MdmCustomer): Record<string, unknown> {
  return {
    name: c.name,
    category: c.category,
    area: c.area,
    branchCode: c.branchCode,
    defaultAgentCode: c.defaultAgentCode,
    billingAddress: c.billingAddress,
    deliveryAddress: c.deliveryAddress,
    contactName: c.contactName,
    email: c.email,
    phone: c.phone,
    tin: c.tin,
    idType: c.idType,
    idNumber: c.idNumber,
    salesTaxNo: c.salesTaxNo,
    serviceTaxNo: c.serviceTaxNo,
    einvoiceEmail: c.einvoiceEmail,
    taxMode: c.taxMode,
    creditTermDays: c.creditTermDays,
    creditLimit: c.creditLimit?.toFixed(2) ?? null,
    overdueLimit: c.overdueLimit?.toFixed(2) ?? null,
    creditScope: c.creditScope,
    priceListCode: c.priceListCode,
  };
}

/** Customers from CSV (C14): an empty code adds one with the next C-#### number, a known code updates it (rule 12). */
@Injectable()
export class CustomerImporter implements Importer {
  readonly permission = P.CUSTOMER_EDIT;
  readonly numbering = CORE_DOC_TYPE.CUSTOMER;

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async plan(ctx: RequestContext, rows: Record<string, string>[]): Promise<PlannedRow[]> {
    const tenantId = ctx.tenantId;
    const where = { tenantId };
    const codes = rows.map((r) => r.code!.trim().toUpperCase() || null);
    const [existing, branches, priceLists, terms, categories, areas, users] = await Promise.all([
      this.prisma.mdmCustomer.findMany({ where: { tenantId, code: { in: codes.filter((c): c is string => !!c) } } }),
      this.masterData.listBranches(tenantId),
      this.prisma.mdmPriceList.findMany({ where }),
      this.prisma.mdmCreditTerm.findMany({ where }),
      this.prisma.mdmCustomerCategory.findMany({ where }),
      this.prisma.mdmArea.findMany({ where }),
      this.masterData.listUsers(tenantId),
    ]);
    const customer = new Map(existing.map((c) => [c.code, c]));
    const branch = finder(branches, (b) => [b.code]);
    const priceList = finder(priceLists, (p) => [p.code, p.name]);
    const term = finder(terms, (t) => [t.days, t.name, `${t.days} days`]);
    const category = finder(categories, (c) => [c.name]);
    const area = finder(areas, (a) => [a.name]);
    const user = finder(users, (u) => [u.code]);
    const dupes = duplicateOf(codes);

    const planned: PlannedRow[] = [];
    for (const [i, row] of rows.entries()) {
      const v = (key: string) => (row[key] ?? '').trim();
      const code = codes[i];
      if (dupes[i] !== null) {
        planned.push(problem(`Row ${dupes[i]! + 1} already has ${code}.`));
        continue;
      }
      const before = code ? customer.get(code) : undefined;
      if (code && !before) {
        planned.push(problem(`${code} is not in Master Data. Leave the code empty to add a new customer.`));
        continue;
      }
      const plain: Record<string, unknown> = before ? requestOf(before) : { taxMode: 'EXCLUSIVE', idType: 'BRN' };
      const errors: string[] = [];
      const pick = <T>(key: string, find: (value: string) => T | undefined, words: string, set: (found: T) => void) => {
        if (!v(key)) return;
        const found = find(v(key));
        if (found) set(found);
        else errors.push(`${words.replace('%', v(key))}`);
      };
      const text = (key: string, field: string, f: (s: string) => string = (s) => s) => {
        if (v(key)) plain[field] = f(v(key));
      };
      text('name', 'name');
      pick('branch', branch, 'Branch % is not in Master Data.', (b) => (plain.branchCode = b.code));
      pick('priceList', priceList, 'Price list % is not in Master Data.', (p) => (plain.priceListCode = p.code));
      pick('creditTerm', term, 'Credit term % is not on the credit terms list.', (t) => (plain.creditTermDays = t.days));
      pick('category', category, 'Category % is not on the customer categories list.', (c) => (plain.category = c.name));
      pick('area', area, 'Area % is not on the areas list.', (a) => (plain.area = a.name));
      pick('agent', user, 'Sales agent % is not in Master Data.', (u) => (plain.defaultAgentCode = u.code));
      text('creditLimit', 'creditLimit', parseAmount);
      text('overdueLimit', 'overdueLimit', parseAmount);
      text('tin', 'tin', (s) => s.toUpperCase());
      text('idType', 'idType', (s) => s.toUpperCase());
      text('idNumber', 'idNumber', (s) => s.toUpperCase());
      text('salesTaxNo', 'salesTaxNo');
      text('serviceTaxNo', 'serviceTaxNo');
      text('einvoiceEmail', 'einvoiceEmail');
      text('contact', 'contactName');
      text('email', 'email');
      text('phone', 'phone');
      text('billingAddress', 'billingAddress');
      text('deliveryAddress', 'deliveryAddress');
      text('taxMode', 'taxMode', (s) => s.toUpperCase());

      const display = {
        code: before?.code ?? '',
        name: String(plain.name ?? ''),
        branch: String(plain.branchCode ?? v('branch')),
        priceList: priceLists.find((p) => p.code === plain.priceListCode)?.name ?? v('priceList'),
        creditTerm: terms.find((t) => t.days === plain.creditTermDays)?.name ?? v('creditTerm'),
        creditLimit: amountText((plain.creditLimit as string | null) ?? null),
      };
      if (errors.length) {
        planned.push({ ...problem(errors[0]!), code: before?.code ?? null, display });
        continue;
      }
      const checked = before ? await validateDto(UpdateCustomerDto, { ...plain, version: before.version }) : await validateDto(CreateCustomerDto, plain);
      if (checked.errors.length) {
        planned.push({ ...problem(checked.errors[0]!), code: before?.code ?? null, display });
        continue;
      }
      const preview = await this.customers.preview(ctx, checked.dto, before ?? null);
      const result = outcome(preview, !before, 'customer');
      planned.push({
        ...result,
        code: before?.code ?? null,
        display,
        apply: before
          ? async () => (await this.customers.update(ctx, before.id, checked.dto as UpdateCustomerDto)).code
          : async () => (await this.customers.create(ctx, checked.dto as CreateCustomerDto)).code,
      });
    }
    return planned;
  }
}
