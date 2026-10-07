import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { ReturnInvoiceSearchDto } from '../returns/dto/return.dto';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { DebitNotesQuery } from './debit-notes.query';
import { DebitNotesService } from './debit-notes.service';
import { CreateDebitDto, DebitListQueryDto, DebitVersionDto, UpdateDebitDto } from './dto/debit-note.dto';

/** S25 list, S26 debit note — /api/v1/sales/debit-notes */
@Controller('sales/debit-notes')
export class SalesDebitNotesController {
  constructor(
    private readonly query: DebitNotesQuery,
    private readonly notes: DebitNotesService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: DebitListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('invoices')
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  invoices(@CurrentContext() ctx: RequestContext, @Query() query: ReturnInvoiceSearchDto) {
    return this.query.invoices(ctx, query.q);
  }

  @Get('invoice/:invoiceId')
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  invoice(@CurrentContext() ctx: RequestContext, @Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.query.invoiceFor(ctx, invoiceId);
  }

  @Post()
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateDebitDto) {
    return this.notes.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDebitDto) {
    return this.notes.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() dto: DebitVersionDto) {
    return this.notes.remove(ctx, id, dto.version);
  }

  @Post(':id/release')
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DebitVersionDto) {
    return this.notes.release(ctx, id, dto.version);
  }
}
