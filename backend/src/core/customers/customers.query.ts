import { Injectable } from '@nestjs/common';
import type { MdmCustomer, Prisma } from '@prisma/client';
import { ActivityService } from '../../platform/activity/activity.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, pageArgs, statusFromKey, toListResponse } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RecordUsageRegistry } from '../../platform/usage/record-usage.registry';
import { CORE_ENTITY } from '../core.constants';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { deactivateRefusal, deleteRefusal } from '../usage/usage.rules';
import type { CustomerListQueryDto } from './dto/customer.dto';
import { creditTermText, CUSTOMER_STATUSES, eInvoiceGap, STATUS_LABEL, statusActions, type CustomerAction, type CustomerStatus } from './customers.rules';

const money = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2));

/** C04 customer list and C05 customer (CLAUDE.md → Phase 3). Reads mdm_ tables; where a customer is used comes from the record-usage check. */
@Injectable()
export class CustomersQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: RecordUsageRegistry,
    private readonly activity: ActivityService,
    private readonly permissions: PermissionRegistry,
  ) {}

  async list(ctx: RequestContext, query: CustomerListQueryDto) {
    const tenantId = ctx.tenantId;
    const q = query.q?.trim();
    const base: Prisma.MdmCustomerWhereInput = {
      tenantId,
      ...(q && { OR: [{ code: { contains: q } }, { name: { contains: q } }, { tin: { contains: q } }] }),
      ...(query.branch && { branchCode: query.branch }),
      ...(query.category && { category: query.category }),
      ...(query.agent && { defaultAgentCode: query.agent }),
    };
    const status = statusFromKey(query.status, CUSTOMER_STATUSES);
    const where = { ...base, ...(status && { status }) };
    const [rows, total, grouped] = await Promise.all([
      this.prisma.mdmCustomer.findMany({ where, orderBy: { code: 'asc' }, ...pageArgs(query) }),
      this.prisma.mdmCustomer.count({ where }),
      this.prisma.mdmCustomer.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const names = await this.names(tenantId, rows);
    const items = rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      category: c.category,
      area: c.area,
      branchCode: c.branchCode,
      agentName: c.defaultAgentCode ? (names.agents.get(c.defaultAgentCode) ?? c.defaultAgentCode) : null,
      priceListName: names.priceLists.get(c.priceListCode) ?? c.priceListCode,
      creditTerm: creditTermText(c.creditTermDays),
      creditLimit: money(c.creditLimit),
      overdueLimit: money(c.overdueLimit),
      tin: c.tin,
      status: c.status,
      statusLabel: STATUS_LABEL[c.status as CustomerStatus],
    }));
    return toListResponse(items, total, query, buildStatusCounts(grouped, CUSTOMER_STATUSES));
  }

  async detail(ctx: RequestContext, id: string) {
    const tenantId = ctx.tenantId;
    const c = await this.load(ctx, id);
    const [usage, activity, names] = await Promise.all([
      this.usage.check({ tenantId, kind: 'CUSTOMER', code: c.code }),
      this.activity.listFor(tenantId, CORE_ENTITY.CUSTOMER, c.id),
      this.names(tenantId, [c]),
    ]);
    const canEdit = this.permissions.has(ctx.user.roles, P.CUSTOMER_EDIT);
    const canEditCredit = this.permissions.has(ctx.user.roles, P.CUSTOMER_CREDIT);
    const deactivate = deactivateRefusal(c.code, usage);
    const remove = deleteRefusal('CUSTOMER', c.code, usage);
    const allowedActions: CustomerAction[] = [];
    const refusals: Partial<Record<CustomerAction, string>> = {};
    if (canEdit) allowedActions.push('edit');
    if (canEditCredit) allowedActions.push('editCredit');
    if (canEdit) {
      for (const action of statusActions(c.status as CustomerStatus)) {
        if (action === 'block' && deactivate) refusals.block = deactivate;
        else allowedActions.push(action);
      }
      if (remove) refusals.delete = remove;
      else allowedActions.push('delete');
    }
    return {
      ...this.fields(c),
      branchName: names.branches.get(c.branchCode) ?? c.branchCode,
      agentName: c.defaultAgentCode ? (names.agents.get(c.defaultAgentCode) ?? c.defaultAgentCode) : null,
      priceListName: names.priceLists.get(c.priceListCode) ?? c.priceListCode,
      eInvoiceGap: eInvoiceGap(c),
      usage,
      activity,
      allowedActions,
      refusals,
    };
  }

  async load(ctx: RequestContext, id: string): Promise<MdmCustomer> {
    const c = await this.prisma.mdmCustomer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!c) throw new NotFoundError('Customer');
    return c;
  }

  private fields(c: MdmCustomer) {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      category: c.category,
      area: c.area,
      branchCode: c.branchCode,
      defaultAgentCode: c.defaultAgentCode,
      billingAddress: c.billingAddress,
      deliveryAddress: c.deliveryAddress,
      contactName: c.contactName,
      email: c.email,
      phone: c.phone,
      tin: c.tin,
      idType: c.idType,
      idNumber: c.idNumber,
      salesTaxNo: c.salesTaxNo,
      serviceTaxNo: c.serviceTaxNo,
      einvoiceEmail: c.einvoiceEmail,
      taxMode: c.taxMode,
      creditTermDays: c.creditTermDays,
      creditLimit: money(c.creditLimit),
      overdueLimit: money(c.overdueLimit),
      creditScope: c.creditScope,
      priceListCode: c.priceListCode,
      isCash: c.isCash,
      cameFromEnquiry: c.cameFromEnquiry,
      status: c.status,
      statusLabel: STATUS_LABEL[c.status as CustomerStatus],
      version: c.version,
    };
  }

  /** Names of the branches, agents and price lists the rows point to. */
  private async names(tenantId: string, rows: Pick<MdmCustomer, 'branchCode' | 'defaultAgentCode' | 'priceListCode'>[]) {
    const agentCodes = [...new Set(rows.map((r) => r.defaultAgentCode).filter((c): c is string => !!c))];
    const [branches, agents, lists] = await Promise.all([
      this.prisma.mdmBranch.findMany({ where: { tenantId, code: { in: [...new Set(rows.map((r) => r.branchCode))] } }, select: { code: true, name: true } }),
      this.prisma.mdmUser.findMany({ where: { tenantId, code: { in: agentCodes } }, select: { code: true, name: true } }),
      this.prisma.mdmPriceList.findMany({ where: { tenantId, code: { in: [...new Set(rows.map((r) => r.priceListCode))] } }, select: { code: true, name: true } }),
    ]);
    return {
      branches: new Map(branches.map((b) => [b.code, b.name])),
      agents: new Map(agents.map((a) => [a.code, a.name])),
      priceLists: new Map(lists.map((l) => [l.code, l.name])),
    };
  }
}
