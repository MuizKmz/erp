import { Inject, Injectable } from '@nestjs/common';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toMoneyOrNull } from '../../platform/http/decimal';
import { BusinessRuleError, NotFoundError, ValidationFailedError } from '../../platform/http/errors';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { renderTemplate } from '../shared/email-template.rules';
import { PurchaseSettingsService } from '../shared/purchase-settings.service';
import { PUR_ROLE } from '../shared/purchase.constants';
import type { SaveApprovalRulesDto, SaveDocumentTypesDto, SaveEmailTemplateDto } from './dto/settings.dto';
import {
  formatNumber,
  limitChange,
  ruleProblems,
  sampleValues,
  sequenceProblems,
  TEMPLATE_FIELDS,
  toleranceProblems,
  unknownFieldProblems,
} from './settings.rules';

type Area = 'APPROVAL_RULES' | 'DOCUMENT_TYPES' | 'EMAIL_TEMPLATES';

const DOCUMENT_LABEL: Record<string, string> = { PO: 'Purchase order', PI: 'Purchase invoice', PDN: 'Supplier debit note', CP: 'Cash purchase' };
const CONDITION_LABEL: Record<string, string> = {
  OVER_AMOUNT: 'over RM',
  OUTSIDE_TOLERANCE: 'outside the match tolerance',
  CHARGE_NOT_ON_PO: 'charge is not on the PO',
  BLOCKED_OVER_AMOUNT: 'blocked over RM',
};
const ROLE_LABEL: Record<string, string> = {
  [PUR_ROLE.MANAGER]: 'Purchasing Manager',
  [PUR_ROLE.BRANCH_MANAGER]: 'Branch Manager',
  [PUR_ROLE.FINANCE_DIRECTOR]: 'Finance Director',
};
const SEQUENCE_ORDER = ['PRQ', 'RFQ', 'PO', 'GRN', 'PI', 'CP', 'PDN', 'PRT', 'PCO'];
const rm = (v: string | null) => (v === null ? null : dec(v));

/**
 * Operation Policies: P24 Approval Rules, P25 Document Types, P26 Email Templates.
 * Saving writes the change history (pur_setting_change); changes apply to new documents only.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionRegistry,
    private readonly settings: PurchaseSettingsService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  private canEdit(ctx: RequestContext) {
    return this.permissions.has(ctx.user.roles, P.SETTINGS_MANAGE);
  }

  private history(tenantId: string, area: Area) {
    return this.prisma.purSettingChange
      .findMany({ where: { tenantId, area }, orderBy: { createdAt: 'desc' }, take: 8 })
      .then((rows) => rows.map((r) => ({ id: r.id, message: r.message, userName: r.userName, at: r.createdAt.toISOString() })));
  }

  private async logChanges(tx: Tx, ctx: RequestContext, area: Area, messages: string[]) {
    if (!messages.length) return;
    const at = this.clock.now();
    await tx.purSettingChange.createMany({
      data: messages.map((message, i) => ({ tenantId: ctx.tenantId, area, message, userCode: ctx.user.code, userName: ctx.user.name, createdAt: new Date(at.getTime() + i) })),
    });
  }

  // ── P24 Approval Rules ────────────────────────────────────────────────────

  async approvalRules(ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const [rules, setting, users, branches, history] = await Promise.all([
      this.prisma.purApprovalRule.findMany({ where: { tenantId, isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.settings.settings(tenantId),
      this.masterData.listUsers(tenantId),
      this.masterData.listBranches(tenantId),
      this.history(tenantId, 'APPROVAL_RULES'),
    ]);
    const userName = (code: string | null) => (code ? (users.find((u) => u.code === code)?.name ?? code) : null);
    const branchName = (code: string | null) => (code ? (branches.find((b) => b.code === code)?.name ?? code).replace(/\s+branch$/i, '') : 'All branches');
    const approver = (role: string | null, code: string | null, branchCode: string | null) => {
      if (!role) return null;
      const label = ROLE_LABEL[role] ?? role;
      return role === PUR_ROLE.BRANCH_MANAGER ? `${label} · ${branchName(branchCode)}` : `${label} · ${userName(code)}`;
    };

    const people = [
      { role: PUR_ROLE.MANAGER, label: 'Purchasing Manager' },
      { role: PUR_ROLE.BRANCH_MANAGER, label: 'Penang manager' },
      { role: PUR_ROLE.FINANCE_DIRECTOR, label: 'Finance Director' },
    ].map((p) => {
      const rule = rules.find((r) => r.approverRole === p.role) ?? rules.find((r) => r.secondApproverRole === p.role);
      const code = rule?.approverRole === p.role ? rule.approverCode : rule?.secondApproverCode;
      return { label: p.label, name: userName(code ?? null) ?? '—' };
    });

    return {
      rules: rules.map((r) => ({
        id: r.id,
        docType: r.docType,
        branch: branchName(r.branchCode),
        document: DOCUMENT_LABEL[r.docType] ?? r.docType,
        condition: r.condition,
        conditionLabel: CONDITION_LABEL[r.condition] ?? r.condition,
        thresholdAmount: toMoneyOrNull(r.thresholdAmount),
        approver: r.condition === 'BLOCKED_OVER_AMOUNT' ? 'Needs a PO instead' : approver(r.approverRole, r.approverCode, r.branchCode),
        secondOverAmount: toMoneyOrNull(r.secondOverAmount),
        secondApprover: r.secondApproverRole ? (ROLE_LABEL[r.secondApproverRole] ?? r.secondApproverRole) : null,
        blocked: r.condition === 'BLOCKED_OVER_AMOUNT',
      })),
      tolerance: {
        pricePct: setting.priceTolerancePct.toDecimalPlaces(2).toString(),
        qtyOver: setting.qtyToleranceOver.toDecimalPlaces(4).toString(),
        taxAmount: toMoney(setting.taxToleranceAmount),
      },
      switches: {
        rfqRequiredOn: setting.rfqRequiredOn,
        rfqRequiredOver: toMoney(setting.rfqRequiredOver),
        rfqMinReplies: setting.rfqMinReplies,
        allowOverReceipt: setting.allowOverReceipt,
        autoDraftBuyToOrder: setting.autoDraftBuyToOrder,
        onlyActiveSuppliers: setting.onlyActiveSuppliers,
        buyerCannotApproveOwnPo: setting.buyerCannotApproveOwnPo,
      },
      history,
      people,
      canEdit: this.canEdit(ctx),
    };
  }

  async saveApprovalRules(ctx: RequestContext, dto: SaveApprovalRulesDto) {
    const tenantId = ctx.tenantId;
    const [rules, setting, branches] = await Promise.all([
      this.prisma.purApprovalRule.findMany({ where: { tenantId, isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.settings.settings(tenantId),
      this.masterData.listBranches(tenantId),
    ]);
    const branchName = (code: string | null) => (code ? (branches.find((b) => b.code === code)?.name ?? code).replace(/\s+branch$/i, '') : '');
    const label = (r: (typeof rules)[number]) => (r.docType === 'CP' ? 'Cash purchase limit' : `${branchName(r.branchCode)} ${r.docType} limit`.trim());

    const edits = dto.rules.map((d, index) => {
      const rule = rules.find((r) => r.id === d.id);
      if (!rule) throw new NotFoundError('Approval rule');
      const hasAmount = rule.condition === 'OVER_AMOUNT' || rule.condition === 'BLOCKED_OVER_AMOUNT';
      return {
        index,
        rule,
        label: label(rule),
        threshold: hasAmount ? (d.thresholdAmount ?? null) : null,
        secondOver: rule.secondApproverRole ? (d.secondOverAmount ?? null) : null,
      };
    });
    const problems = [
      ...ruleProblems(edits.map((e) => ({ index: e.index, label: e.label, threshold: e.threshold, secondOver: e.secondOver }))),
      ...toleranceProblems(dto.tolerance),
    ];
    if (!dec(dto.switches.rfqRequiredOver).gt(0)) problems.push({ field: 'switches.rfqRequiredOver', message: 'The RFQ amount must be more than RM 0.00.' });
    if (problems.length) throw new ValidationFailedError(problems, problems[0]!.message);

    const messages: string[] = [];
    for (const e of edits) {
      const a = limitChange(e.label, e.rule.thresholdAmount, rm(e.threshold));
      if (a) messages.push(a);
      const b = limitChange(`${e.label.replace(/ limit$/, '')} second approver limit`, e.rule.secondOverAmount, rm(e.secondOver));
      if (b) messages.push(b);
    }
    const t = dto.tolerance;
    if (!setting.priceTolerancePct.eq(dec(t.pricePct))) messages.push(`Price tolerance set to ±${dec(t.pricePct).toString()}%`);
    if (!setting.qtyToleranceOver.eq(dec(t.qtyOver))) messages.push(`Quantity tolerance set to ${dec(t.qtyOver).toString()} over received`);
    if (!setting.taxToleranceAmount.eq(dec(t.taxAmount))) messages.push(`Tax rounding set to ±RM ${toMoney(t.taxAmount)}`);
    const s = dto.switches;
    const rfq = limitChange('RFQ threshold', setting.rfqRequiredOver, s.rfqRequiredOver);
    if (rfq) messages.push(rfq);
    if (setting.rfqRequiredOn !== s.rfqRequiredOn) messages.push(s.rfqRequiredOn ? 'Turned on RFQ for large orders' : 'Turned off RFQ for large orders');
    if (setting.autoDraftBuyToOrder !== s.autoDraftBuyToOrder) messages.push(s.autoDraftBuyToOrder ? 'Turned on auto-draft for buy-to-order' : 'Turned off auto-draft for buy-to-order');
    if (!messages.length) throw new BusinessRuleError('NOTHING_CHANGED', 'Nothing has changed.');

    await this.prisma.$transaction(async (tx) => {
      for (const e of edits) {
        await tx.purApprovalRule.update({
          where: { id: e.rule.id },
          data: { thresholdAmount: rm(e.threshold), secondOverAmount: rm(e.secondOver), updatedBy: ctx.user.code },
        });
      }
      await tx.purSetting.update({
        where: { tenantId },
        data: {
          priceTolerancePct: dec(t.pricePct),
          qtyToleranceOver: dec(t.qtyOver),
          taxToleranceAmount: dec(t.taxAmount),
          rfqRequiredOn: s.rfqRequiredOn,
          rfqRequiredOver: dec(s.rfqRequiredOver),
          autoDraftBuyToOrder: s.autoDraftBuyToOrder,
          updatedBy: ctx.user.code,
        },
      });
      await this.logChanges(tx, ctx, 'APPROVAL_RULES', messages);
    });
    return this.approvalRules(ctx);
  }

  // ── P25 Document Types ────────────────────────────────────────────────────

  async documentTypes(ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const [sequences, poTypes, setting, history] = await Promise.all([
      this.prisma.sysNumberSequence.findMany({ where: { tenantId, module: 'purchase' } }),
      this.prisma.purPoType.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } }),
      this.settings.settings(tenantId),
      this.history(tenantId, 'DOCUMENT_TYPES'),
    ]);
    const rank = (t: string) => (SEQUENCE_ORDER.indexOf(t) + 1 || 99);
    return {
      sequences: sequences
        .sort((a, b) => rank(a.docType) - rank(b.docType))
        .map((s) => ({ docType: s.docType, name: s.name, prefix: s.prefix, digits: s.digits, nextValue: s.nextValue, nextNumber: formatNumber(s.prefix, s.digits, s.nextValue) })),
      poTypes: poTypes.map((t) => ({
        code: t.code,
        name: t.name,
        description: t.description,
        needsGoodsReceipt: t.needsGoodsReceipt,
        linkedToSalesOrder: t.linkedToSalesOrder,
        sendsToAssetRegister: t.sendsToAssetRegister,
        isActive: t.isActive,
      })),
      numberWithBranchCode: setting.numberWithBranchCode,
      history,
      canEdit: this.canEdit(ctx),
    };
  }

  async saveDocumentTypes(ctx: RequestContext, dto: SaveDocumentTypesDto) {
    const tenantId = ctx.tenantId;
    const messages: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      // Lock the sequences so a document saved meanwhile cannot take a number we are about to hand out again.
      const current = await tx.$queryRaw<{ id: string; docType: string; name: string; prefix: string; digits: number; nextValue: number }[]>`
        SELECT id, docType, name, prefix, digits, nextValue FROM sys_number_sequence WHERE tenantId = ${tenantId} AND module = 'purchase' FOR UPDATE`;
      const rows = dto.sequences.map((d, index) => {
        const seq = current.find((c) => c.docType === d.docType);
        if (!seq) throw new NotFoundError(`Numbering for ${d.docType}`);
        return { index, seq, name: seq.name, prefix: d.prefix.trim().toUpperCase(), digits: d.digits, nextValue: d.nextValue, currentNext: Number(seq.nextValue) };
      });
      // Prefixes not sent keep theirs, and still count for duplicates.
      const untouched = current.filter((c) => !dto.sequences.some((d) => d.docType === c.docType));
      const problems = sequenceProblems([
        ...rows,
        ...untouched.map((c, i) => ({ index: rows.length + i, name: c.name, prefix: c.prefix, digits: Number(c.digits), nextValue: Number(c.nextValue), currentNext: Number(c.nextValue) })),
      ]);
      if (problems.length) throw new ValidationFailedError(problems, problems[0]!.message);

      for (const r of rows) {
        const before = formatNumber(r.seq.prefix, Number(r.seq.digits), r.currentNext);
        const after = formatNumber(r.prefix, r.digits, r.nextValue);
        if (before === after) continue;
        await tx.sysNumberSequence.update({ where: { id: r.seq.id }, data: { prefix: r.prefix, digits: r.digits, nextValue: r.nextValue } });
        messages.push(`${r.name} numbers now start at ${after}`);
      }

      const types = await tx.purPoType.findMany({ where: { tenantId } });
      for (const d of dto.poTypes) {
        const type = types.find((t) => t.code === d.code);
        if (!type) throw new NotFoundError(`Purchase order type ${d.code}`);
        const name = d.name.trim();
        const description = d.description.trim();
        if (type.name === name && type.description === description && type.isActive === d.isActive) continue;
        if (type.code === 'STD' && !d.isActive) throw ValidationFailedError.field('poTypes', 'Standard is the default purchase order type and cannot be switched off.');
        await tx.purPoType.update({ where: { id: type.id }, data: { name, description, isActive: d.isActive } });
        messages.push(type.isActive !== d.isActive ? `${d.isActive ? 'Turned on' : 'Turned off'} purchase order type ${name}` : `Purchase order type ${type.code} renamed or described again`);
      }
      if (!messages.length) throw new BusinessRuleError('NOTHING_CHANGED', 'Nothing has changed.');
      await this.logChanges(tx, ctx, 'DOCUMENT_TYPES', messages);
    });
    return this.documentTypes(ctx);
  }

  // ── P26 Email Templates ───────────────────────────────────────────────────

  async emailTemplates(ctx: RequestContext) {
    const rows = await this.prisma.purEmailTemplate.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { sortOrder: 'asc' } });
    return { items: rows.map((t) => ({ key: t.key, name: t.name, description: t.description, isActive: t.isActive })), canEdit: this.canEdit(ctx) };
  }

  async emailTemplate(ctx: RequestContext, key: string) {
    const tenantId = ctx.tenantId;
    const t = await this.prisma.purEmailTemplate.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (!t) throw new NotFoundError('Email template');
    const sent = await this.prisma.sysEmailLog.findMany({ where: { tenantId, templateKey: key }, orderBy: { createdAt: 'desc' }, take: 3 });
    const poIds = sent.filter((s) => s.entityType === 'PUR_ORDER' && s.entityId).map((s) => s.entityId!);
    const pos = poIds.length ? await this.prisma.purPurchaseOrder.findMany({ where: { tenantId, id: { in: poIds } }, select: { id: true, supplierName: true } }) : [];
    const shortName = (name: string) => name.replace(/\s+(Sdn\.? Bhd\.?|Bhd\.?|Enterprise|Trading)$/i, '');
    return {
      key: t.key,
      name: t.name,
      description: t.description,
      toTemplate: t.toTemplate,
      ccTemplate: t.ccTemplate,
      subject: t.subject,
      body: t.body,
      attachPdf: t.attachPdf,
      autoSend: t.autoSend,
      isActive: t.isActive,
      fields: TEMPLATE_FIELDS[t.key] ?? [],
      lastSent: sent.map((s) => {
        const po = pos.find((p) => p.id === s.entityId);
        return { id: s.id, docNo: s.docNo ?? 'Test', to: po ? shortName(po.supplierName) : s.toAddress, at: s.createdAt.toISOString() };
      }),
      canEdit: this.canEdit(ctx),
    };
  }

  async saveEmailTemplate(ctx: RequestContext, key: string, dto: SaveEmailTemplateDto) {
    const tenantId = ctx.tenantId;
    const t = await this.prisma.purEmailTemplate.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (!t) throw new NotFoundError('Email template');
    const problems = unknownFieldProblems(key, [
      { field: 'toTemplate', text: dto.toTemplate },
      { field: 'ccTemplate', text: dto.ccTemplate },
      { field: 'subject', text: dto.subject },
      { field: 'body', text: dto.body },
    ]);
    if (problems.length) throw new ValidationFailedError(problems, problems[0]!.message);

    const data = {
      toTemplate: dto.toTemplate.trim(),
      ccTemplate: dto.ccTemplate?.trim() || null,
      subject: dto.subject.trim(),
      body: dto.body.replace(/\r\n/g, '\n'),
      attachPdf: dto.attachPdf,
      autoSend: dto.autoSend,
      isActive: dto.isActive,
    };
    const messages: string[] = [];
    if (t.isActive !== data.isActive) messages.push(`${data.isActive ? 'Turned on' : 'Turned off'} the ${t.name} email`);
    if (t.autoSend !== data.autoSend) messages.push(`${t.name}: ${data.autoSend ? 'sends automatically' : 'sent by hand'}`);
    if (t.toTemplate !== data.toTemplate || t.ccTemplate !== data.ccTemplate || t.subject !== data.subject || t.body !== data.body || t.attachPdf !== data.attachPdf) {
      messages.push(`${t.name} email changed`);
    }
    if (!messages.length) throw new BusinessRuleError('NOTHING_CHANGED', 'Nothing has changed.');
    await this.prisma.$transaction(async (tx) => {
      await tx.purEmailTemplate.update({ where: { id: t.id }, data: { ...data, updatedBy: ctx.user.code } });
      await this.logChanges(tx, ctx, 'EMAIL_TEMPLATES', messages);
    });
    return this.emailTemplate(ctx, key);
  }

  /** "Send test email": fills the template with example values and logs it to the current user. Nothing is sent. */
  async sendTest(ctx: RequestContext, key: string) {
    const tenantId = ctx.tenantId;
    const t = await this.prisma.purEmailTemplate.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (!t) throw new NotFoundError('Email template');
    const tenant = await this.prisma.sysTenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const vars = sampleValues({ name: ctx.user.name, email: ctx.user.email }, tenant?.name ?? '');
    await this.prisma.sysEmailLog.create({
      data: {
        tenantId,
        entityType: null,
        entityId: null,
        docNo: null,
        templateKey: t.key,
        toAddress: ctx.user.email,
        ccAddress: null,
        subject: `[Test] ${renderTemplate(t.subject, vars)}`,
        body: renderTemplate(t.body, vars),
        sentByCode: ctx.user.code,
        createdAt: this.clock.now(),
      },
    });
    return { to: ctx.user.email };
  }
}
