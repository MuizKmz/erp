import { Inject, Injectable } from '@nestjs/common';
import type { SysBranch, SysLegalEntity } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CONFIG_ENTITY, CURRENCY_NAME } from '../configuration.constants';
import { CONFIG_PERMISSIONS as P } from '../configuration.permissions';
import {
  branchActivateRefusal,
  branchDeactivateRefusal,
  branchDemoNotice,
  branchInUseText,
  companyActions,
  companyDemoNotice,
  companySubtitle,
  demoFieldsOf,
  treeOrder,
} from './organisation.rules';

/** A04 Company and A05 Branches: what the screens read. Users and documents are counted, never listed in full. */
@Injectable()
export class OrganisationQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly usage: RecordUsageRegistry,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  private canEdit(ctx: RequestContext): boolean {
    return this.permissions.has(ctx.user.roles, P.ORGANISATION_EDIT);
  }

  /** Active users per branch id. */
  async userCounts(tenantId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.sysUserBranch.groupBy({ by: ['branchId'], where: { tenantId, user: { isActive: true } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.branchId, r._count._all]));
  }

  /** Active users for whom this is the only active branch: they could not work if it went (rule 6). */
  async onlyBranchFor(tenantId: string, branchId: string): Promise<string[]> {
    const users = await this.prisma.sysUser.findMany({
      where: { tenantId, isActive: true, branches: { some: { branchId } } },
      orderBy: { name: 'asc' },
      select: { name: true, branches: { where: { branch: { isActive: true } }, select: { branchId: true } } },
    });
    return users.filter((u) => u.branches.every((b) => b.branchId === branchId)).map((u) => u.name);
  }

  async findCompany(ctx: RequestContext, id: string): Promise<SysLegalEntity> {
    const row = await this.prisma.sysLegalEntity.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) throw new NotFoundError('Company');
    return row;
  }

  async findBranch(ctx: RequestContext, id: string): Promise<SysBranch> {
    const row = await this.prisma.sysBranch.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) throw new NotFoundError('Branch');
    return row;
  }

  /** The companies, for the A04 switcher and the branch form's company list. */
  async companies(ctx: RequestContext) {
    const rows = await this.prisma.sysLegalEntity.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, legalName: true, isActive: true, _count: { select: { branches: true } } },
    });
    return { items: rows.map(({ _count, ...c }) => ({ ...c, branches: _count.branches })), canEdit: this.canEdit(ctx) };
  }

  /** A04 · the company with its branches and its activity. */
  async company(ctx: RequestContext, id: string) {
    const tenantId = ctx.tenantId;
    const c = await this.findCompany(ctx, id);
    const [tenant, branches, counts, activity] = await Promise.all([
      this.prisma.sysTenant.findUniqueOrThrow({ where: { id: tenantId }, select: { baseCurrency: true, timezone: true } }),
      this.prisma.sysBranch.findMany({ where: { tenantId, legalEntityId: id } }),
      this.userCounts(tenantId),
      this.activity.listFor(tenantId, CONFIG_ENTITY.LEGAL_ENTITY, id),
    ]);
    const code = new Map(branches.map((b) => [b.id, b.code]));
    const demoFields = demoFieldsOf(c.demoFields);
    const activeBranches = branches.filter((b) => b.isActive).length;
    return {
      id: c.id,
      code: c.code,
      legalName: c.legalName,
      registrationNo: c.registrationNo,
      tin: c.tin,
      salesTaxNo: c.salesTaxNo,
      serviceTaxNo: c.serviceTaxNo,
      myinvoisName: c.myinvoisName,
      address: c.address,
      phone: c.phone,
      email: c.email,
      baseCurrency: tenant.baseCurrency,
      currencyText: `${tenant.baseCurrency} · ${CURRENCY_NAME[tenant.baseCurrency] ?? tenant.baseCurrency}`,
      timeZone: tenant.timezone,
      isActive: c.isActive,
      version: c.version,
      subtitle: companySubtitle(c.legalName, tenant.baseCurrency, branches.length),
      demoFields,
      demoNotice: companyDemoNotice(demoFields),
      branches: treeOrder(branches).map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        parent: b.parentId ? (code.get(b.parentId) ?? null) : null,
        docPrefix: b.docPrefix,
        users: counts.get(b.id) ?? 0,
        isActive: b.isActive,
      })),
      activity,
      allowedActions: companyActions(this.canEdit(ctx), c.isActive, activeBranches),
    };
  }

  /** A05 · the tree: each company with its branches in tree order. */
  async branches(ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const [companies, branches, counts] = await Promise.all([
      this.prisma.sysLegalEntity.findMany({ where: { tenantId }, orderBy: { code: 'asc' }, select: { id: true, code: true, legalName: true, isActive: true } }),
      this.prisma.sysBranch.findMany({ where: { tenantId } }),
      this.userCounts(tenantId),
    ]);
    return {
      companies: companies.map((c) => ({
        ...c,
        branches: treeOrder(branches.filter((b) => b.legalEntityId === c.id)).map((b) => ({
          id: b.id,
          code: b.code,
          name: b.name,
          legalEntityId: b.legalEntityId,
          parentId: b.parentId,
          docPrefix: b.docPrefix,
          users: counts.get(b.id) ?? 0,
          isActive: b.isActive,
          depth: b.depth,
        })),
      })),
      canEdit: this.canEdit(ctx),
    };
  }

  /** A05 · one branch, with what uses it and why it could not be made inactive. */
  async branch(ctx: RequestContext, id: string) {
    const tenantId = ctx.tenantId;
    const b = await this.findBranch(ctx, id);
    const [company, counts, onlyFor, warehouses, usage] = await Promise.all([
      this.prisma.sysLegalEntity.findUniqueOrThrow({ where: { id: b.legalEntityId }, select: { code: true, legalName: true, isActive: true } }),
      this.userCounts(tenantId),
      this.onlyBranchFor(tenantId, id),
      this.masterData.listWarehouses(tenantId, b.code),
      this.usage.check({ tenantId, kind: 'BRANCH', code: b.code }),
    ]);
    const users = counts.get(id) ?? 0;
    const warehouseCodes = warehouses.map((w) => w.code);
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      legalEntityId: b.legalEntityId,
      company,
      parentId: b.parentId,
      docPrefix: b.docPrefix,
      address: b.address,
      phone: b.phone,
      email: b.email,
      myinvoisBranchName: b.myinvoisBranchName,
      isActive: b.isActive,
      version: b.version,
      demoNotice: branchDemoNotice(demoFieldsOf(b.demoFields)),
      inUse: {
        text: branchInUseText(users, warehouseCodes, usage.documents),
        users,
        onlyBranchFor: onlyFor,
        warehouses: warehouseCodes,
        documents: usage.documents,
        open: usage.open,
        references: usage.references,
      },
      refusals: {
        deactivate: b.isActive ? branchDeactivateRefusal(b.code, onlyFor, usage.open) : null,
        activate: b.isActive ? null : branchActivateRefusal(company),
      },
      canEdit: this.canEdit(ctx),
    };
  }
}
