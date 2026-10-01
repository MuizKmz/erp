import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  SALES_DEMAND_PORT,
  STOCK_PORT,
  type SalesDemand,
  type SalesDemandPort,
  type StockLevel,
  type StockPort,
} from './integration.ports';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Stock on hand from inv_stock_snapshot until the Inventory module is connected. */
@Injectable()
export class StubStockAdapter implements StockPort {
  readonly connected = false;

  constructor(private readonly prisma: PrismaService) {}

  async listStock(tenantId: string, itemCodes?: string[]): Promise<StockLevel[]> {
    const rows = await this.prisma.invStockSnapshot.findMany({
      where: { tenantId, ...(itemCodes && { itemCode: { in: itemCodes } }) },
      orderBy: [{ itemCode: 'asc' }, { warehouseCode: 'asc' }],
    });
    return rows.map((r) => ({
      itemCode: r.itemCode,
      warehouseCode: r.warehouseCode,
      onHand: r.onHand.toFixed(4),
      usedLast30Days: r.usedLast30Days.toFixed(4),
      asOf: r.asOf.toISOString(),
    }));
  }
}

/** Open sales-order needs from sal_demand_stub until the Sales module is built. */
@Injectable()
export class StubSalesDemandAdapter implements SalesDemandPort {
  readonly connected = false;

  constructor(private readonly prisma: PrismaService) {}

  async listOpenDemand(tenantId: string, itemCodes?: string[]): Promise<SalesDemand[]> {
    const rows = await this.prisma.salDemandStub.findMany({
      where: { tenantId, ...(itemCodes && { itemCode: { in: itemCodes } }) },
      orderBy: [{ soNo: 'asc' }, { itemCode: 'asc' }],
    });
    return rows.map((r) => ({
      soNo: r.soNo,
      soDate: isoDate(r.soDate),
      customerName: r.customerName,
      soTotal: r.soTotal.toFixed(2),
      branchCode: r.branchCode,
      itemCode: r.itemCode,
      qty: r.qty.toFixed(4),
      kind: r.kind,
      isBuyToOrder: r.isBuyToOrder,
      neededBy: r.neededBy ? isoDate(r.neededBy) : null,
    }));
  }
}

@Global()
@Module({
  providers: [
    { provide: STOCK_PORT, useClass: StubStockAdapter },
    { provide: SALES_DEMAND_PORT, useClass: StubSalesDemandAdapter },
  ],
  exports: [STOCK_PORT, SALES_DEMAND_PORT],
})
export class IntegrationModule {}
