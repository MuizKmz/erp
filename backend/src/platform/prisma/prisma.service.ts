import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** A Prisma client inside $transaction. Platform services that must share the caller's transaction take this. */
export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to MySQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * Guards services that are only correct inside a transaction (numbering, outbox).
 * The root client has $transaction; a transaction client does not.
 */
export function assertInTransaction(db: Tx, caller: string): void {
  if ('$transaction' in db) {
    throw new Error(`${caller} must be called inside prisma.$transaction(...)`);
  }
}
