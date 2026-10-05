import { Injectable } from '@nestjs/common';
import type { MdCustomer } from '../../master-data/master-data.port';
import { ClockService } from '../../platform/clock/clock.service';
import { dec, roundMoney } from '../../platform/http/decimal';
import { ConfigurationError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { checkCredit, creditSnapshot, type CreditCheck, type CreditInput } from './credit.rules';
import { ReceivablesService } from './receivables.service';
import type { CREDIT_DOC } from './sales.constants';

/** Statuses whose undelivered and uninvoiced value counts as "other open orders". Drafts do not count. */
const OPEN_ORDER_STATUSES = ['PENDING_APPROVAL', 'RELEASED', 'PARTIAL'] as const;

export interface CreditOutcome {
  input: CreditInput;
  check: CreditCheck;
  scope: 'GROUP' | 'BRANCH';
  approverRole: string | null;
  snapshot: ReturnType<typeof creditSnapshot>;
}

/** Runs the credit check for one customer and document, with the data the rules need (FlowS2 step 1). */
@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receivables: ReceivablesService,
    private readonly clock: ClockService,
  ) {}

  async check(
    tenantId: string,
    args: { customer: MdCustomer; docType: (typeof CREDIT_DOC)[keyof typeof CREDIT_DOC]; thisDocument: string; branchCode: string; excludeOrderId?: string },
  ): Promise<CreditOutcome> {
    const [setting, rule] = await Promise.all([
      this.prisma.salSetting.findUnique({ where: { tenantId } }),
      this.prisma.salCreditRule.findUnique({ where: { tenantId_docType: { tenantId, docType: args.docType } } }),
    ]);
    if (!setting || !rule) throw new ConfigurationError('Credit control is not set up. Open Operation Policies › Credit Control.');
    const scope = (args.customer.creditScope ?? setting.creditScope) === 'BRANCH' ? 'BRANCH' : 'GROUP';
    const today = this.clock.today();

    const open = (await this.receivables.openInvoices(tenantId, today, [args.customer.code])).filter(
      (x) => scope === 'GROUP' || x.invoice.branchCode === args.branchCode,
    );
    const owed = open.reduce((s, x) => s.add(x.balance), dec(0));
    const overdue = open.filter((x) => x.overdue).reduce((s, x) => s.add(x.balance), dec(0));
    // A quotation is not a commitment: its warning compares what is owed plus the quotation (S09), without open orders.
    const otherOpen = args.docType === 'QUOTATION' ? dec(0) : await this.openOrdersValue(tenantId, args.customer.code, scope === 'BRANCH' ? args.branchCode : null, args.excludeOrderId);

    const input: CreditInput = {
      creditLimit: args.customer.creditLimit,
      overdueLimit: args.customer.overdueLimit,
      owed,
      overdue,
      otherOpen,
      thisDocument: args.thisDocument,
    };
    const check = checkCredit(input, rule);
    return { input, check, scope, approverRole: rule.approverRole, snapshot: creditSnapshot(input, check, scope, this.clock.now()) };
  }

  /** Value still to be invoiced on the customer's other open orders, tax included. */
  async openOrdersValue(tenantId: string, customerCode: string, branchCode: string | null, excludeOrderId?: string) {
    const orders = await this.prisma.salSalesOrder.findMany({
      where: {
        tenantId,
        customerCode,
        status: { in: [...OPEN_ORDER_STATUSES] },
        ...(branchCode && { branchCode }),
        ...(excludeOrderId && { id: { not: excludeOrderId } }),
      },
      include: { lines: true },
    });
    let total = dec(0);
    for (const o of orders) {
      for (const l of o.lines) {
        const qty = l.orderedQty.sub(l.invoicedQty).sub(l.cancelledQty);
        if (qty.lte(0)) continue;
        const net = roundMoney(qty.mul(l.unitPrice).mul(dec(100).sub(l.discountPct)).div(100));
        total = total.add(net).add(roundMoney(net.mul(l.taxRate)));
      }
    }
    return total;
  }
}
