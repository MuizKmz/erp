import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './config/env';
import { ConfigurationModule } from './configuration/configuration.module';
import { CoreModule } from './core/core.module';
import { HealthController } from './health/health.controller';
import { IntegrationModule } from './integration/stub-adapters';
import { MasterDataModule } from './master-data/master-data.module';
import { PlatformModule } from './platform/platform.module';
import { PurchaseModule } from './purchase/purchase.module';
import { SalesModule } from './sales/sales.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    PlatformModule,
    MasterDataModule,
    IntegrationModule,
    PurchaseModule,
    SalesModule,
    CoreModule,
    ConfigurationModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
