import { Injectable } from '@nestjs/common';
import type { MdmUom } from '@prisma/client';
import type { RequestContext } from '../../platform/context/request-context';
import { BusinessRuleError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_ENTITY, CORE_EVENT } from '../core.constants';
import { changeMessage, diffRecord } from '../shared/audit.rules';
import { CoreRecordsService } from '../shared/core-records.service';
import { deleteRefusal } from '../usage/usage.rules';
import type { CreateUomDto, UpdateUomDto } from './dto/uom.dto';
import { deactivateUnitError, decimalsChangeError, UOM_LABELS } from './uoms.rules';
import { UomsQuery } from './uoms.query';

const snapshot = (u: Pick<MdmUom, 'code' | 'name' | 'decimals' | 'isActive'>) => ({ code: u.code, name: u.name, decimals: u.decimals, isActive: u.isActive });

/** C11 commands: add, change and delete a unit. One transaction each, with activity and an mdm.uom.* event. */
@Injectable()
export class UomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: CoreRecordsService,
    private readonly usage: RecordUsageRegistry,
    private readonly query: UomsQuery,
  ) {}

  async create(ctx: RequestContext, dto: CreateUomDto) {
    const tenantId = ctx.tenantId;
    const [taken, deleted] = await Promise.all([
      this.prisma.mdmUom.findUnique({ where: { tenantId_code: { tenantId, code: dto.code } }, select: { name: true } }),
      this.prisma.sysActivity.findFirst({ where: { tenantId, entityType: CORE_ENTITY.UOM, docNo: dto.code, action: 'deleted' }, select: { id: true } }),
    ]);
    if (taken) throw ValidationFailedError.field('code', `${dto.code} is already the code of ${taken.name}.`);
    if (deleted) throw ValidationFailedError.field('code', `${dto.code} belonged to a unit that was deleted. Codes are never used again.`);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.mdmUom.create({ data: { tenantId, code: dto.code, name: dto.name, decimals: dto.decimals, createdBy: ctx.user.code, updatedBy: ctx.user.code } });
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.UOM,
        entityId: row.id,
        code: row.code,
        action: 'created',
        message: `Unit ${row.code} added`,
        changes: diffRecord(null, row, UOM_LABELS),
        event: CORE_EVENT.UOM_UPDATED,
        snapshot: snapshot(row),
      });
    });
    return this.query.list(ctx);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateUomDto) {
    const tenantId = ctx.tenantId;
    const before = await this.query.load(ctx, id);
    if (before.version !== dto.version) throw new StaleVersionError();
    if (dto.decimals < before.decimals || (before.isActive && !dto.isActive)) {
      const [usage, core] = await Promise.all([this.usage.check({ tenantId, kind: 'UOM', code: before.code }), this.query.coreUse(tenantId, before.code)]);
      const used = usage.documents > 0 || core.items > 0 || core.conversions > 0 || core.prices > 0;
      const decimals = decimalsChangeError(before.code, before.decimals, dto.decimals, used);
      if (decimals) throw new BusinessRuleError('UNIT_IN_USE', decimals);
      const deactivate = before.isActive && !dto.isActive ? deactivateUnitError(before.code, core.activeItems) : null;
      if (deactivate) throw new BusinessRuleError('UNIT_IN_USE', deactivate);
    }
    const after = { ...before, name: dto.name, decimals: dto.decimals, isActive: dto.isActive };
    const changes = diffRecord(before, after, UOM_LABELS);
    if (!changes.length) return this.query.list(ctx);
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.mdmUom.updateMany({
        where: { id, tenantId, version: dto.version },
        data: { name: dto.name, decimals: dto.decimals, isActive: dto.isActive, version: { increment: 1 }, updatedBy: ctx.user.code },
      });
      if (saved.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.UOM,
        entityId: id,
        code: before.code,
        action: 'updated',
        message: `Unit ${before.code}: ${changeMessage(changes).replace(/^Changed/, 'changed')}`,
        changes,
        event: CORE_EVENT.UOM_UPDATED,
        snapshot: snapshot(after),
      });
    });
    return this.query.list(ctx);
  }

  /** Delete only while nothing uses the unit: no document, item, conversion or price-list row. */
  async remove(ctx: RequestContext, id: string, version: number) {
    const tenantId = ctx.tenantId;
    const unit = await this.query.load(ctx, id);
    if (unit.version !== version) throw new StaleVersionError();
    const [usage, core] = await Promise.all([this.usage.check({ tenantId, kind: 'UOM', code: unit.code }), this.query.coreUse(tenantId, unit.code)]);
    const refusal = deleteRefusal('UOM', unit.code, usage, [
      { label: 'items', count: core.items },
      { label: 'conversions', count: core.conversions },
      { label: 'price lists', count: core.prices },
    ]);
    if (refusal) throw new BusinessRuleError('IN_USE', refusal);
    await this.prisma.$transaction(async (tx) => {
      const gone = await tx.mdmUom.deleteMany({ where: { id, tenantId, version } });
      if (gone.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.UOM,
        entityId: id,
        code: unit.code,
        action: 'deleted',
        message: `Unit ${unit.code} deleted (nothing used it)`,
        event: CORE_EVENT.UOM_DELETED,
        snapshot: snapshot(unit),
      });
    });
    return this.query.list(ctx);
  }
}
