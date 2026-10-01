import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import type { Env } from '../config/env';
import { ActivityService } from './activity/activity.service';
import { ApprovalsService } from './approvals/approvals.service';
import { AttachmentsController } from './attachments/attachments.controller';
import { AttachmentsService } from './attachments/attachments.service';
import { ClockModule } from './clock/clock.service';
import { ContextModule } from './context/context.module';
import { NumberingService } from './numbering/numbering.service';
import { OutboxConsumers } from './outbox/outbox.consumers';
import { OutboxDispatcher } from './outbox/outbox.dispatcher';
import { OutboxWriter } from './outbox/outbox.writer';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Shared building blocks with no business rules: database, clock, current user, numbering, activity,
 * approvals, outbox and attachments. Global, so business modules just inject the services.
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    ClockModule,
    ContextModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        limits: { fileSize: config.get('UPLOAD_MAX_BYTES', { infer: true }), files: 1 },
      }),
    }),
  ],
  controllers: [AttachmentsController],
  providers: [
    NumberingService,
    ActivityService,
    ApprovalsService,
    OutboxWriter,
    OutboxConsumers,
    OutboxDispatcher,
    AttachmentsService,
  ],
  exports: [
    PrismaModule,
    ClockModule,
    ContextModule,
    NumberingService,
    ActivityService,
    ApprovalsService,
    OutboxWriter,
    OutboxConsumers,
    AttachmentsService,
  ],
})
export class PlatformModule {}
