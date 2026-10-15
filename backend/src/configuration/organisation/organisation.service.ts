import { Injectable } from '@nestjs/common';
import { Prisma, type SysBranch, type SysLegalEntity } from '@prisma/client';
import { changeMessage, diffRecord } from '../../platform/activity/audit.rules';
import type { RequestContext } from '../../platform/context/request-context';
import { BusinessRuleError, StaleVersionError, ValidationFailedError, type FieldError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CONFIG_ENTITY, CONFIG_EVENT } from '../configuration.constants';
import { ConfigRecordsService } from '../shared/config-records.service';
import type { CreateBranchDto, CreateCompanyDto, UpdateBranchDto, UpdateCompanyDto } from './dto/organisation.dto';
import { OrganisationQuery } from './organisation.query';
import {
  BRANCH_LABELS,
  branchActivateRefusal,
  branchDeactivateRefusal,
  COMPANY_LABELS,
  companyDeactivateRefusal,
  companyMoveRefusal,
  demoFieldsOf,
  parentError,
  remainingDemoFields,
} from './organisation.rules';

type CompanyFields = Omit<CreateCompanyDto, 'code'>;
type BranchFields = Omit<CreateBranchDto, 'code'>;

const companyData = (dto: CompanyFields) => ({
  legalName: dto.legalName,
  registrationNo: dto.registrationNo ?? null,
  tin: dto.tin ?? null,
  salesTaxNo: dto.salesTaxNo ?? null,
  serviceTaxNo: dto.serviceTaxNo ?? null,
  myinvoisName: dto.myinvoisName ?? null,
  address: dto.address ?? null,
  phone: dto.phone ?? null,
  email: dto.email ?? null,
});

const companySnapshot = (c: SysLegalEntity) => ({
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
  isActive: c.isActive,
});

/** A branch as the audit and the event read it: the company and parent by code. */
const branchView = (b: Pick<SysBranch, 'name' | 'docPrefix' | 'address' | 'phone' | 'email' | 'myinvoisBranchName' | 'isActive'>, company: string, parent: string | null) => ({
  name: b.name,
  company,
  parent,
  docPrefix: b.docPrefix,
  address: b.address,
  phone: b.phone,
  email: b.email,
  myinvoisBranchName: b.myinvoisBranchName,
  isActive: b.isActive,
});

/** A04 Company and A05 Branches: every change in one transaction with its activity line and config.* event. */
@Injectable()
export class OrganisationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: ConfigRecordsService,
    private readonly usage: RecordUsageRegistry,
    private readonly query: OrganisationQuery,
  ) {}

  // ── Company ────────────────────────────────────────────────────────────────

  async createCompany(ctx: RequestContext, dto: CreateCompanyDto) {
    const taken = await this.prisma.sysLegalEntity.findFirst({ where: { tenantId: ctx.tenantId, code: dto.code } });
    if (taken) throw ValidationFailedError.field('code', `${dto.code} is already a company code.`);
    const row = await this.prisma.$transaction(async (tx) => {
      const c = await tx.sysLegalEntity.create({ data: { tenantId: ctx.tenantId, code: dto.code, ...companyData(dto), createdBy: ctx.user.code, updatedBy: ctx.user.code } });
      await this.records.record(tx, ctx, {
        entityType: CONFIG_ENTITY.LEGAL_ENTITY,
        entityId: c.id,
        code: c.code,
        action: 'created',
        message: `Company ${c.code} created`,
        changes: diffRecord(null, companyData(dto), COMPANY_LABELS),
        event: CONFIG_EVENT.LEGAL_ENTITY_UPDATED,
        snapshot: companySnapshot(c),
      });
      return c;
    });
    return this.query.company(ctx, row.id);
  }

  async updateCompany(ctx: RequestContext, id: string, dto: UpdateCompanyDto) {
    const before = await this.query.findCompany(ctx, id);
    if (before.version !== dto.version) throw new StaleVersionError();
    const after = companyData(dto);
    const changes = diffRecord(before, after, COMPANY_LABELS);
    if (!changes.length) return this.query.company(ctx, id);
    await this.prisma.$transaction(async (tx) => {
      const demoFields = remainingDemoFields(demoFieldsOf(before.demoFields), before, after);
      const saved = await tx.sysLegalEntity.updateMany({
        where: { id, version: before.version },
        data: { ...after, demoFields: demoFields.length ? demoFields : Prisma.DbNull, version: { increment: 1 }, updatedBy: ctx.user.code },
      });
      if (saved.count !== 1) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CONFIG_ENTITY.LEGAL_ENTITY,
        entityId: id,
        code: before.code,
        action: 'updated',
        message: changeMessage(changes),
        changes,
        event: CONFIG_EVENT.LEGAL_ENTITY_UPDATED,
        snapshot: companySnapshot({ ...before, ...after }),
      });
    });
    return this.query.company(ctx, id);
  }

  /** A company is made inactive only when none of its branches is active (rule 6); activating is always allowed. */
  async setCompanyActive(ctx: RequestContext, id: string, active: boolean, version: number) {
    const c = await this.query.findCompany(ctx, id);
    if (c.version !== version) throw new StaleVersionError();
    if (c.isActive === active) return this.query.company(ctx, id);
    if (!active) {
      const branches = await this.prisma.sysBranch.findMany({ where: { tenantId: ctx.tenantId, legalEntityId: id, isActive: true }, orderBy: { code: 'asc' }, select: { code: true } });
      const refusal = companyDeactivateRefusal(c.legalName, branches.map((b) => b.code));
      if (refusal) throw new BusinessRuleError('COMPANY_HAS_ACTIVE_BRANCHES', refusal);
    }
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.sysLegalEntity.updateMany({ where: { id, version }, data: { isActive: active, version: { increment: 1 }, updatedBy: ctx.user.code } });
      if (saved.count !== 1) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CONFIG_ENTITY.LEGAL_ENTITY,
        entityId: id,
        code: c.code,
        action: active ? 'activated' : 'deactivated',
        message: `Company ${c.code} made ${active ? 'active' : 'inactive'}`,
        changes: [{ field: 'isActive', label: 'Active', from: active ? 'No' : 'Yes', to: active ? 'Yes' : 'No' }],
        event: CONFIG_EVENT.LEGAL_ENTITY_UPDATED,
        snapshot: companySnapshot({ ...c, isActive: active }),
      });
    });
    return this.query.company(ctx, id);
  }

  // ── Branches ───────────────────────────────────────────────────────────────

  async createBranch(ctx: RequestContext, dto: CreateBranchDto) {
    const tenantId = ctx.tenantId;
    const taken = await this.prisma.sysBranch.findFirst({ where: { tenantId, code: dto.code } });
    const errors: FieldError[] = taken ? [{ field: 'code', message: `${dto.code} is already a branch code.` }] : [];
    const { company, parent } = await this.check(ctx, null, dto, errors);
    if (errors.length) throw new ValidationFailedError(errors);

    const data = { ...this.branchData(dto), docPrefix: dto.docPrefix ?? dto.code, isActive: true };
    const row = await this.prisma.$transaction(async (tx) => {
      const b = await tx.sysBranch.create({ data: { tenantId, code: dto.code, ...data, createdBy: ctx.user.code, updatedBy: ctx.user.code } });
      const view = branchView(b, company.code, parent?.code ?? null);
      await this.records.record(tx, ctx, {
        entityType: CONFIG_ENTITY.BRANCH,
        entityId: b.id,
        code: b.code,
        action: 'created',
        message: `Branch ${b.code} added`,
        changes: diffRecord(null, view, BRANCH_LABELS),
        event: CONFIG_EVENT.BRANCH_UPDATED,
        snapshot: { code: b.code, ...view },
      });
      return b;
    });
    return this.query.branch(ctx, row.id);
  }

  async updateBranch(ctx: RequestContext, id: string, dto: UpdateBranchDto) {
    const tenantId = ctx.tenantId;
    const before = await this.query.findBranch(ctx, id);
    if (before.version !== dto.version) throw new StaleVersionError();
    const errors: FieldError[] = [];
    const { company, parent } = await this.check(ctx, before, dto, errors);
    if (errors.length) throw new ValidationFailedError(errors);

    const moving = dto.legalEntityId !== before.legalEntityId;
    if (moving || before.isActive !== dto.isActive) {
      const usage = await this.usage.check({ tenantId, kind: 'BRANCH', code: before.code });
      if (moving) {
        const refusal = companyMoveRefusal(before.code, usage.documents);
        if (refusal) throw new BusinessRuleError('BRANCH_HAS_DOCUMENTS', refusal);
        const children = await this.prisma.sysBranch.findMany({ where: { tenantId, parentId: id }, orderBy: { code: 'asc' }, select: { code: true } });
        if (children.length) throw new BusinessRuleError('BRANCH_HAS_CHILDREN', `${children.map((c) => c.code).join(', ')} ${children.length === 1 ? 'sits' : 'sit'} under ${before.code}. Move ${children.length === 1 ? 'it' : 'them'} first.`);
      }
      if (before.isActive && !dto.isActive) {
        const refusal = branchDeactivateRefusal(before.code, await this.query.onlyBranchFor(tenantId, id), usage.open);
        if (refusal) throw new BusinessRuleError('BRANCH_IN_USE', refusal);
      }
      if (!before.isActive && dto.isActive) {
        const refusal = branchActivateRefusal(company);
        if (refusal) throw new BusinessRuleError('COMPANY_INACTIVE', refusal);
      }
    }

    const data = { ...this.branchData(dto), docPrefix: dto.docPrefix ?? before.code, isActive: dto.isActive };
    const [oldCompany, oldParent] = await Promise.all([
      this.prisma.sysLegalEntity.findUniqueOrThrow({ where: { id: before.legalEntityId }, select: { code: true } }),
      before.parentId ? this.prisma.sysBranch.findUnique({ where: { id: before.parentId }, select: { code: true } }) : null,
    ]);
    const was = branchView(before, oldCompany.code, oldParent?.code ?? null);
    const now = branchView({ ...before, ...data }, company.code, parent?.code ?? null);
    const changes = diffRecord(was, now, BRANCH_LABELS);
    if (!changes.length) return this.query.branch(ctx, id);
    const onlyStatus = changes.length === 1 && changes[0]!.field === 'isActive';

    await this.prisma.$transaction(async (tx) => {
      const demoFields = remainingDemoFields(demoFieldsOf(before.demoFields), before, data);
      const saved = await tx.sysBranch.updateMany({
        where: { id, version: before.version },
        data: { ...data, demoFields: demoFields.length ? demoFields : Prisma.DbNull, version: { increment: 1 }, updatedBy: ctx.user.code },
      });
      if (saved.count !== 1) throw new StaleVersionError();
      await this.records.record(tx, ctx, {
        entityType: CONFIG_ENTITY.BRANCH,
        entityId: id,
        code: before.code,
        action: onlyStatus ? (dto.isActive ? 'activated' : 'deactivated') : 'updated',
        message: onlyStatus ? `Branch ${before.code} made ${dto.isActive ? 'active' : 'inactive'}` : `Branch ${before.code}: ${changeMessage(changes).replace(/^Changed/, 'changed')}`,
        changes,
        event: CONFIG_EVENT.BRANCH_UPDATED,
        snapshot: { code: before.code, ...now },
      });
    });
    return this.query.branch(ctx, id);
  }

  private branchData(dto: BranchFields) {
    return {
      name: dto.name,
      legalEntityId: dto.legalEntityId,
      parentId: dto.parentId ?? null,
      address: dto.address ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      myinvoisBranchName: dto.myinvoisBranchName ?? null,
    };
  }

  /** The picked company is there (and active when it changes), the parent fits (rule 6), and the prefix is free. */
  private async check(ctx: RequestContext, before: SysBranch | null, dto: BranchFields & { code?: string }, errors: FieldError[]) {
    const tenantId = ctx.tenantId;
    const [company, branches] = await Promise.all([
      this.prisma.sysLegalEntity.findFirst({ where: { id: dto.legalEntityId, tenantId } }),
      this.prisma.sysBranch.findMany({ where: { tenantId }, select: { id: true, code: true, name: true, parentId: true, legalEntityId: true, docPrefix: true } }),
    ]);
    if (!company || (!company.isActive && company.id !== before?.legalEntityId)) errors.push({ field: 'legalEntityId', message: 'Pick an active company.' });
    const parentProblem = company ? parentError(before?.id ?? null, dto.parentId ?? null, company.id, branches) : null;
    if (parentProblem) errors.push({ field: 'parentId', message: parentProblem });
    const prefix = dto.docPrefix ?? before?.code ?? dto.code;
    const clash = branches.find((b) => b.id !== before?.id && (b.docPrefix ?? b.code) === prefix);
    if (prefix && clash) errors.push({ field: 'docPrefix', message: `${prefix} is already the document prefix of ${clash.name}.` });
    return { company: company ?? { code: '', legalName: '', isActive: false }, parent: branches.find((b) => b.id === dto.parentId) ?? null };
  }
}
