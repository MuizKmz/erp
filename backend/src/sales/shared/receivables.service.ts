import { Injectable } from '@nestjs/common';
import type { Prisma, SalInvoice } from '@prisma/client';
import { dec } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { invoiceBalance } from './totals.rules';

export interface OpenInvoice {
  invoice: SalInvoice;
  paid: Prisma.Decimal;
  balance: Prisma.Decimal;
  overdue: boolean;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * What customers owe: released invoices with a balance, after returns, debit notes, deposits and the payments
 * Finance recorded (fin_receipt_stub until Finance is connected). Sales never changes a balance by hand.
 */
@Injectable()
export class ReceivablesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Released invoices that still have a balance, optionally for some customers only. */
  async openInvoices(tenantId: string, today: string, customerCodes?: string[]): Promise<OpenInvoice[]> {
    const invoices = await this.prisma.salInvoice.findMany({
      where: { tenantId, status: 'RELEASED', ...(customerCodes && { customerCode: { in: customerCodes } }) },
    });
    const receipts = await this.prisma.finReceiptStub.groupBy({
      by: ['appliesToNo'],
      where: { tenantId, appliesToType: 'INVOICE', appliesToNo: { in: invoices.map((v) => v.docNo) } },
      _sum: { amount: true },
    });
    return invoices
      .map((invoice) => {
        const paid = receipts.find((r) => r.appliesToNo === invoice.docNo)?._sum.amount ?? dec(0);
        const balance = invoiceBalance({ total: invoice.total, debited: invoice.debitedAmount, credited: invoice.creditedAmount, deposit: invoice.depositApplied, paid });
        return { invoice, paid: dec(paid), balance, overdue: Boolean(invoice.dueDate && iso(invoice.dueDate)! < today) };
      })
      .filter((x) => x.balance.gt(0));
  }
}
