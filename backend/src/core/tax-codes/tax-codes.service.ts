import { Injectable } from '@nestjs/common';
import type { MdmTaxCode } from '@prisma/client';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { BusinessRuleError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import type { Tx } from '../../platform/prisma/prisma.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_ENTITY, CORE_EVENT } from '../core.constants';
import { changeMessage, dayText, diffRecord } from '../shared/audit.rules';
import { CoreRecordsService } from '../shared/core-records.service';
import { deleteRefusal } from '../usage/usage.rules';
import type { CreateTaxCodeDto, NewRateDto, UpdateTaxCodeDto } from './dto/tax-code.dto';
import { periodOf, TaxCodesQuery } from './tax-codes.query';
import {
  dayBefore,
  deactivateTaxError,
  latestPeriod,
  newRateErrors,
  percentText,
  rateError,
  rateFromPercent,
  removeRateRefusal,
  TAX_LABELS,
  taxAudit,
  taxSnapshot,
  typeChangeError,
  type TaxCodeRecord,
  type TaxType,
} from './tax-codes.rules';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const record = (first: MdmTaxCode): TaxCodeRecord => ({ code: first.code, type: first.type as TaxType, country: first.country, isActive: first.isActive });

/**
 * C10 commands: add a code, change it, add or remove a rate, delete it. One transaction each, with activity and an
 * mdm.tax_code.* event. The code's first row is its anchor: its version locks every change to the code.
 */
@Injectable()
export class TaxCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: CoreRecordsService,
    private readonly usage: RecordUsageRegistry,
    private readonly clock: ClockService,
    private readonly query: TaxCodesQuery,
  ) {}

  /** A new code with its first rate. Nothing has used it yet, so its start may be any date. */
  async create(ctx: RequestContext, dto: CreateTaxCodeDto) {
    const tenantId = ctx.tenantId;
    const [taken, deleted] = await Promise.all([
      this.prisma.mdmTaxCode.findFirst({ where: { tenantId, code: dto.code }, select: { name: true } }),
      this.prisma.sysActivity.findFirst({ where: { tenantId, entityType: CORE_ENTITY.TAX_CODE, docNo: dto.code, action: 'deleted' }, select: { id: true } }),
    ]);
    if (taken) throw ValidationFailedError.field('code', `${dto.code} is already the code of ${taken.name}.`);
    if (deleted) throw ValidationFailedError.field('code', `${dto.code} belonged to a tax code that was deleted. Codes are never used again.`);
    const rate = rateError(dto.rate, dto.type);
    if (rate) throw ValidationFailedError.field('rate', rate);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.mdmTaxCode.create({
        data: { tenantId, code: dto.code, name: dto.name, type: dto.type, rate: rateFromPercent(dto.rate), validFrom: day(dto.validFrom), createdBy: ctx.user.code, updatedBy: ctx.user.code },
      });
      const periods = [periodOf(row)];
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.TAX_CODE,
        entityId: row.id,
        code: row.code,
        action: 'created',
        message: `Tax code ${row.code} added at ${percentText(row.rate)}`,
        changes: diffRecord(null, taxAudit(record(row), periods), TAX_LABELS),
        event: CORE_EVENT.TAX_CODE_UPDATED,
        snapshot: taxSnapshot(record(row), periods),
        extra: { created: true },
      });
    });
    return this.query.detail(ctx, dto.code);
  }

  /** The latest rate's name, the type (fixed once documents use the code) and whether the code is active. */
  async update(ctx: RequestContext, code: string, dto: UpdateTaxCodeDto) {
    const tenantId = ctx.tenantId;
    const rows = await this.query.rows(ctx, code);
    const first = rows[0]!;
    if (first.version !== dto.version) throw new StaleVersionError();
    const before = rows.map(periodOf);
    const latest = latestPeriod(before);
    const after = before.map((p) => (p.id === latest.id ? { ...p, name: dto.name } : p));
    const next: TaxCodeRecord = { ...record(first), type: dto.type, isActive: dto.isActive };
    const changes = diffRecord(taxAudit(record(first), before), taxAudit(next, after), TAX_LABELS);
    if (!changes.length) return this.query.detail(ctx, code);

    if (dto.type !== first.type) {
      const usage = await this.usage.check({ tenantId, kind: 'TAX_CODE', code });
      const error = typeChangeError(code, first.type as TaxType, dto.type, usage.documents, before);
      if (error) throw ValidationFailedError.field('type', error);
    }
    if (first.isActive && !dto.isActive) {
      const error = deactivateTaxError(code, (await this.query.itemUse(tenantId, code)).activeItems);
      if (error) throw new BusinessRuleError('IN_USE', error);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, ctx, first, dto.version);
      await tx.mdmTaxCode.updateMany({ where: { tenantId, code }, data: { type: dto.type, isActive: dto.isActive, updatedBy: ctx.user.code } });
      if (dto.name !== latest.name) await tx.mdmTaxCode.update({ where: { id: latest.id }, data: { name: dto.name } });
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.TAX_CODE,
        entityId: first.id,
        code,
        action: 'updated',
        message: `Tax code ${code}: ${changeMessage(changes).replace(/^Changed/, 'changed')}`,
        changes,
        event: CORE_EVENT.TAX_CODE_UPDATED,
        snapshot: taxSnapshot(next, after),
      });
    });
    return this.query.detail(ctx, code);
  }

  /** A new rate from a date: the latest period closes the day before, and the new one runs on with no end. */
  async addRate(ctx: RequestContext, code: string, dto: NewRateDto) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const rows = await this.query.rows(ctx, code);
    const first = rows[0]!;
    if (first.version !== dto.version) throw new StaleVersionError();
    const before = rows.map(periodOf);
    const errors = newRateErrors({ percent: dto.rate, validFrom: dto.validFrom }, first.type as TaxType, before, today);
    if (errors.length) throw new ValidationFailedError(errors);
    const latest = latestPeriod(before);
    const closeOn = dayBefore(dto.validFrom);
    const closes = !latest.validTo || latest.validTo > closeOn;
    const rate = rateFromPercent(dto.rate);

    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, ctx, first, dto.version);
      if (closes) await tx.mdmTaxCode.update({ where: { id: latest.id }, data: { validTo: day(closeOn), updatedBy: ctx.user.code } });
      const row = await tx.mdmTaxCode.create({
        data: { tenantId, code, name: dto.name, type: first.type, rate, country: first.country, validFrom: day(dto.validFrom), isActive: first.isActive, createdBy: ctx.user.code, updatedBy: ctx.user.code },
      });
      const after = [...before.map((p) => (closes && p.id === latest.id ? { ...p, validTo: closeOn } : p)), periodOf(row)];
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.TAX_CODE,
        entityId: first.id,
        code,
        action: 'rate_added',
        message: `New rate for ${code}: ${percentText(rate)} from ${dto.validFrom === today ? 'today' : dayText(dto.validFrom)}`,
        changes: diffRecord(taxAudit(record(first), before), taxAudit(record(first), after), TAX_LABELS),
        event: CORE_EVENT.TAX_CODE_UPDATED,
        snapshot: taxSnapshot(record(first), after),
      });
    });
    return this.query.detail(ctx, code);
  }

  /** A rate that has not started can be removed while it is the latest; the period before runs on again. */
  async removeRate(ctx: RequestContext, code: string, periodId: string, version: number) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const rows = await this.query.rows(ctx, code);
    const first = rows[0]!;
    if (first.version !== version) throw new StaleVersionError();
    const before = rows.map(periodOf);
    const target = before.find((p) => p.id === periodId);
    if (!target) throw ValidationFailedError.field('period', `That rate is not one of ${code}'s.`);
    const refusal = removeRateRefusal(target, before, today);
    if (refusal) throw new BusinessRuleError('RATE_HISTORY', refusal);
    const previous = before.filter((p) => p.id !== target.id).at(-1)!;
    const reopens = previous.validTo === dayBefore(target.validFrom);
    const after = before.filter((p) => p.id !== target.id).map((p) => (reopens && p.id === previous.id ? { ...p, validTo: null } : p));

    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, ctx, first, version);
      await tx.mdmTaxCode.delete({ where: { id: target.id } });
      if (reopens) await tx.mdmTaxCode.update({ where: { id: previous.id }, data: { validTo: null, updatedBy: ctx.user.code } });
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.TAX_CODE,
        entityId: first.id,
        code,
        action: 'rate_removed',
        message: `Rate for ${code} removed: ${percentText(target.rate)} from ${dayText(target.validFrom)} (it had not started)`,
        changes: diffRecord(taxAudit(record(first), before), taxAudit(record(first), after), TAX_LABELS),
        event: CORE_EVENT.TAX_CODE_UPDATED,
        snapshot: taxSnapshot(record(first), after),
      });
    });
    return this.query.detail(ctx, code);
  }

  /** Delete only while no document and no item uses the code (rule 3), with all its rates. */
  async remove(ctx: RequestContext, code: string, version: number) {
    const tenantId = ctx.tenantId;
    const rows = await this.query.rows(ctx, code);
    const first = rows[0]!;
    if (first.version !== version) throw new StaleVersionError();
    const [usage, items] = await Promise.all([this.usage.check({ tenantId, kind: 'TAX_CODE', code }), this.query.itemUse(tenantId, code)]);
    const refusal = deleteRefusal('TAX_CODE', code, usage, [{ label: 'items', count: items.total }]);
    if (refusal) throw new BusinessRuleError('IN_USE', refusal);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, ctx, first, version);
      await tx.mdmTaxCode.deleteMany({ where: { tenantId, code } });
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.TAX_CODE,
        entityId: first.id,
        code,
        action: 'deleted',
        message: `Tax code ${code} deleted (nothing used it)`,
        event: CORE_EVENT.TAX_CODE_DELETED,
        snapshot: taxSnapshot(record(first), rows.map(periodOf)),
      });
    });
    return { deleted: true, code };
  }

  /** Every change to a code bumps its anchor row's version, so two people cannot change the same code at once. */
  private async lock(tx: Tx, ctx: RequestContext, first: MdmTaxCode, version: number): Promise<void> {
    const saved = await tx.mdmTaxCode.updateMany({ where: { id: first.id, tenantId: ctx.tenantId, version }, data: { version: { increment: 1 }, updatedBy: ctx.user.code } });
    if (saved.count === 0) throw new StaleVersionError();
  }
}
