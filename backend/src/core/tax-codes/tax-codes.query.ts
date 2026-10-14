import { Injectable } from '@nestjs/common';
import type { MdmTaxCode } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_ENTITY } from '../core.constants';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { deleteRefusal } from '../usage/usage.rules';
import {
  deactivateTaxError,
  latestPeriod,
  percentText,
  periodState,
  removeRateRefusal,
  shownPeriod,
  TYPE_LABEL,
  type Period,
  type TaxCodeAction,
  type TaxType,
} from './tax-codes.rules';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const periodOf = (r: MdmTaxCode): Period & { id: string } => ({ id: r.id, name: r.name, rate: r.rate, validFrom: isoDay(r.validFrom), validTo: r.validTo ? isoDay(r.validTo) : null });

/** How items use a tax code: as purchase tax (buying) or sales tax (selling), and which active items do. */
export interface TaxItemUse {
  buying: number;
  selling: number;
  /** Items that use it either way, each counted once. */
  total: number;
  activeItems: string[];
}

/** C10 · Tax codes with their type and rate history (CLAUDE.md → Phase 3). A code is all its rate rows. */
@Injectable()
export class TaxCodesQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: RecordUsageRegistry,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly clock: ClockService,
  ) {}

  async list(ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const [rows, buying, selling] = await Promise.all([
      this.prisma.mdmTaxCode.findMany({ where: { tenantId }, orderBy: [{ code: 'asc' }, { validFrom: 'asc' }] }),
      this.prisma.mdmItem.groupBy({ by: ['purchaseTaxCode'], where: { tenantId }, _count: { _all: true } }),
      this.prisma.mdmItem.groupBy({ by: ['salesTaxCode'], where: { tenantId, salesTaxCode: { not: null } }, _count: { _all: true } }),
    ]);
    const buys = new Map(buying.map((b) => [b.purchaseTaxCode, b._count._all]));
    const sells = new Map(selling.map((s) => [s.salesTaxCode, s._count._all]));
    const codes = [...new Set(rows.map((r) => r.code))];
    return {
      codes: codes.map((code) => {
        const own = rows.filter((r) => r.code === code);
        const periods = own.map(periodOf);
        const shown = shownPeriod(periods, today);
        const next = periods.find((p) => p.validFrom > today && p.validFrom > shown.validFrom) ?? null;
        const first = own[0]!;
        return {
          code,
          name: shown.name,
          type: first.type as TaxType,
          typeLabel: TYPE_LABEL[first.type as TaxType],
          rate: percentText(shown.rate),
          country: first.country,
          validFrom: shown.validFrom,
          validTo: shown.validTo,
          state: periodState(shown, today),
          next: next && { rate: percentText(next.rate), validFrom: next.validFrom },
          buying: buys.get(code) ?? 0,
          selling: sells.get(code) ?? 0,
          isActive: first.isActive,
        };
      }),
      canEdit: this.permissions.has(ctx.user.roles, P.TAX_EDIT),
    };
  }

  /** One code for its dialog: the periods, where it is used, and what may be done with it. */
  async detail(ctx: RequestContext, code: string) {
    const tenantId = ctx.tenantId;
    const today = this.clock.today();
    const rows = await this.rows(ctx, code);
    const first = rows[0]!;
    const periods = rows.map(periodOf);
    const [usage, items, activity] = await Promise.all([
      this.usage.check({ tenantId, kind: 'TAX_CODE', code }),
      this.itemUse(tenantId, code),
      this.activity.listFor(tenantId, CORE_ENTITY.TAX_CODE, first.id),
    ]);
    const canEdit = this.permissions.has(ctx.user.roles, P.TAX_EDIT);
    const remove = deleteRefusal('TAX_CODE', code, usage, [{ label: 'items', count: items.total }]);
    const deactivate = first.isActive ? deactivateTaxError(code, items.activeItems) : null;
    const allowedActions: TaxCodeAction[] = canEdit ? ['edit', 'newRate', ...(remove ? [] : (['delete'] as const))] : [];
    return {
      code,
      name: latestPeriod(periods).name,
      type: first.type as TaxType,
      typeLabel: TYPE_LABEL[first.type as TaxType],
      country: first.country,
      isActive: first.isActive,
      version: first.version,
      periods: periods.map((p) => ({
        id: p.id,
        name: p.name,
        rate: percentText(p.rate),
        validFrom: p.validFrom,
        validTo: p.validTo,
        state: periodState(p, today),
        removable: canEdit && !removeRateRefusal(p, periods, today),
      })),
      buying: items.buying,
      selling: items.selling,
      documents: usage.documents,
      activity,
      allowedActions,
      refusals: { ...(remove && { delete: remove }), ...(deactivate && { deactivate }) },
    };
  }

  /** All rate rows of a code, oldest first. The first row is the code's anchor: its id and version stand for the code. */
  async rows(ctx: RequestContext, code: string): Promise<MdmTaxCode[]> {
    const rows = await this.prisma.mdmTaxCode.findMany({ where: { tenantId: ctx.tenantId, code }, orderBy: { validFrom: 'asc' } });
    if (!rows.length) throw new NotFoundError(`Tax code ${code}`);
    return rows;
  }

  async itemUse(tenantId: string, code: string): Promise<TaxItemUse> {
    const items = await this.prisma.mdmItem.findMany({ where: { tenantId, OR: [{ purchaseTaxCode: code }, { salesTaxCode: code }] }, select: { code: true, status: true, purchaseTaxCode: true, salesTaxCode: true } });
    return {
      buying: items.filter((i) => i.purchaseTaxCode === code).length,
      selling: items.filter((i) => i.salesTaxCode === code).length,
      total: items.length,
      activeItems: items.filter((i) => i.status === 'ACTIVE').map((i) => i.code).sort(),
    };
  }
}
