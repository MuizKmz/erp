import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { MasterDataModule } from './master-data/master-data.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    PlatformModule,
    MasterDataModule,
    // PurchaseModule arrives in step 4.
  ],
  controllers: [HealthController],
})
export class AppModule {}
