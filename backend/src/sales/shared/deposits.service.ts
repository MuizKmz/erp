import { Injectable } from '@nestjs/common';
import type { Prisma, SalProforma } from '@prisma/client';
import { dec } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { effectiveStatus, type PfStatus } from '../proformas/proforma.rules';

export interface ProformaWithReceived {
  proforma: SalProforma;
  received: Prisma.Decimal;
  status: PfStatus;
}

/**
 * Deposits asked with a proforma and paid through Finance (fin_receipt_stub until Finance is connected).
 * Used by the proforma screens, the delivery hold (rule 9) and the invoice that uses the deposit.
 */
@Injectable()
export class DepositsService {
  constructor(private readonly prisma: PrismaService) {}

  async receivedFor(tenantId: string, docNos: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (!docNos.length) return new Map();
    const rows = await this.prisma.finReceiptStub.groupBy({ by: ['appliesToNo'], where: { tenantId, appliesToType: 'PROFORMA', appliesToNo: { in: docNos } }, _sum: { amount: true } });
    return new Map(rows.map((r) => [r.appliesToNo, r._sum.amount ?? dec(0)]));
  }

  async withReceived(tenantId: string, proformas: SalProforma[]): Promise<ProformaWithReceived[]> {
    const received = await this.receivedFor(tenantId, proformas.map((p) => p.docNo));
    return proformas.map((p) => {
      const r = received.get(p.docNo) ?? dec(0);
      return { proforma: p, received: r, status: effectiveStatus(p.status as PfStatus, p.amount, r) };
    });
  }

  /** Released proformas not paid yet, per sales order: they hold delivery. */
  async unpaidForOrders(tenantId: string, orderIds: string[]): Promise<Map<string, ProformaWithReceived>> {
    if (!orderIds.length) return new Map();
    const rows = await this.prisma.salProforma.findMany({ where: { tenantId, status: 'SENT', salesOrderId: { in: orderIds } }, orderBy: { docDate: 'asc' } });
    const map = new Map<string, ProformaWithReceived>();
    for (const p of await this.withReceived(tenantId, rows)) if (p.status === 'SENT' && !map.has(p.proforma.salesOrderId!)) map.set(p.proforma.salesOrderId!, p);
    return map;
  }

  /** The paid deposit an order's next invoice uses, if any (oldest first). */
  async paidUnusedForOrder(tenantId: string, orderId: string): Promise<ProformaWithReceived | null> {
    const rows = await this.prisma.salProforma.findMany({ where: { tenantId, salesOrderId: orderId, status: { in: ['SENT', 'PAID'] } }, orderBy: { docDate: 'asc' } });
    return (await this.withReceived(tenantId, rows)).find((p) => p.status === 'PAID') ?? null;
  }
}
