import { Injectable } from '@nestjs/common';
import type { SalesDemand, SalesDemandPort, SalesOrderSummary } from '../../integration/integration.ports';
import { toMoney } from '../../platform/http/decimal';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { toSalesDemand } from './sales-demand.rules';

/**
 * Open sales-order demand for P04 and P06, and the customer and value of a sales order for buy-to-order POs, read from
 * Purchase's own copy (pur_sales_demand, kept by SalesDemandListener). Sales is connected, so no banner.
 */
@Injectable()
export class PurchaseSalesDemandAdapter implements SalesDemandPort {
  readonly connected = true;

  constructor(private readonly prisma: PrismaService) {}

  async listOpenDemand(tenantId: string, itemCodes?: string[]): Promise<SalesDemand[]> {
    const rows = await this.prisma.purSalesDemand.findMany({
      where: { tenantId, ...(itemCodes && { itemCode: { in: itemCodes } }) },
      orderBy: [{ soNo: 'asc' }, { itemCode: 'asc' }, { soLineNo: 'asc' }],
    });
    return toSalesDemand(rows);
  }

  async findSalesOrder(tenantId: string, soNo: string): Promise<SalesOrderSummary | null> {
    const row = await this.prisma.purSalesDemand.findFirst({ where: { tenantId, soNo }, orderBy: { soLineNo: 'asc' } });
    return row ? { soNo: row.soNo, customerName: row.customerName, soTotal: toMoney(row.soTotal) } : null;
  }
}
