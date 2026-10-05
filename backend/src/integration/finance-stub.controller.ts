import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import type { Env } from '../config/env';
import { ClockService } from '../platform/clock/clock.service';
import { CurrentContext } from '../platform/context/context.decorators';
import type { RequestContext } from '../platform/context/request-context';
import { PrismaService } from '../platform/prisma/prisma.service';

export class StubReceiptDto {
  @IsIn(['PROFORMA', 'INVOICE'])
  appliesToType!: 'PROFORMA' | 'INVOICE';

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  appliesToNo!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  customerCode!: string;

  @Type(() => String)
  @Matches(/^\d{1,14}(\.\d{1,2})?$/, { message: 'Amount must look like 11088.00.' })
  amount!: string;
}

/**
 * Dev only: stands in for Finance recording a customer receipt, so deposit and payment flows can be tried before
 * the Finance module exists. Writes fin_receipt_stub, the table Sales reads payments from. Refused outside dev mode.
 */
@Controller('dev/finance/receipts')
export class FinanceStubController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly clock: ClockService,
  ) {}

  @Post()
  async record(@CurrentContext() ctx: RequestContext, @Body() dto: StubReceiptDto) {
    if (this.config.get('AUTH_MODE', { infer: true }) !== 'dev') throw new ForbiddenException('Only available in dev mode.');
    const count = await this.prisma.finReceiptStub.count({ where: { tenantId: ctx.tenantId } });
    const row = await this.prisma.finReceiptStub.create({
      data: {
        tenantId: ctx.tenantId, receiptNo: `OR-${String(count + 1).padStart(4, '0')}`, receiptDate: new Date(`${this.clock.today()}T00:00:00.000Z`),
        customerCode: dto.customerCode, appliesToType: dto.appliesToType, appliesToNo: dto.appliesToNo, amount: dto.amount, method: 'TRANSFER', note: `Recorded in dev by ${ctx.user.name}`,
      },
    });
    return { receiptNo: row.receiptNo, amount: row.amount.toFixed(2) };
  }
}
