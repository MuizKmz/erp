import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { SALES_PERMISSIONS as P } from '../sales.permissions';
import { SalesApprovalsInboxService } from './approvals-inbox.service';

class InboxQuery {
  @IsOptional()
  @IsIn(['waiting', 'approved', 'rejected'])
  status?: 'waiting' | 'approved' | 'rejected';
}

class DecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

/** S02 Approvals inbox and the top-bar badge — /api/v1/sales/approvals */
@Controller('sales/approvals')
@RequirePermission(P.VIEW)
export class SalesApprovalsController {
  constructor(private readonly inbox: SalesApprovalsInboxService) {}

  /** The badge on every Sales screen: how many Sales approvals wait for the current user. */
  @Get('count')
  async count(@CurrentContext() ctx: RequestContext) {
    return { waitingForMe: (await this.inbox.waiting(ctx)).length };
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
