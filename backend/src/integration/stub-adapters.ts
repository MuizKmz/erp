import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { PrismaService } from '../platform/prisma/prisma.service';
import { FinanceStubController } from './finance-stub.controller';
import { STOCK_PORT, type StockLevel, type StockPort } from './integration.ports';
import { WmsStockAdapter } from './wms-stock.adapter';

/** Stock on hand from inv_stock_snapshot until the Inventory module is connected. */
@Injectable()
export class StubStockAdapter implements StockPort {
  readonly connected = false;
  readonly movementsConnected = false;

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
  providers: [
    {
      // A client with a WMS sets WMS_URL; everyone else keeps the snapshot.
      provide: STOCK_PORT,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService<Env, true>, prisma: PrismaService): StockPort => {
        const wms = config.get('WMS', { infer: true });
        return wms ? new WmsStockAdapter(wms) : new StubStockAdapter(prisma);
      },
    },
  ],
  exports: [STOCK_PORT],
})
export class IntegrationModule {}
