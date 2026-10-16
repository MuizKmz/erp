import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { withDataScope } from '../scope/scope.extension';
import { ScopeRegistry } from '../scope/scope.registry';

/** A Prisma client inside $transaction. Platform services that must share the caller's transaction take this. */
export type Tx = Prisma.TransactionClient;

/**
 * The one database client. It carries the data-scope extension (Phase 4 · A7): while a user's request runs, reads of
 * the tables modules registered in ScopeRegistry see only that user's rows. Transactions started from it carry it too.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(registry: ScopeRegistry) {
    super();
    // Nest keeps what the constructor returns: the extended client, which still has this class's methods.
    return withDataScope(this, registry);
  }

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
