import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { CreateReceiptDto, NewReceiptQueryDto, ReceiptListQueryDto, ReceiptVersionDto, UpdateReceiptDto } from './dto/receipt.dto';
import { ReceiptsQuery } from './receipts.query';
import { ReceiptsService } from './receipts.service';

/** P14 list and waiting to be received, P15 confirm goods received — /api/v1/purchase/receipts */
@Controller('purchase/receipts')
export class ReceiptsController {
  constructor(
    private readonly query: ReceiptsQuery,
    private readonly receipts: ReceiptsService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: ReceiptListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('waiting')
  @RequirePermission(P.VIEW)
  waiting(@CurrentContext() ctx: RequestContext) {
    return this.query.waiting(ctx);
  }

  /** A new receipt for a PO, filled in with what is still open (nothing is saved). */
  @Get('new')
  @RequirePermission(P.RECEIPT_EDIT)
  template(@CurrentContext() ctx: RequestContext, @Query() query: NewReceiptQueryDto) {
    return this.query.template(ctx, query.poId);
  }

  @Post()
  @RequirePermission(P.RECEIPT_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateReceiptDto) {
    return this.receipts.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(P.RECEIPT_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReceiptDto) {
    return this.receipts.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission(P.RECEIPT_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: ReceiptVersionDto) {
    return this.receipts.remove(ctx, id, q.version);
  }

  @Post(':id/confirm')
  @RequirePermission(P.RECEIPT_CONFIRM)
  confirm(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiptVersionDto) {
    return this.receipts.confirm(ctx, id, dto.version);
  }
}
