import { Controller, Get } from '@nestjs/common';
import { ApprovalsService } from '../../platform/approvals/approvals.service';
import { CurrentContext } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { PUR_ENTITY } from '../shared/purchase.constants';

const PURCHASE_TYPES = new Set<string>(Object.values(PUR_ENTITY));

/** Purchase approvals. Step 3: the top-bar badge count; the inbox (P02) comes in step 4. */
@Controller('purchase/approvals')
export class PurchaseApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** How many Purchase approvals wait for the current user. Shown as the badge on every screen. */
  @Get('count')
  async count(@CurrentContext() ctx: RequestContext) {
    const waiting = (await this.approvals.listWaitingFor(ctx.tenantId, ctx.user)).filter((a) => PURCHASE_TYPES.has(a.entityType));
    return { waitingForMe: waiting.length };
  }
}
