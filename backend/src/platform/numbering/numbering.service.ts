import { Injectable } from '@nestjs/common';
import { ClockService } from '../clock/clock.service';
import { ConfigurationError } from '../http/errors';
import { assertInTransaction, PrismaService, type Tx } from '../prisma/prisma.service';
import { formatDocNo, formatPattern, nextInSequence, periodKeyFor } from './numbering.rules';

interface SequenceRow {
  id: string;
  prefix: string;
  digits: number;
  nextValue: number;
  format: string | null;
  resetEvery: string;
  periodKey: string | null;
}

/** Where a number is being given: the document date decides the month, the branch fills {BR}. */
export interface NumberingOptions {
  date?: string;
  branchCode?: string | null;
}

/**
 * Hands out document numbers (PO-0007, EQ-2609-0011) on a document's first save.
 * The sequence row is locked with SELECT … FOR UPDATE inside the caller's transaction, so two users saving
 * at the same moment wait for each other instead of getting the same number. If the save rolls back, the
 * number goes back too; a draft deleted later leaves a gap, and numbers are never reused.
 * A sequence with a format uses its pattern; one that restarts monthly begins again at 1 in a new month.
 */
@Injectable()
export class NumberingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async next(tx: Tx, tenantId: string, docType: string, options: NumberingOptions = {}): Promise<string> {
    assertInTransaction(tx, 'NumberingService.next');

    const rows = await tx.$queryRaw<SequenceRow[]>`
      SELECT id, prefix, digits, nextValue, format, resetEvery, periodKey
      FROM sys_number_sequence
      WHERE tenantId = ${tenantId} AND docType = ${docType}
      FOR UPDATE`;
    const seq = rows[0];
    if (!seq) {
      throw new ConfigurationError(`Numbering for ${docType} is not set up. Add it in Document types.`);
    }

    const date = options.date ?? this.clock.today();
    const step = nextInSequence({ nextValue: Number(seq.nextValue), resetEvery: seq.resetEvery, periodKey: seq.periodKey }, date);
    await tx.sysNumberSequence.update({ where: { id: seq.id }, data: { nextValue: step.storeNext, periodKey: step.storePeriod } });
    return this.format(seq, step.value, date, options.branchCode);
  }

  /** The number the next save will get, for display only (Document types screen). Does not reserve it. */
  async peek(tenantId: string, docType: string, options: NumberingOptions = {}): Promise<string | null> {
    const seq = await this.prisma.sysNumberSequence.findUnique({ where: { tenantId_docType: { tenantId, docType } } });
    if (!seq) return null;
    const date = options.date ?? this.clock.today();
    const value = periodKeyFor(seq.resetEvery, date) !== null && seq.periodKey !== periodKeyFor(seq.resetEvery, date) ? 1 : seq.nextValue;
    return this.format(seq, value, date, options.branchCode ?? 'BR');
  }

  private format(seq: Pick<SequenceRow, 'prefix' | 'digits' | 'format'>, value: number, date: string, branchCode?: string | null): string {
    return seq.format ? formatPattern(seq.format, value, date, branchCode) : formatDocNo(seq.prefix, Number(seq.digits), value);
  }
}
