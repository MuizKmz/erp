import { Injectable } from '@nestjs/common';
import { ConfigurationError } from '../http/errors';
import { assertInTransaction, PrismaService, type Tx } from '../prisma/prisma.service';
import { formatDocNo } from './numbering.rules';

interface SequenceRow {
  id: string;
  prefix: string;
  digits: number;
  nextValue: number;
}

/**
 * Hands out document numbers (PO-0007) on a document's first save.
 * The sequence row is locked with SELECT … FOR UPDATE inside the caller's transaction, so two users saving
 * at the same moment wait for each other instead of getting the same number. If the save rolls back, the
 * number goes back too; a draft deleted later leaves a gap, and numbers are never reused.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  async next(tx: Tx, tenantId: string, docType: string): Promise<string> {
    assertInTransaction(tx, 'NumberingService.next');

    const rows = await tx.$queryRaw<SequenceRow[]>`
      SELECT id, prefix, digits, nextValue
      FROM sys_number_sequence
      WHERE tenantId = ${tenantId} AND docType = ${docType}
      FOR UPDATE`;
    const seq = rows[0];
    if (!seq) {
      throw new ConfigurationError(`Numbering for ${docType} is not set up. Add it in Document types.`);
    }

    await tx.sysNumberSequence.update({ where: { id: seq.id }, data: { nextValue: { increment: 1 } } });
    return formatDocNo(seq.prefix, Number(seq.digits), Number(seq.nextValue));
  }

  /** The number the next save will get, for display only (Document types screen). Does not reserve it. */
  async peek(tenantId: string, docType: string): Promise<string | null> {
    const seq = await this.prisma.sysNumberSequence.findUnique({ where: { tenantId_docType: { tenantId, docType } } });
    return seq ? formatDocNo(seq.prefix, seq.digits, seq.nextValue) : null;
  }
}
