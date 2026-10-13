import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../platform/prisma/prisma.service';
import { FinanceStubController } from './finance-stub.controller';
import { STOCK_PORT, type StockLevel, type StockPort } from './integration.ports';

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

@Global()
@Module({
  controllers: [FinanceStubController],
  providers: [{ provide: STOCK_PORT, useClass: StubStockAdapter }],
  exports: [STOCK_PORT],
})
export class IntegrationModule {}
