import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SalEnquiry, SalEnquiryItem } from '@prisma/client';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toQty } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { SalesLinkedDocsService } from '../shared/linked-docs.service';
import { ReceivablesService } from '../shared/receivables.service';
import { SAL_ENTITY } from '../shared/sales.constants';
import type { EnquiryListQueryDto } from './dto/enquiry.dto';
import { allowedEnquiryActions, ENQ_STATUSES, type EnqStatus } from './enquiry.rules';

export type EnquiryWithItems = SalEnquiry & { items: SalEnquiryItem[] };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const LABEL: Record<EnqStatus, string> = { NEW: 'New', FORWARDED: 'Forwarded', QUOTED: 'Quoted', LOST: 'Lost' };

/** Reading enquiries: the list (S06) and one enquiry with the customer card from Master Data (S07). */
@Injectable()
export class EnquiriesQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
    private readonly linked: SalesLinkedDocsService,
    private readonly receivables: ReceivablesService,
    private readonly clock: ClockService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async load(tenantId: string, id: string): Promise<EnquiryWithItems> {
    const row = await this.prisma.salEnquiry.findFirst({ where: { id, tenantId }, include: { items: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Enquiry');
    return row;
  }

  async actions(ctx: RequestContext, e: EnquiryWithItems) {
    const customer = e.customerCode ? await this.masterData.findCustomer(ctx.tenantId, e.customerCode) : null;
    return allowedEnquiryActions({
      status: e.status as EnqStatus,
      isMigrated: e.isMigrated,
      customerActive: customer?.status === 'ACTIVE' && !customer.isCash,
      hasQuotation: Boolean(e.quotationNo),
      canEdit: this.permissions.has(ctx.user.roles, P.ENQUIRY_EDIT),
      canQuote: this.permissions.has(ctx.user.roles, P.QUOTATION_EDIT),
    });
  }

  async list(ctx: RequestContext, query: EnquiryListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', budget: 'budget' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const base: Prisma.SalEnquiryWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.type && { enquiryTypeCode: query.type }),
      ...(query.agent && { agentCode: query.agent }),
      ...(query.branch && { branchCode: query.branch }),
      ...(q && { OR: [{ docNo: { contains: q } }, { customerName: { contains: q } }, { contactName: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, ENQ_STATUSES);
    const where: Prisma.SalEnquiryWhereInput = { ...base, ...(status && { status }) };
    const [rows, total, grouped, types, sources, branches, quotes] = await Promise.all([
      this.prisma.salEnquiry.findMany({ where, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.salEnquiry.count({ where }),
      this.prisma.salEnquiry.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.salEnquiryType.findMany({ where: { tenantId: ctx.tenantId } }),
      this.prisma.salEnquirySource.findMany({ where: { tenantId: ctx.tenantId } }),
      this.masterData.listBranches(ctx.tenantId),
      this.prisma.salQuotation.findMany({ where: { tenantId: ctx.tenantId, status: { not: 'SUPERSEDED' } }, select: { id: true, docNo: true } }),
    ]);
    return toListResponse(
      rows.map((e) => ({
        id: e.id, docNo: e.docNo, docDate: iso(e.docDate), customerName: e.customerName, isProspect: e.isProspect, contactName: e.contactName,
        status: e.status, statusLabel: LABEL[e.status as EnqStatus], agentName: e.agentName,
        typeName: types.find((t) => t.code === e.enquiryTypeCode)?.name ?? e.enquiryTypeCode,
        sourceName: sources.find((s) => s.code === e.sourceCode)?.name ?? e.sourceCode,
        branchName: branches.find((b) => b.code === e.branchCode)?.name ?? e.branchCode,
        budget: e.budget ? toMoney(e.budget) : null,
        quotation: e.quotationNo ? { no: e.quotationNo, id: quotes.find((x) => x.docNo === e.quotationNo)?.id ?? null } : null,
        isMigrated: e.isMigrated, version: e.version,
        canDelete: e.status === 'NEW' && !e.quotationNo && !e.isMigrated,
      })),
      total,
      query,
      buildStatusCounts(grouped, ENQ_STATUSES),
    );
  }

  async detail(ctx: RequestContext, id: string) {
    const e = await this.load(ctx.tenantId, id);
    const [actions, activity, links, type, source, branches, quote] = await Promise.all([
      this.actions(ctx, e),
      this.activity.listFor(ctx.tenantId, SAL_ENTITY.ENQUIRY, e.id),
      this.linked.forDocument(ctx.tenantId, SAL_ENTITY.ENQUIRY, e.id),
      this.prisma.salEnquiryType.findFirst({ where: { tenantId: ctx.tenantId, code: e.enquiryTypeCode } }),
      this.prisma.salEnquirySource.findFirst({ where: { tenantId: ctx.tenantId, code: e.sourceCode } }),
      this.masterData.listBranches(ctx.tenantId),
      e.quotationNo ? this.prisma.salQuotation.findFirst({ where: { tenantId: ctx.tenantId, docNo: e.quotationNo, status: { not: 'SUPERSEDED' } }, select: { id: true, docNo: true } }) : null,
    ]);
    return {
      id: e.id, docNo: e.docNo, docDate: iso(e.docDate), status: e.status, statusLabel: LABEL[e.status as EnqStatus], isMigrated: e.isMigrated, version: e.version,
      isProspect: e.isProspect, customerCode: e.customerCode, customerName: e.customerName, contactName: e.contactName, phone: e.phone, email: e.email,
      branch: { code: e.branchCode, name: branches.find((b) => b.code === e.branchCode)?.name ?? e.branchCode },
      enquiryTypeCode: e.enquiryTypeCode, typeName: type?.name ?? e.enquiryTypeCode, sourceCode: e.sourceCode, sourceName: source?.name ?? e.sourceCode,
      agent: { code: e.agentCode, name: e.agentName }, budget: e.budget ? toMoney(e.budget) : null, neededBy: iso(e.neededBy), customerRef: e.customerRef,
      description: e.description, details: (e.details as Record<string, string> | null) ?? {},
      items: e.items.map((i) => ({ lineNo: i.lineNo, itemCode: i.itemCode, itemName: i.itemName, uomCode: i.uomCode, qty: toQty(i.qty), remarks: i.remarks })),
      quotation: quote ? { id: quote.id, no: quote.docNo } : null,
      lostReason: e.lostReason,
      customerCard: e.customerCode ? await this.customerCard(ctx, e.customerCode) : null,
      links, activity, allowedActions: actions,
    };
  }

  /** "From Master Data" card: read-only customer facts and what they owe now. */
  async customerCard(ctx: RequestContext, code: string) {
    const c = await this.masterData.findCustomer(ctx.tenantId, code);
    if (!c) return null;
    const [priceLists, users, open] = await Promise.all([
      this.masterData.listPriceLists(ctx.tenantId),
      this.masterData.listUsers(ctx.tenantId),
      this.receivables.openInvoices(ctx.tenantId, this.clock.today(), [c.code]),
    ]);
    return {
      code: c.code, name: c.name, status: c.status, category: c.category, area: c.area, creditTermDays: c.creditTermDays,
      creditLimit: c.creditLimit, owedNow: toMoney(open.reduce((s, x) => s.add(x.balance), dec(0))),
      priceList: priceLists.find((p) => p.code === c.priceListCode)?.name ?? c.priceListCode,
      defaultAgent: users.find((u) => u.code === c.defaultAgentCode)?.name ?? null,
      branchCode: c.branchCode, contactName: c.contactName, phone: c.phone, email: c.email,
    };
  }
}
