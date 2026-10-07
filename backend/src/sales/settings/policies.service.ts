import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../platform/context/request-context';
import { ConfigurationError, ValidationFailedError } from '../../platform/http/errors';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import type { AddOrderTypeDto, SaveCreditControlDto, SaveDocumentTypesDto } from './dto/settings.dto';
import { codeFromName, creditChanges, CREDIT_DOCS, normaliseRule, numberingChanges, ruleProblems, TOGGLES, type CreditRuleView, type ToggleKey } from './settings.rules';

/** Order of the Sales documents on Document types (S30). */
const SEQUENCE_ORDER = ['EQ', 'QT', 'SO', 'DO', 'INV', 'CS', 'DN', 'SR', 'PF', 'CO'];

/**
 * Operation Policies · Credit control (S29) and Document types (S30). Every saved change is written to the change
 * history (sal_setting_change) in plain words. The credit check and numbering read these rows directly.
 */
@Injectable()
export class SalesPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  private async setting(tenantId: string) {
    const s = await this.prisma.salSetting.findUnique({ where: { tenantId } });
    if (!s) throw new ConfigurationError('Sales settings are not set up yet.');
    return s;
  }

  private toggles(s: Awaited<ReturnType<SalesPoliciesService['setting']>>): Record<ToggleKey, boolean> {
    return {
      stockCheck: s.stockCheck === 'WARN', invoiceFromDelivered: s.invoiceFromDelivered, strictPriceList: s.strictPriceList,
      roundTo5Sen: s.roundTo5Sen, showMargin: s.showMargin, skipCreditForSystem: s.skipCreditForSystem,
    };
  }

  private async rules(tenantId: string): Promise<CreditRuleView[]> {
    const rows = await this.prisma.salCreditRule.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } });
    return CREDIT_DOCS.map((doc) => rows.find((r) => r.docType === doc)).filter((r) => r !== undefined).map((r) => ({
      docType: r.docType as CreditRuleView['docType'], overCreditAction: r.overCreditAction as CreditRuleView['overCreditAction'],
      overOverdueAction: r.overOverdueAction as CreditRuleView['overOverdueAction'], approverRole: r.approverRole,
    }));
  }

  private async history(tenantId: string, area: string) {
    const rows = await this.prisma.salSettingChange.findMany({ where: { tenantId, area }, orderBy: { createdAt: 'desc' }, take: 12 });
    return rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), userName: r.userName, message: r.message }));
  }

  private logChanges(tx: Tx, ctx: RequestContext, area: string, messages: string[]) {
    const now = Date.now();
    return tx.salSettingChange.createMany({
      data: messages.map((message, i) => ({ tenantId: ctx.tenantId, area, message, userCode: ctx.user.code, userName: ctx.user.name, createdAt: new Date(now + i) })),
    });
  }

  // ── Credit control (S29) ──────────────────────────────────────────────────

  async creditControl(ctx: RequestContext) {
    const [s, rules, history] = await Promise.all([this.setting(ctx.tenantId), this.rules(ctx.tenantId), this.history(ctx.tenantId, 'CREDIT_CONTROL')]);
    return {
      creditScope: s.creditScope,
      toggles: this.toggles(s),
      toggleLabels: TOGGLES,
      rules,
      history,
      lastChange: history[0] ? { at: history[0].at, userName: history[0].userName } : null,
    };
  }

  async saveCreditControl(ctx: RequestContext, dto: SaveCreditControlDto) {
    const after = dto.rules.map((r) => normaliseRule({ docType: r.docType, overCreditAction: r.overCreditAction, overOverdueAction: r.overOverdueAction, approverRole: r.approverRole ?? null }));
    const problems = ruleProblems(after);
    if (problems.length) throw new ValidationFailedError(problems, 'Check the credit rules.');
    const s = await this.setting(ctx.tenantId);
    const before = { scope: s.creditScope, toggles: this.toggles(s), rules: await this.rules(ctx.tenantId) };
    const toggles: Record<ToggleKey, boolean> = {
      stockCheck: dto.stockCheck, invoiceFromDelivered: dto.invoiceFromDelivered, strictPriceList: dto.strictPriceList,
      roundTo5Sen: dto.roundTo5Sen, showMargin: dto.showMargin, skipCreditForSystem: dto.skipCreditForSystem,
    };
    const changes = creditChanges(before, { scope: dto.creditScope, toggles, rules: after });
    if (changes.length) {
      await this.prisma.$transaction(async (tx) => {
        await tx.salSetting.update({
          where: { tenantId: ctx.tenantId },
          data: {
            creditScope: dto.creditScope, stockCheck: dto.stockCheck ? 'WARN' : 'OFF', invoiceFromDelivered: dto.invoiceFromDelivered,
            strictPriceList: dto.strictPriceList, roundTo5Sen: dto.roundTo5Sen, showMargin: dto.showMargin, skipCreditForSystem: dto.skipCreditForSystem,
            updatedBy: ctx.user.code,
          },
        });
        for (const r of after) {
          await tx.salCreditRule.update({
            where: { tenantId_docType: { tenantId: ctx.tenantId, docType: r.docType } },
            data: { overCreditAction: r.overCreditAction, overOverdueAction: r.overOverdueAction, approverRole: r.approverRole, updatedBy: ctx.user.code },
          });
        }
        await this.logChanges(tx, ctx, 'CREDIT_CONTROL', changes);
      });
    }
    return { ...(await this.creditControl(ctx)), saved: changes };
  }

  // ── Document types and numbering (S30) ────────────────────────────────────

  async documentTypes(ctx: RequestContext) {
    const [sequences, orderTypes, history] = await Promise.all([
      this.prisma.sysNumberSequence.findMany({ where: { tenantId: ctx.tenantId, module: 'sales' } }),
      this.prisma.salOrderType.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.history(ctx.tenantId, 'DOCUMENT_TYPES'),
    ]);
    const ordered = [...sequences].sort((a, b) => (SEQUENCE_ORDER.indexOf(a.docType) + 1 || 99) - (SEQUENCE_ORDER.indexOf(b.docType) + 1 || 99));
    return {
      sequences: await Promise.all(ordered.map(async (s) => ({
        docType: s.docType,
        name: s.name,
        format: s.format ?? `${s.prefix}{${'#'.repeat(s.digits)}}`,
        nextNumber: await this.numbering.peek(ctx.tenantId, s.docType),
        resetEvery: s.resetEvery,
        perBranch: s.perBranch,
        printTemplate: s.printTemplate,
      }))),
      orderTypes: orderTypes.map((t) => ({ code: t.code, name: t.name, meaning: t.meaning, isDefault: t.isDefault, isActive: t.isActive })),
      history,
    };
  }

  async saveDocumentTypes(ctx: RequestContext, dto: SaveDocumentTypesDto) {
    const before = await this.prisma.sysNumberSequence.findMany({ where: { tenantId: ctx.tenantId, module: 'sales' } });
    const unknown = dto.sequences.find((s) => !before.some((b) => b.docType === s.docType));
    if (unknown) throw ValidationFailedError.field('sequences', `${unknown.docType} is not a Sales document.`);
    const changes = numberingChanges(before, dto.sequences);
    if (changes.length) {
      await this.prisma.$transaction(async (tx) => {
        for (const s of dto.sequences) {
          await tx.sysNumberSequence.update({ where: { tenantId_docType: { tenantId: ctx.tenantId, docType: s.docType } }, data: { resetEvery: s.resetEvery, perBranch: s.perBranch } });
        }
        await this.logChanges(tx, ctx, 'DOCUMENT_TYPES', changes);
      });
    }
    return { ...(await this.documentTypes(ctx)), saved: changes };
  }

  async addOrderType(ctx: RequestContext, dto: AddOrderTypeDto) {
    const existing = await this.prisma.salOrderType.findMany({ where: { tenantId: ctx.tenantId } });
    if (existing.some((t) => t.name.toLowerCase() === dto.name.trim().toLowerCase())) throw ValidationFailedError.field('name', `There is already a type called ${dto.name.trim()}.`);
    const code = codeFromName(dto.name, existing.map((t) => t.code));
    await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.salOrderType.updateMany({ where: { tenantId: ctx.tenantId }, data: { isDefault: false } });
      await tx.salOrderType.create({ data: { tenantId: ctx.tenantId, code, name: dto.name.trim(), meaning: dto.meaning.trim(), isDefault: dto.isDefault ?? false, sortOrder: existing.length + 1 } });
      await this.logChanges(tx, ctx, 'DOCUMENT_TYPES', [`Sales order type added: ${dto.name.trim()}`]);
    });
    return this.documentTypes(ctx);
  }
}
