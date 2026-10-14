import { Injectable } from '@nestjs/common';
import type { MdmContractPrice, MdmSupplier, Prisma } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, pageArgs, statusFromKey, toListResponse } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_ENTITY } from '../core.constants';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { deactivateRefusal, deleteRefusal } from '../usage/usage.rules';
import type { SupplierListQueryDto } from './dto/supplier.dto';
import { eInvoiceGap, STATUS_LABEL, statusActions, SUPPLIER_STATUSES, type SupplierAction, type SupplierStatus } from './suppliers.rules';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** C06 supplier list and C07 supplier (CLAUDE.md → Phase 3). Reads mdm_ tables; where a supplier is used comes from the record-usage check. */
@Injectable()
export class SuppliersQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: RecordUsageRegistry,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly clock: ClockService,
  ) {}

  async list(ctx: RequestContext, query: SupplierListQueryDto) {
    const tenantId = ctx.tenantId;
    const q = query.q?.trim();
    const base: Prisma.MdmSupplierWhereInput = {
      tenantId,
      ...(q && { OR: [{ code: { contains: q } }, { name: { contains: q } }, { shortName: { contains: q } }, { tin: { contains: q } }] }),
      ...(query.supplies && { category: query.supplies }),
      ...(query.walkIn === 'hidden' && { isWalkIn: false }),
      ...(query.walkIn === 'only' && { isWalkIn: true }),
    };
    const status = statusFromKey(query.status, SUPPLIER_STATUSES);
    const where = { ...base, ...(status && { status }) };
    const [rows, total, grouped] = await Promise.all([
      this.prisma.mdmSupplier.findMany({ where, orderBy: { code: 'asc' }, ...pageArgs(query) }),
      this.prisma.mdmSupplier.count({ where }),
      this.prisma.mdmSupplier.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const items = rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      shortName: s.shortName,
      category: s.category,
      isWalkIn: s.isWalkIn,
      tin: s.tin,
      sstNo: s.sstNo,
      paymentTerm: s.paymentTermDays === 0 ? 'Cash' : `${s.paymentTermDays} days`,
      email: s.email,
      status: s.status,
      statusLabel: STATUS_LABEL[s.status as SupplierStatus],
    }));
    return toListResponse(items, total, query, buildStatusCounts(grouped, SUPPLIER_STATUSES));
  }

  /** What C06's "Supplies" filter offers: the different things suppliers supply. */
  async supplies(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.mdmSupplier.findMany({ where: { tenantId, category: { not: null } }, select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' } });
    return rows.map((r) => r.category!).filter(Boolean);
  }

  async detail(ctx: RequestContext, id: string) {
    const tenantId = ctx.tenantId;
    const s = await this.load(ctx, id);
    const [contracts, usage, activity, preferredBy] = await Promise.all([
      this.contracts(tenantId, s.code),
      this.usage.check({ tenantId, kind: 'SUPPLIER', code: s.code }),
      this.activity.listFor(tenantId, CORE_ENTITY.SUPPLIER, s.id),
      this.prisma.mdmItem.count({ where: { tenantId, preferredSupplierCode: s.code } }),
    ]);
    const items = await this.prisma.mdmItem.findMany({ where: { tenantId, code: { in: contracts.map((c) => c.itemCode) } }, select: { id: true, code: true, name: true, baseUom: true } });
    const item = new Map(items.map((i) => [i.code, i]));
    const today = this.clock.today();

    const canEdit = this.permissions.has(ctx.user.roles, P.SUPPLIER_EDIT);
    const canEditContracts = this.permissions.has(ctx.user.roles, P.SUPPLIER_CONTRACT);
    const deactivate = deactivateRefusal(s.code, usage);
    const remove = deleteRefusal('SUPPLIER', s.code, usage, [{ label: 'items as preferred supplier', count: preferredBy }]);
    const allowedActions: SupplierAction[] = [];
    const refusals: Partial<Record<SupplierAction, string>> = {};
    if (canEdit) allowedActions.push('edit');
    if (canEditContracts) allowedActions.push('editContracts');
    if (canEdit) {
      for (const action of statusActions(s.status as SupplierStatus)) {
        if (action === 'block' && deactivate) refusals.block = deactivate;
        else allowedActions.push(action);
      }
      if (remove) refusals.delete = remove;
      else allowedActions.push('delete');
    }
    return {
      ...this.fields(s),
      contractPrices: contracts.map((c) => {
        const from = isoDay(c.validFrom);
        const to = c.validTo ? isoDay(c.validTo) : null;
        return {
          itemId: item.get(c.itemCode)?.id ?? null,
          itemCode: c.itemCode,
          itemName: item.get(c.itemCode)?.name ?? c.itemCode,
          uomCode: item.get(c.itemCode)?.baseUom ?? null,
          unitPrice: c.unitPrice.toFixed(4),
          validFrom: from,
          validTo: to,
          isCurrent: from <= today && (!to || to >= today),
        };
      }),
      eInvoiceGap: eInvoiceGap(s),
      usage,
      activity,
      allowedActions,
      refusals,
    };
  }

  async load(ctx: RequestContext, id: string): Promise<MdmSupplier> {
    const s = await this.prisma.mdmSupplier.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!s) throw new NotFoundError('Supplier');
    return s;
  }

  contracts(tenantId: string, supplierCode: string): Promise<MdmContractPrice[]> {
    return this.prisma.mdmContractPrice.findMany({ where: { tenantId, supplierCode }, orderBy: [{ itemCode: 'asc' }, { validFrom: 'asc' }] });
  }

  private fields(s: MdmSupplier) {
    return {
      id: s.id,
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
      statusLabel: STATUS_LABEL[s.status as SupplierStatus],
      version: s.version,
    };
  }
}
