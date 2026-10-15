import { Injectable } from '@nestjs/common';
import type { MdmWarehouse } from '@prisma/client';
import type { RequestContext } from '../../platform/context/request-context';
import { BusinessRuleError, StaleVersionError, ValidationFailedError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_ENTITY, CORE_EVENT } from '../core.constants';
import { changeMessage, diffRecord } from '../shared/audit.rules';
import { CoreRecordsService } from '../shared/core-records.service';
import { deactivateRefusal, deleteRefusal } from '../usage/usage.rules';
import type { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';
import { branchChangeError, WAREHOUSE_LABELS } from './warehouses.rules';
import { WarehousesQuery } from './warehouses.query';

const snapshot = (w: Pick<MdmWarehouse, 'code' | 'name' | 'branchCode' | 'isActive'>) => ({ code: w.code, name: w.name, branchCode: w.branchCode, isActive: w.isActive });
const audit = (w: Pick<MdmWarehouse, 'name' | 'branchCode' | 'isActive'>) => ({ name: w.name, branchCode: w.branchCode, isActive: w.isActive ? 'Active' : 'Inactive' });

/** C13 commands: add, change and delete a warehouse. One transaction each, with activity and an mdm.warehouse.* event. */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: CoreRecordsService,
    private readonly usage: RecordUsageRegistry,
    private readonly query: WarehousesQuery,
  ) {}

  /** A new warehouse has no locations: the WMS adds them once it is connected. */
  async create(ctx: RequestContext, dto: CreateWarehouseDto) {
    const tenantId = ctx.tenantId;
    const [taken, deleted] = await Promise.all([
      this.prisma.mdmWarehouse.findUnique({ where: { tenantId_code: { tenantId, code: dto.code } }, select: { name: true } }),
      this.prisma.sysActivity.findFirst({ where: { tenantId, entityType: CORE_ENTITY.WAREHOUSE, docNo: dto.code, action: 'deleted' }, select: { id: true } }),
    ]);
    if (taken) throw ValidationFailedError.field('code', `${dto.code} is already the code of ${taken.name}.`);
    if (deleted) throw ValidationFailedError.field('code', `${dto.code} belonged to a warehouse that was deleted. Codes are never used again.`);
    await this.checkBranch(ctx, dto.branchCode, null);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.mdmWarehouse.create({ data: { tenantId, code: dto.code, name: dto.name, branchCode: dto.branchCode, createdBy: ctx.user.code, updatedBy: ctx.user.code } });
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.WAREHOUSE,
        entityId: row.id,
        code: row.code,
        action: 'created',
        message: `Warehouse ${row.code} added`,
        changes: diffRecord(null, audit(row), WAREHOUSE_LABELS),
        event: CORE_EVENT.WAREHOUSE_UPDATED,
        snapshot: snapshot(row),
        extra: { created: true },
      });
    });
    return this.query.list(ctx);
  }

  /** The branch is fixed once documents use the warehouse; it is made inactive only while no open document uses it. */
  async update(ctx: RequestContext, id: string, dto: UpdateWarehouseDto) {
    const tenantId = ctx.tenantId;
    const before = await this.query.load(ctx, id);
    if (before.version !== dto.version) throw new StaleVersionError();
    const after = { ...before, name: dto.name, branchCode: dto.branchCode, isActive: dto.isActive };
    const changes = diffRecord(audit(before), audit(after), WAREHOUSE_LABELS);
    if (!changes.length) return this.query.list(ctx);
    if (after.branchCode !== before.branchCode || (before.isActive && !after.isActive)) {
      const usage = await this.usage.check({ tenantId, kind: 'WAREHOUSE', code: before.code });
      if (after.branchCode !== before.branchCode) {
        const error = branchChangeError(before.code, usage.documents);
        if (error) throw ValidationFailedError.field('branchCode', error);
        await this.checkBranch(ctx, after.branchCode, before.branchCode);
      }
      const refusal = before.isActive && !after.isActive ? deactivateRefusal(before.code, usage) : null;
      if (refusal) throw new BusinessRuleError('IN_USE', refusal);
    }
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.mdmWarehouse.updateMany({
        where: { id, tenantId, version: dto.version },
        data: { name: after.name, branchCode: after.branchCode, isActive: after.isActive, version: { increment: 1 }, updatedBy: ctx.user.code },
      });
      if (saved.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.WAREHOUSE,
        entityId: id,
        code: before.code,
        action: 'updated',
        message: `Warehouse ${before.code}: ${changeMessage(changes).replace(/^Changed/, 'changed')}`,
        changes,
        event: CORE_EVENT.WAREHOUSE_UPDATED,
        snapshot: snapshot(after),
      });
    });
    return this.query.list(ctx);
  }

  /** Delete only while no document uses the warehouse and it has no locations (rule 3). */
  async remove(ctx: RequestContext, id: string, version: number) {
    const tenantId = ctx.tenantId;
    const w = await this.query.load(ctx, id);
    if (w.version !== version) throw new StaleVersionError();
    const [usage, locations] = await Promise.all([
      this.usage.check({ tenantId, kind: 'WAREHOUSE', code: w.code }),
      this.prisma.mdmLocation.count({ where: { tenantId, warehouseCode: w.code } }),
    ]);
    const refusal = deleteRefusal('WAREHOUSE', w.code, usage, [{ label: 'locations', count: locations }]);
    if (refusal) throw new BusinessRuleError('IN_USE', refusal);
    await this.prisma.$transaction(async (tx) => {
      const gone = await tx.mdmWarehouse.deleteMany({ where: { id, tenantId, version } });
      if (gone.count === 0) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CORE_ENTITY.WAREHOUSE,
        entityId: id,
        code: w.code,
        action: 'deleted',
        message: `Warehouse ${w.code} deleted (nothing used it)`,
        event: CORE_EVENT.WAREHOUSE_DELETED,
        snapshot: snapshot(w),
      });
    });
    return this.query.list(ctx);
  }

  /** The branch comes from Configuration (read through the port); a warehouse keeps an inactive one it had. */
  private async checkBranch(ctx: RequestContext, code: string, had: string | null): Promise<void> {
    const branch = (await this.query.branches(ctx.tenantId)).find((b) => b.code === code);
    if (!branch || (!branch.isActive && had !== code)) throw ValidationFailedError.field('branchCode', 'Pick the branch from the list.');
  }
}
