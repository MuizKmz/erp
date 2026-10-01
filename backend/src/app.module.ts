import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { IntegrationModule } from './integration/stub-adapters';
import { MasterDataModule } from './master-data/master-data.module';
import { PlatformModule } from './platform/platform.module';
import { PurchaseModule } from './purchase/purchase.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    PlatformModule,
    MasterDataModule,
    IntegrationModule,
    PurchaseModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
