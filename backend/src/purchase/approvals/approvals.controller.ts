import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { ApprovalsInboxService, type InboxTab } from './approvals-inbox.service';

class InboxQuery {
  @IsOptional()
  @IsIn(['waiting', 'approved', 'rejected'], { message: 'Tab must be waiting, approved or rejected.' })
  status?: InboxTab;
}

class DecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'The comment cannot be longer than 1,000 characters.' })
  comment?: string;
}

/** P02 Approvals inbox and the top-bar badge — /api/v1/purchase/approvals */
@Controller('purchase/approvals')
@RequirePermission(P.VIEW)
export class PurchaseApprovalsController {
  constructor(private readonly inbox: ApprovalsInboxService) {}

  /** The badge on every screen: how many approvals wait for the current user. */
  @Get('count')
  async count(@CurrentContext() ctx: RequestContext) {
    return { waitingForMe: await this.inbox.waitingCount(ctx) };
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @Query() query: InboxQuery) {
    return this.inbox.list(ctx, query.status ?? 'waiting');
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.detail(ctx, id);
  }

  @Post(':id/approve')
  approve(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.inbox.decide(ctx, id, 'APPROVE', dto.comment ?? null);
  }

  @Post(':id/reject')
  reject(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.inbox.decide(ctx, id, 'REJECT', dto.comment ?? null);
  }
}
