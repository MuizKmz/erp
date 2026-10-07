import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { toRmText } from '../../platform/http/decimal';
import { BusinessRuleError, NotFoundError, ValidationFailedError } from '../../platform/http/errors';
import { PrismaService, type Tx } from '../../platform/prisma/prisma.service';
import { mailDate, renderSalesTemplate, SalesMailService } from '../shared/sales-mail.service';
import { SAL_ENTITY } from '../shared/sales.constants';
import { invoiceBalance } from '../shared/totals.rules';
import type { AddExclusionDto, EnquirySourceDto, EnquiryTypeDto, NewTemplateDto, SaveTemplateDto } from './dto/settings.dto';
import { codeFromName, EXCLUSION_REASONS, exclusionProblems, exclusionState, templateKey } from './settings.rules';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (v: string) => new Date(`${v}T00:00:00.000Z`);
const VARIABLES = ['contact.name', 'document.number', 'document.total', 'document.due_date', 'document.customer_ref', 'agent.name', 'agent.phone', 'company.name'];

/** Operation Policies · Enquiry types (S31), Excluded items (S32), Email templates (S33). */
@Injectable()
export class SalesListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: SalesMailService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  private log(tx: Tx | PrismaService, ctx: RequestContext, area: string, message: string) {
    return tx.salSettingChange.create({ data: { tenantId: ctx.tenantId, area, message, userCode: ctx.user.code, userName: ctx.user.name } });
  }

  // ── Enquiry types and sources (S31) ───────────────────────────────────────

  async enquiryTypes(ctx: RequestContext) {
    const today = this.clock.today();
    const monthStart = day(`${today.slice(0, 7)}-01`);
    const [types, sources, month] = await Promise.all([
      this.prisma.salEnquiryType.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.salEnquirySource.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.salEnquiry.findMany({ where: { tenantId: ctx.tenantId, docDate: { gte: monthStart } }, select: { enquiryTypeCode: true, sourceCode: true, quotationNo: true } }),
    ]);
    return {
      types: types.map((t) => ({
        code: t.code,
        name: t.name,
        details: t.details as { label: string; kind: string; required: boolean; choices?: string[] }[],
        defaultAgentRule: t.defaultAgentRule,
        isActive: t.isActive,
        usedThisMonth: month.filter((e) => e.enquiryTypeCode === t.code).length,
      })),
      sources: sources.map((s) => ({
        code: s.code,
        name: s.name,
        isActive: s.isActive,
        thisMonth: month.filter((e) => e.sourceCode === s.code).length,
        becameQuotations: month.filter((e) => e.sourceCode === s.code && e.quotationNo).length,
      })),
    };
  }

  async saveEnquiryType(ctx: RequestContext, code: string | null, dto: EnquiryTypeDto) {
    const existing = await this.prisma.salEnquiryType.findMany({ where: { tenantId: ctx.tenantId } });
    const current = code ? existing.find((t) => t.code === code) : null;
    if (code && !current) throw new NotFoundError('Enquiry type');
    if (existing.some((t) => t.code !== code && t.name.toLowerCase() === dto.name.trim().toLowerCase())) throw ValidationFailedError.field('name', `There is already a type called ${dto.name.trim()}.`);
    const labels = dto.details.map((d) => d.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) throw ValidationFailedError.field('details', 'Two extra details have the same name.');
    const details = dto.details.map((d) => ({ label: d.label.trim(), kind: d.kind, required: d.required, ...(d.kind === 'CHOICE' && { choices: (d.choices ?? []).map((c) => c.trim()).filter(Boolean) }) })) as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      if (current) {
        await tx.salEnquiryType.update({ where: { id: current.id }, data: { name: dto.name.trim(), details, defaultAgentRule: dto.defaultAgentRule, isActive: dto.isActive } });
        await this.log(tx, ctx, 'ENQUIRY_TYPES', `Enquiry type ${dto.name.trim()} changed`);
      } else {
        const newCode = codeFromName(dto.name, existing.map((t) => t.code));
        await tx.salEnquiryType.create({ data: { tenantId: ctx.tenantId, code: newCode, name: dto.name.trim(), details, defaultAgentRule: dto.defaultAgentRule, isActive: dto.isActive, sortOrder: existing.length + 1 } });
        await this.log(tx, ctx, 'ENQUIRY_TYPES', `Enquiry type added: ${dto.name.trim()}`);
      }
    });
    return this.enquiryTypes(ctx);
  }

  async addSource(ctx: RequestContext, dto: EnquirySourceDto) {
    const existing = await this.prisma.salEnquirySource.findMany({ where: { tenantId: ctx.tenantId } });
    if (existing.some((s) => s.name.toLowerCase() === dto.name.trim().toLowerCase())) throw ValidationFailedError.field('name', `${dto.name.trim()} is already a source.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.salEnquirySource.create({ data: { tenantId: ctx.tenantId, code: codeFromName(dto.name, existing.map((s) => s.code)), name: dto.name.trim(), sortOrder: existing.length + 1 } });
      await this.log(tx, ctx, 'ENQUIRY_TYPES', `Enquiry source added: ${dto.name.trim()}`);
    });
    return this.enquiryTypes(ctx);
  }

  // ── Excluded items (S32) ──────────────────────────────────────────────────

  async exclusions(ctx: RequestContext, filter: { q?: string; branch?: string; state?: string }) {
    const today = this.clock.today();
    const [rows, branches] = await Promise.all([
      this.prisma.salExcludedItem.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(filter.branch && { branchCode: filter.branch }),
          ...(filter.q?.trim() && { OR: [{ itemCode: { contains: filter.q.trim() } }, { itemName: { contains: filter.q.trim() } }] }),
        },
        orderBy: [{ fromDate: 'asc' }, { itemCode: 'asc' }, { branchCode: 'desc' }],
      }),
      this.masterData.listBranches(ctx.tenantId),
    ]);
    const all = rows.map((r) => {
      const state = exclusionState({ fromDate: iso(r.fromDate)!, untilDate: iso(r.untilDate), removed: Boolean(r.removedAt) }, today);
      return {
        id: r.id, itemCode: r.itemCode, itemName: r.itemName, branchCode: r.branchCode,
        branchName: branches.find((b) => b.code === r.branchCode)?.name ?? r.branchCode,
        reason: r.reason, fromDate: iso(r.fromDate), untilDate: iso(r.untilDate), addedByName: r.addedByName, state,
        removedAt: r.removedAt?.toISOString() ?? null,
      };
    });
    const wanted = filter.state === 'ended' ? ['ENDED'] : filter.state === 'all' ? ['ACTIVE', 'SCHEDULED', 'ENDED'] : ['ACTIVE', 'SCHEDULED'];
    const year = today.slice(0, 4);
    return {
      items: all.filter((r) => wanted.includes(r.state)),
      counts: {
        active: all.filter((r) => r.state !== 'ENDED').length,
        endedThisYear: all.filter((r) => r.state === 'ENDED' && ((r.removedAt ?? r.untilDate ?? '').startsWith(year))).length,
      },
      reasons: EXCLUSION_REASONS,
      branches: branches.map((b) => ({ code: b.code, name: b.name })),
    };
  }

  async addExclusion(ctx: RequestContext, dto: AddExclusionDto) {
    const [item] = await this.masterData.findItems(ctx.tenantId, [dto.itemCode]);
    if (!item) throw ValidationFailedError.field('itemCode', 'Pick an item from Master Data.');
    const branches = await this.masterData.listBranches(ctx.tenantId);
    if (!branches.some((b) => b.code === dto.branchCode)) throw ValidationFailedError.field('branchCode', 'Pick a branch.');
    const fromDate = dto.fromDate ?? this.clock.today();
    const others = await this.prisma.salExcludedItem.findMany({ where: { tenantId: ctx.tenantId, itemCode: item.code, branchCode: dto.branchCode, removedAt: null } });
    const overlaps = others.some((o) => {
      const oFrom = iso(o.fromDate)!;
      const oUntil = iso(o.untilDate) ?? '9999-12-31';
      return fromDate <= oUntil && (dto.untilDate ?? '9999-12-31') >= oFrom;
    });
    const problems = exclusionProblems({ fromDate, untilDate: dto.untilDate ?? null, overlaps });
    if (problems.length) throw new ValidationFailedError(problems, 'Check the exclusion.');
    const branchName = branches.find((b) => b.code === dto.branchCode)!.name;
    await this.prisma.$transaction(async (tx) => {
      await tx.salExcludedItem.create({
        data: {
          tenantId: ctx.tenantId, itemCode: item.code, itemName: item.name, branchCode: dto.branchCode, reason: dto.reason, fromDate: day(fromDate),
          untilDate: dto.untilDate ? day(dto.untilDate) : null, addedByCode: ctx.user.code, addedByName: ctx.user.name,
        },
      });
      await this.log(tx, ctx, 'EXCLUDED_ITEMS', `${item.code} excluded in ${branchName}: ${dto.reason}`);
    });
    return this.exclusions(ctx, {});
  }

  async removeExclusion(ctx: RequestContext, id: string) {
    const row = await this.prisma.salExcludedItem.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) throw new NotFoundError('Exclusion');
    if (row.removedAt) throw new BusinessRuleError('ALREADY_REMOVED', `${row.itemCode} is no longer excluded.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.salExcludedItem.update({ where: { id }, data: { removedAt: this.clock.now(), removedBy: ctx.user.code } });
      await this.log(tx, ctx, 'EXCLUDED_ITEMS', `${row.itemCode} can be sold again in ${row.branchCode}`);
    });
    return this.exclusions(ctx, {});
  }

  // ── Email templates (S33) ─────────────────────────────────────────────────

  async templates(ctx: RequestContext) {
    const rows = await this.prisma.salEmailTemplate.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return {
      items: rows.map((t) => ({ key: t.key, name: t.name, description: t.description, subject: t.subject, body: t.body, attachPdf: t.attachPdf, copyAgent: t.copyAgent, isActive: t.isActive })),
      variables: VARIABLES,
    };
  }

  async saveTemplate(ctx: RequestContext, key: string, dto: SaveTemplateDto) {
    const t = await this.prisma.salEmailTemplate.findFirst({ where: { tenantId: ctx.tenantId, key } });
    if (!t) throw new NotFoundError('Email template');
    await this.prisma.$transaction(async (tx) => {
      await tx.salEmailTemplate.update({ where: { id: t.id }, data: { subject: dto.subject, body: dto.body, attachPdf: dto.attachPdf, copyAgent: dto.copyAgent, updatedBy: ctx.user.code } });
      await this.log(tx, ctx, 'EMAIL_TEMPLATES', `${t.name} email changed`);
    });
    return this.templates(ctx);
  }

  async newTemplate(ctx: RequestContext, dto: NewTemplateDto) {
    const existing = await this.prisma.salEmailTemplate.findMany({ where: { tenantId: ctx.tenantId } });
    let key = templateKey(dto.name);
    if (existing.some((t) => t.key === key)) key = `${key}_${existing.length + 1}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.salEmailTemplate.create({
        data: {
          tenantId: ctx.tenantId, key, name: dto.name.trim(), description: dto.description?.trim() || 'Sent manually', subject: `${dto.name.trim()} · {document.number}`,
          body: 'Dear {contact.name},\n\n\n\nThank you,\n{company.name}', attachPdf: false, copyAgent: true, sortOrder: existing.length + 1, updatedBy: ctx.user.code,
        },
      });
      await this.log(tx, ctx, 'EMAIL_TEMPLATES', `Email template added: ${dto.name.trim()}`);
    });
    return { ...(await this.templates(ctx)), key };
  }

  /**
   * What the email would look like on a real document of its kind (S33 preview): the latest invoice for Invoice, the
   * latest quotation for Quotation, and so on. Uses the text being edited, not only the saved one.
   */
  async preview(ctx: RequestContext, key: string, draft?: { subject?: string; body?: string }) {
    const t = await this.prisma.salEmailTemplate.findFirst({ where: { tenantId: ctx.tenantId, key } });
    if (!t) throw new NotFoundError('Email template');
    const sample = await this.sample(ctx, key);
    const tenant = await this.prisma.sysTenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
    const vars = { ...sample.vars, 'company.name': tenant?.name ?? '[Company name]', 'agent.phone': '[agent phone]' };
    return {
      docNo: sample.docNo,
      to: sample.to,
      cc: t.copyAgent ? sample.agentEmail : null,
      subject: renderSalesTemplate(draft?.subject ?? t.subject, vars),
      body: renderSalesTemplate(draft?.body ?? t.body, vars),
      attachment: t.attachPdf && sample.docNo ? `${sample.docNo}.pdf` : null,
    };
  }

  /** "Send test to me": the rendered email is logged to the current user (nothing is really sent in this phase). */
  async sendTest(ctx: RequestContext, key: string) {
    const users = await this.masterData.listUsers(ctx.tenantId);
    const me = users.find((u) => u.code === ctx.user.code);
    if (!me?.email) throw new BusinessRuleError('NO_EMAIL', 'Your user has no email address in Master Data.');
    const sample = await this.sample(ctx, key);
    await this.prisma.$transaction(async (tx) => {
      await this.mail.send(tx, ctx, { templateKey: key, entityType: sample.entityType, entityId: sample.entityId ?? ctx.tenantId, docNo: sample.docNo ?? 'TEST', to: me.email!, vars: { ...sample.vars, 'agent.phone': '[agent phone]' } });
    });
    return { sentTo: me.email };
  }

  private async sample(ctx: RequestContext, key: string) {
    const tenantId = ctx.tenantId;
    const users = await this.masterData.listUsers(tenantId);
    const agentOf = (code: string) => users.find((u) => u.code === code);
    const customerOf = (code: string) => this.masterData.findCustomer(tenantId, code);
    const base = { entityType: SAL_ENTITY.INVOICE as string, entityId: null as string | null, docNo: null as string | null, to: null as string | null, agentEmail: null as string | null, vars: {} as Record<string, string> };

    if (key === 'QUOTATION') {
      const q = await this.prisma.salQuotation.findFirst({ where: { tenantId, status: { in: ['RELEASED', 'ORDERED'] }, isMigrated: false }, orderBy: { docDate: 'desc' } });
      if (!q) return base;
      const c = await customerOf(q.customerCode);
      return { ...base, entityType: SAL_ENTITY.QUOTATION, entityId: q.id, docNo: q.docNo, to: c?.email ?? null, agentEmail: agentOf(q.agentCode)?.email ?? null,
        vars: { 'contact.name': q.contactName ?? c?.contactName ?? q.customerName, 'document.number': q.docNo, 'document.total': toRmText(q.total), 'document.due_date': mailDate(q.validUntil), 'document.customer_ref': '—', 'agent.name': q.agentName } };
    }
    if (key === 'ORDER_CONFIRMATION') {
      const o = await this.prisma.salSalesOrder.findFirst({ where: { tenantId, status: { in: ['RELEASED', 'PARTIAL', 'DONE'] }, isMigrated: false }, orderBy: { docDate: 'desc' } });
      if (!o) return base;
      const c = await customerOf(o.customerCode);
      return { ...base, entityType: SAL_ENTITY.ORDER, entityId: o.id, docNo: o.docNo, to: c?.email ?? null, agentEmail: agentOf(o.agentCode)?.email ?? null,
        vars: { 'contact.name': o.contactName ?? o.customerName, 'document.number': o.docNo, 'document.total': toRmText(o.total), 'document.due_date': mailDate(o.deliveryWantedBy), 'document.customer_ref': o.customerPoRef ?? '—', 'agent.name': o.agentName } };
    }
    if (key === 'PROFORMA') {
      const p = await this.prisma.salProforma.findFirst({ where: { tenantId, isMigrated: false }, orderBy: { docDate: 'desc' } });
      if (!p) return base;
      const c = await customerOf(p.customerCode);
      return { ...base, entityType: SAL_ENTITY.PROFORMA, entityId: p.id, docNo: p.docNo, to: c?.email ?? null, agentEmail: agentOf(p.agentCode)?.email ?? null,
        vars: { 'contact.name': p.attention ?? p.customerName, 'document.number': p.docNo, 'document.total': toRmText(p.amount), 'document.due_date': mailDate(p.payBy), 'document.customer_ref': p.salesOrderNo, 'agent.name': p.agentName } };
    }
    if (key === 'DELIVERY_NOTICE') {
      const d = await this.prisma.salDelivery.findFirst({ where: { tenantId, status: 'CONFIRMED', isMigrated: false }, orderBy: { docDate: 'desc' }, include: { salesOrder: true } });
      if (!d) return base;
      const c = await customerOf(d.customerCode);
      return { ...base, entityType: SAL_ENTITY.DELIVERY, entityId: d.id, docNo: d.docNo, to: c?.email ?? null,
        vars: { 'contact.name': d.receiver ?? d.customerName, 'document.number': d.docNo, 'document.total': '', 'document.due_date': mailDate(d.docDate), 'document.customer_ref': d.salesOrder?.customerPoRef ?? '—', 'agent.name': d.salesOrder?.agentName ?? '' } };
    }
    // INVOICE, OVERDUE_REMINDER and new templates: an invoice (the oldest overdue one for the reminder).
    const today = this.clock.today();
    const inv = key === 'OVERDUE_REMINDER'
      ? await this.prisma.salInvoice.findFirst({ where: { tenantId, status: 'RELEASED', dueDate: { lt: day(today) } }, orderBy: { dueDate: 'asc' } })
      : await this.prisma.salInvoice.findFirst({ where: { tenantId, status: 'RELEASED', isMigrated: false }, orderBy: [{ docDate: 'asc' }, { docNo: 'asc' }] });
    if (!inv) return base;
    const c = await customerOf(inv.customerCode);
    const paid = await this.prisma.finReceiptStub.aggregate({ where: { tenantId, appliesToType: 'INVOICE', appliesToNo: inv.docNo }, _sum: { amount: true } });
    const balance = invoiceBalance({ total: inv.total, debited: inv.debitedAmount, credited: inv.creditedAmount, deposit: inv.depositApplied, paid: paid._sum.amount ?? 0 });
    return { ...base, entityType: SAL_ENTITY.INVOICE, entityId: inv.id, docNo: inv.docNo, to: c?.email ?? null, agentEmail: agentOf(inv.agentCode)?.email ?? null,
      vars: {
        'contact.name': inv.contactName ?? c?.contactName ?? inv.customerName, 'document.number': inv.docNo,
        'document.total': toRmText(key === 'OVERDUE_REMINDER' ? balance : inv.total), 'document.due_date': mailDate(inv.dueDate),
        'document.customer_ref': inv.customerPoRef ?? '—', 'agent.name': inv.agentName,
      } };
  }
}
