import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { dec } from '../../platform/http/decimal';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { CreateDebitNoteDto, DebitableInvoicesQueryDto, DebitNoteListQueryDto, DebitNoteVersionDto, SubmitDebitNoteDto, UpdateDebitNoteDto } from './dto/debit-note.dto';
import { DebitNotesQuery } from './debit-notes.query';
import { DebitNotesService } from './debit-notes.service';

/** Live "Checked against PO" for the form, before the note is saved. */
class CheckQueryDto {
  @IsUUID('all', { message: 'Pick the supplier invoice.' })
  invoiceId!: string;

  // ?items=A&items=B arrives as an array, ?items=A as a string.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (Array.isArray(value) ? value : value ? [value] : []))
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  items?: string[];

  @IsOptional()
  @Matches(/^\d{1,16}(\.\d{1,2})?$/)
  total?: string;
}

/** P20 list, P21 supplier debit note — /api/v1/purchase/debit-notes */
@Controller('purchase/debit-notes')
export class DebitNotesController {
  constructor(
    private readonly query: DebitNotesQuery,
    private readonly debitNotes: DebitNotesService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: DebitNoteListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('invoices')
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  invoices(@CurrentContext() ctx: RequestContext, @Query() query: DebitableInvoicesQueryDto) {
    return this.query.debitableInvoices(ctx, query.supplierCode);
  }

  @Get('check')
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  check(@CurrentContext() ctx: RequestContext, @Query() query: CheckQueryDto) {
    return this.query.check(ctx, query.invoiceId, query.items ?? [], dec(query.total ?? 0));
  }

  @Post()
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateDebitNoteDto) {
    return this.debitNotes.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDebitNoteDto) {
    return this.debitNotes.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: DebitNoteVersionDto) {
    return this.debitNotes.remove(ctx, id, q.version);
  }

  @Post(':id/submit-for-approval')
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  submit(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitDebitNoteDto) {
    return this.debitNotes.submit(ctx, id, dto);
  }

  @Post(':id/release')
  @RequirePermission(P.DEBIT_NOTE_EDIT)
  release(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DebitNoteVersionDto) {
    return this.debitNotes.release(ctx, id, dto.version);
  }
}
