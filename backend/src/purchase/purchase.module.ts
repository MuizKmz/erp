import { Module, OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../platform/context/permission.registry';
import { PurchaseApprovalsController } from './approvals/approvals.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { DemandService } from './demand/demand.service';
import { PURCHASE_ROLE_GRANTS } from './purchase.permissions';

/**
 * The Purchase module. Reads shared data only through MasterDataPort and the integration ports, writes only
 * pur_ tables, and tells other modules about changes through the outbox. Never imports from sales/.
 */
@Module({
  controllers: [DashboardController, PurchaseApprovalsController],
  providers: [DemandService, DashboardService],
})
export class PurchaseModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionRegistry) {}

  onModuleInit(): void {
    for (const [role, granted] of Object.entries(PURCHASE_ROLE_GRANTS)) this.permissions.grant(role, granted);
  }
}
