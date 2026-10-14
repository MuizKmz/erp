import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../platform/context/request-context';
import { BusinessRuleError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CORE_ENTITY, CORE_EVENT } from '../core.constants';
import { changeMessage, diffRecord } from '../shared/audit.rules';
import { CoreRecordsService } from '../shared/core-records.service';
import type { ReferenceEntryDto, UpdateReferenceEntryDto } from './dto/reference.dto';
import { ReferenceQuery, referenceTable, type ReferenceRow } from './reference.query';
import { daysChangeError, LIST_WORDS, REFERENCE_LABELS, referenceDeleteRefusal, renameError, type ReferenceList } from './reference.rules';

const audit = (row: Pick<ReferenceRow, 'name' | 'days' | 'isActive'>) => ({ name: row.name, days: row.days, isActive: row.isActive ? 'Active' : 'Inactive' });

/** C12 commands: add, change and delete an entry. One transaction each, with activity and an mdm.reference.* event. */
@Injectable()
export class ReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: CoreRecordsService,
    private readonly query: ReferenceQuery,
  ) {}

  async create(ctx: RequestContext, list: ReferenceList, dto: ReferenceEntryDto) {
    const tenantId = ctx.tenantId;
    const days = this.days(list, dto);
    await this.unique(ctx, list, dto.name, days, null);
    await this.prisma.$transaction(async (tx) => {
      const row = await referenceTable(tx, list).create({
        data: { tenantId, name: dto.name, ...(days !== undefined && { days }), createdBy: ctx.user.code, updatedBy: ctx.user.code },
      });
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.REFERENCE,
        entityId: row.id,
        code: row.name,
        action: 'created',
        message: `${LIST_WORDS[list].one.replace(/^./, (c) => c.toUpperCase())} “${row.name}” added`,
        changes: diffRecord(null, audit(row), REFERENCE_LABELS),
        event: CORE_EVENT.REFERENCE_UPDATED,
        snapshot: { list, ...audit(row), isActive: row.isActive },
        extra: { list, created: true },
      });
    });
    return this.query.lists(ctx);
  }

  /** A name in use never changes (records keep it); a credit term's days likewise. Making an entry inactive is always allowed. */
  async update(ctx: RequestContext, list: ReferenceList, id: string, dto: UpdateReferenceEntryDto) {
    const tenantId = ctx.tenantId;
    const before = await this.query.load(ctx, list, id);
    if (before.version !== dto.version) throw new StaleVersionError();
    const days = list === 'credit-terms' ? this.days(list, dto) : undefined;
    const after = { ...before, name: dto.name, ...(days !== undefined && { days }), isActive: dto.isActive };
    const changes = diffRecord(audit(before), audit(after), REFERENCE_LABELS);
    if (!changes.length) return this.query.lists(ctx);
    if (after.name !== before.name || after.days !== before.days) {
      const use = await this.query.useOf(tenantId, list, before);
      const rename = after.name !== before.name ? renameError(list, before.name, use) : null;
      if (rename) throw ValidationFailedError.field('name', rename);
      const daysError = after.days !== before.days ? daysChangeError(before.name, use) : null;
      if (daysError) throw ValidationFailedError.field('days', daysError);
      await this.unique(ctx, list, after.name, after.days, id);
    }
    await this.prisma.$transaction(async (tx) => {
      const saved = await referenceTable(tx, list).updateMany({
        where: { id, tenantId, version: dto.version },
        data: { name: after.name, ...(days !== undefined && { days }), isActive: after.isActive, version: { increment: 1 }, updatedBy: ctx.user.code },
      });
      if (saved.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.REFERENCE,
        entityId: id,
        code: after.name,
        action: 'updated',
        message: `${LIST_WORDS[list].one.replace(/^./, (c) => c.toUpperCase())} “${before.name}”: ${changeMessage(changes).replace(/^Changed/, 'changed')}`,
        changes,
        event: CORE_EVENT.REFERENCE_UPDATED,
        snapshot: { list, ...audit(after), isActive: after.isActive },
        extra: { list },
      });
    });
    return this.query.lists(ctx);
  }

  async remove(ctx: RequestContext, list: ReferenceList, id: string, version: number) {
    const tenantId = ctx.tenantId;
    const row = await this.query.load(ctx, list, id);
    if (row.version !== version) throw new StaleVersionError();
    const refusal = referenceDeleteRefusal(row.name, await this.query.useOf(tenantId, list, row));
    if (refusal) throw new BusinessRuleError('IN_USE', refusal);
    await this.prisma.$transaction(async (tx) => {
      const gone = await referenceTable(tx, list).deleteMany({ where: { id, tenantId, version } });
      if (gone.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.REFERENCE,
        entityId: id,
        code: row.name,
        action: 'deleted',
        message: `${LIST_WORDS[list].one.replace(/^./, (c) => c.toUpperCase())} “${row.name}” deleted (nothing used it)`,
        event: CORE_EVENT.REFERENCE_DELETED,
        snapshot: { list, ...audit(row), isActive: row.isActive },
        extra: { list },
      });
    });
    return this.query.lists(ctx);
  }

  /** A credit term needs its days; the other lists have none. */
  private days(list: ReferenceList, dto: ReferenceEntryDto): number | undefined {
    if (list !== 'credit-terms') return undefined;
    if (dto.days === undefined || dto.days === null) throw ValidationFailedError.field('days', 'Give the days to pay, 0 for cash.');
    return dto.days;
  }

  /** One entry per name in a list (any case), and one credit term per number of days. */
  private async unique(ctx: RequestContext, list: ReferenceList, name: string, days: number | undefined, exceptId: string | null): Promise<void> {
    const table = referenceTable(this.prisma, list);
    const notThis = exceptId ? { id: { not: exceptId } } : {};
    const sameName = await table.findFirst({ where: { tenantId: ctx.tenantId, name, ...notThis } });
    if (sameName) throw ValidationFailedError.field('name', `“${sameName.name}” is already on the list.`);
    if (days !== undefined) {
      const sameDays = await table.findFirst({ where: { tenantId: ctx.tenantId, days, ...notThis } });
      if (sameDays) throw ValidationFailedError.field('days', `${sameDays.name} already gives ${days} days.`);
    }
  }
}
