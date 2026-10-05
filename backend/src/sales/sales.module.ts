import { Module, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../platform/context/permission.registry';
import { SalesApprovalsController } from './approvals/approvals.controller';
import { SalesDashboardController } from './dashboard/dashboard.controller';
import { SalesDashboardService } from './dashboard/dashboard.service';
import { SALES_ROLE_GRANTS } from './sales.permissions';
import { ReceivablesService } from './shared/receivables.service';

/**
 * The Sales module (CLAUDE.md → Phase 2). Never imports from purchase/; shared data comes through
 * MasterDataPort and cross-module effects go out as outbox events.
 */
@Module({
  controllers: [SalesDashboardController, SalesApprovalsController],
  providers: [SalesDashboardService, ReceivablesService],
})
export class SalesModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionRegistry) {}

  onModuleInit(): void {
    for (const [role, granted] of Object.entries(SALES_ROLE_GRANTS)) this.permissions.grant(role, granted);
  }
}
