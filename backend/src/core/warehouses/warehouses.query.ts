import { Injectable } from '@nestjs/common';
import type { MdmWarehouse } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_ENTITY } from '../core.constants';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { deactivateRefusal, deleteRefusal } from '../usage/usage.rules';
import { branchText, type WarehouseAction } from './warehouses.rules';

/** C13 · Warehouses, with their locations read only (they belong to the WMS). */
@Injectable()
export class WarehousesQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: RecordUsageRegistry,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
  ) {}

  async list(ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const [warehouses, locations, branches] = await Promise.all([
      this.prisma.mdmWarehouse.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }),
      this.prisma.mdmLocation.findMany({ where: { tenantId }, orderBy: { code: 'asc' }, select: { code: true, name: true, warehouseCode: true, isActive: true } }),
      this.branches(tenantId),
    ]);
    const branch = new Map(branches.map((b) => [b.code, b]));
    return {
      warehouses: warehouses.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        branchCode: w.branchCode,
        branch: branchText(branch.get(w.branchCode), w.branchCode),
        isActive: w.isActive,
        version: w.version,
        locations: locations.filter((l) => l.warehouseCode === w.code).map(({ code, name, isActive }) => ({ code, name, isActive })),
      })),
      branches: branches.filter((b) => b.isActive).map(({ code, name }) => ({ code, name })),
      canEdit: this.permissions.has(ctx.user.roles, P.WAREHOUSE_EDIT),
    };
  }

  /** One warehouse for its dialog: where it is used, and whether it may be made inactive or deleted. */
  async detail(ctx: RequestContext, id: string) {
    const tenantId = ctx.tenantId;
    const w = await this.load(ctx, id);
    const [usage, locations, activity] = await Promise.all([
      this.usage.check({ tenantId, kind: 'WAREHOUSE', code: w.code }),
      this.prisma.mdmLocation.count({ where: { tenantId, warehouseCode: w.code } }),
      this.activity.listFor(tenantId, CORE_ENTITY.WAREHOUSE, w.id),
    ]);
    const remove = deleteRefusal('WAREHOUSE', w.code, usage, [{ label: 'locations', count: locations }]);
    const deactivate = w.isActive ? deactivateRefusal(w.code, usage) : null;
    const canEdit = this.permissions.has(ctx.user.roles, P.WAREHOUSE_EDIT);
    const allowedActions: WarehouseAction[] = canEdit ? ['edit', ...(remove ? [] : (['delete'] as const))] : [];
    return {
      id: w.id,
      code: w.code,
      name: w.name,
      branchCode: w.branchCode,
      isActive: w.isActive,
      version: w.version,
      usage,
      activity,
      allowedActions,
      refusals: { ...(remove && { delete: remove }), ...(deactivate && { deactivate }), ...(usage.documents > 0 && { branch: `Used on ${usage.documents} documents, so the branch stays.` }) },
    };
  }

  async load(ctx: RequestContext, id: string): Promise<MdmWarehouse> {
    const w = await this.prisma.mdmWarehouse.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!w) throw new NotFoundError('Warehouse');
    return w;
  }

  branches(tenantId: string) {
    return this.prisma.mdmBranch.findMany({ where: { tenantId }, orderBy: { code: 'asc' }, select: { code: true, name: true, isActive: true } });
  }
}
