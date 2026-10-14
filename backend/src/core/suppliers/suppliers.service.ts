import { Injectable } from '@nestjs/common';
import type { MdmContractPrice, MdmSupplier } from '@prisma/client';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec } from '../../platform/http/decimal';
import { BusinessRuleError, PermissionDeniedError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import type { Tx } from '../../platform/prisma/prisma.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_DOC_TYPE, CORE_ENTITY, CORE_EVENT } from '../core.constants';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { changeMessage, diffRecord } from '../shared/audit.rules';
import { CoreRecordsService } from '../shared/core-records.service';
import { deactivateRefusal, deleteRefusal } from '../usage/usage.rules';
import type { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import {
  activationGaps,
  contractPriceErrors,
  permissionsNeeded,
  STATUS_LABEL,
  statusActions,
  SUPPLIER_LABELS,
  supplierAudit,
  supplierSnapshot,
  type ContractPrice,
  type SupplierRecord,
  type SupplierStatus,
} from './suppliers.rules';
import { SuppliersQuery } from './suppliers.query';

const DONE_WORD = { block: 'blocked', activate: 'activated' } as const;
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const record = (s: MdmSupplier): SupplierRecord => ({
  code: s.code,
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
  status: s.status,
});
const contractOf = (c: MdmContractPrice): ContractPrice => ({ itemCode: c.itemCode, unitPrice: c.unitPrice, validFrom: isoDay(c.validFrom), validTo: c.validTo ? isoDay(c.validTo) : null });

/** Supplier commands (C07): create, update, block, activate and delete. One transaction each, with activity and event. */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: CoreRecordsService,
    private readonly usage: RecordUsageRegistry,
    private readonly numbering: NumberingService,
    private readonly permissions: PermissionRegistry,
    private readonly query: SuppliersQuery,
  ) {}

  /** A new supplier gets the next S-#### number. Buyers may add suppliers; contract prices need core.supplier.contract. */
  async create(ctx: RequestContext, dto: CreateSupplierDto) {
    const tenantId = ctx.tenantId;
    if (dto.contractPrices.length && !this.permissions.has(ctx.user.roles, P.SUPPLIER_CONTRACT)) throw new PermissionDeniedError(P.SUPPLIER_CONTRACT);
    const errors = await this.check(ctx, dto, null, []);
    if (errors.length) throw new ValidationFailedError(errors);
    const contracts = this.contracts(dto);
    const id = await this.prisma.$transaction(async (tx) => {
      const code = await this.numbering.next(tx, tenantId, CORE_DOC_TYPE.SUPPLIER);
      const row = await tx.mdmSupplier.create({ data: { tenantId, code, ...this.data(dto), status: 'ACTIVE', createdBy: ctx.user.code, updatedBy: ctx.user.code } });
      await this.writeContracts(tx, tenantId, code, contracts);
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.SUPPLIER,
        entityId: row.id,
        code,
        action: 'created',
        message: `Supplier ${code} created`,
        changes: diffRecord(null, supplierAudit(record(row), contracts), SUPPLIER_LABELS),
        event: CORE_EVENT.SUPPLIER_CREATED,
        snapshot: supplierSnapshot(record(row), contracts),
      });
      return row.id;
    });
    return this.query.detail(ctx, id);
  }

  /** Contract prices need core.supplier.contract, the other fields core.supplier.edit (decision 2, rule 10). */
  async update(ctx: RequestContext, id: string, dto: UpdateSupplierDto) {
    const tenantId = ctx.tenantId;
    const before = await this.query.load(ctx, id);
    if (before.version !== dto.version) throw new StaleVersionError();
    const beforeContracts = (await this.query.contracts(tenantId, before.code)).map(contractOf);
    const contracts = this.contracts(dto);
    const after: SupplierRecord = { ...record(before), ...this.data(dto) };
    const changes = diffRecord(supplierAudit(record(before), beforeContracts), supplierAudit(after, contracts), SUPPLIER_LABELS);
    if (!changes.length) return this.query.detail(ctx, id);
    const needed = permissionsNeeded(changes.map((c) => c.field));
    if (needed.details && !this.permissions.has(ctx.user.roles, P.SUPPLIER_EDIT)) throw new PermissionDeniedError(P.SUPPLIER_EDIT);
    if (needed.contracts && !this.permissions.has(ctx.user.roles, P.SUPPLIER_CONTRACT)) throw new PermissionDeniedError(P.SUPPLIER_CONTRACT);
    const errors = await this.check(ctx, dto, before, beforeContracts);
    if (errors.length) throw new ValidationFailedError(errors);

    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.mdmSupplier.updateMany({ where: { id, tenantId, version: dto.version }, data: { ...this.data(dto), version: { increment: 1 }, updatedBy: ctx.user.code } });
      if (saved.count === 0) throw new StaleVersionError();
      if (needed.contracts) {
        await tx.mdmContractPrice.deleteMany({ where: { tenantId, supplierCode: before.code } });
        await this.writeContracts(tx, tenantId, before.code, contracts);
      }
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.SUPPLIER,
        entityId: id,
        code: before.code,
        action: needed.contracts && !needed.details ? 'contracts_changed' : 'updated',
        message: changeMessage(changes),
        changes,
        event: CORE_EVENT.SUPPLIER_UPDATED,
        snapshot: supplierSnapshot(after, contracts),
      });
    });
    return this.query.detail(ctx, id);
  }

  /** Block (refused while open documents use the supplier) or activate (needs the fields of rule 5). */
  async setStatus(ctx: RequestContext, id: string, action: 'block' | 'activate', version: number) {
    const tenantId = ctx.tenantId;
    const s = await this.query.load(ctx, id);
    if (s.version !== version) throw new StaleVersionError();
    const status = s.status as SupplierStatus;
    if (!statusActions(status).includes(action)) {
      throw new BusinessRuleError('SUPPLIER_STATUS', `${s.code} is ${STATUS_LABEL[status].toLowerCase()}, so it cannot be ${DONE_WORD[action]}.`);
    }
    if (action === 'activate') {
      const gaps = activationGaps(s);
      if (gaps.length) throw new ValidationFailedError(gaps, `Fill these in before activating ${s.code}.`);
    } else {
      const refusal = deactivateRefusal(s.code, await this.usage.check({ tenantId, kind: 'SUPPLIER', code: s.code }));
      if (refusal) throw new BusinessRuleError('IN_USE', refusal);
    }
    const next: SupplierStatus = action === 'block' ? 'BLOCKED' : 'ACTIVE';
    const contracts = (await this.query.contracts(tenantId, s.code)).map(contractOf);
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.mdmSupplier.updateMany({ where: { id, tenantId, version }, data: { status: next, version: { increment: 1 }, updatedBy: ctx.user.code } });
      if (saved.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.SUPPLIER,
        entityId: id,
        code: s.code,
        action: DONE_WORD[action],
        message: `Supplier ${s.code} ${DONE_WORD[action]}`,
        changes: [{ field: 'status', label: 'Status', from: STATUS_LABEL[status], to: STATUS_LABEL[next] }],
        event: CORE_EVENT.SUPPLIER_UPDATED,
        snapshot: supplierSnapshot({ ...record(s), status: next }, contracts),
      });
    });
    return this.query.detail(ctx, id);
  }

  /** Delete only while no Purchase document uses the supplier and no item prefers it (rule 3). Its contract prices go with it. */
  async remove(ctx: RequestContext, id: string, version: number) {
    const tenantId = ctx.tenantId;
    const s = await this.query.load(ctx, id);
    if (s.version !== version) throw new StaleVersionError();
    const [usage, preferredBy, contracts] = await Promise.all([
      this.usage.check({ tenantId, kind: 'SUPPLIER', code: s.code }),
      this.prisma.mdmItem.count({ where: { tenantId, preferredSupplierCode: s.code } }),
      this.query.contracts(tenantId, s.code),
    ]);
    const refusal = deleteRefusal('SUPPLIER', s.code, usage, [{ label: 'items as preferred supplier', count: preferredBy }]);
    if (refusal) throw new BusinessRuleError('IN_USE', refusal);
    await this.prisma.$transaction(async (tx) => {
      await tx.mdmContractPrice.deleteMany({ where: { tenantId, supplierCode: s.code } });
      const gone = await tx.mdmSupplier.deleteMany({ where: { id, tenantId, version } });
      if (gone.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.SUPPLIER,
        entityId: id,
        code: s.code,
        action: 'deleted',
        message: `Supplier ${s.code} deleted (nothing used it)`,
        event: CORE_EVENT.SUPPLIER_DELETED,
        snapshot: supplierSnapshot(record(s), contracts.map(contractOf)),
      });
    });
    return { deleted: true, code: s.code };
  }

  private data(dto: CreateSupplierDto) {
    return {
      name: dto.name,
      shortName: dto.shortName ?? null,
      category: dto.category ?? null,
      isWalkIn: dto.isWalkIn,
      contactName: dto.contactName ?? null,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      address: dto.address ?? null,
      tin: dto.tin ?? null,
      idType: dto.idType ?? null,
      regNo: dto.regNo ?? null,
      sstNo: dto.sstNo ?? null,
      serviceTaxNo: dto.serviceTaxNo ?? null,
      einvoiceEmail: dto.einvoiceEmail ?? null,
      paymentTermDays: dto.paymentTermDays,
      currency: dto.currency,
    };
  }

  private contracts(dto: CreateSupplierDto): ContractPrice[] {
    return dto.contractPrices.map((c) => ({ itemCode: c.itemCode, unitPrice: dec(c.unitPrice), validFrom: c.validFrom, validTo: c.validTo ?? null }));
  }

  private async writeContracts(tx: Tx, tenantId: string, supplierCode: string, contracts: ContractPrice[]): Promise<void> {
    if (!contracts.length) return;
    await tx.mdmContractPrice.createMany({
      data: contracts.map((c) => ({ tenantId, supplierCode, itemCode: c.itemCode, unitPrice: dec(c.unitPrice), validFrom: day(c.validFrom), validTo: c.validTo ? day(c.validTo) : null })),
    });
  }

  /**
   * The payment term is an active credit term; contract prices are for active items that can be bought, with valid,
   * non-overlapping periods. A value the supplier already had may stay even if it was made inactive since.
   */
  private async check(ctx: RequestContext, dto: CreateSupplierDto, before: MdmSupplier | null, beforeContracts: ContractPrice[]): Promise<FieldError[]> {
    const tenantId = ctx.tenantId;
    const itemCodes = [...new Set(dto.contractPrices.map((c) => c.itemCode))];
    const [term, items] = await Promise.all([
      this.prisma.mdmCreditTerm.findFirst({ where: { tenantId, days: dto.paymentTermDays } }),
      this.prisma.mdmItem.findMany({ where: { tenantId, code: { in: itemCodes } }, select: { code: true, status: true, isPurchasable: true } }),
    ]);
    const errors: FieldError[] = [];
    if (!term || (!term.isActive && before?.paymentTermDays !== dto.paymentTermDays)) errors.push({ field: 'paymentTermDays', message: 'Pick the payment term from the list.' });
    const item = new Map(items.map((i) => [i.code, i]));
    const hadContract = new Set(beforeContracts.map((c) => c.itemCode));
    dto.contractPrices.forEach((c, i) => {
      const it = item.get(c.itemCode);
      if (!it) errors.push({ field: `contractPrices[${i}]`, message: `Item ${c.itemCode} is not in Master Data.` });
      else if ((!it.isPurchasable || it.status !== 'ACTIVE') && !hadContract.has(c.itemCode)) {
        errors.push({ field: `contractPrices[${i}]`, message: `${c.itemCode} cannot be bought, so it cannot have a contract price.` });
      }
    });
    errors.push(...contractPriceErrors(this.contracts(dto)).filter((e) => !errors.some((x) => x.field === e.field)));
    return errors;
  }
}
