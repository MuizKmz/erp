import { Module, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../platform/context/permission.registry';
import { SalesApprovalsController } from './approvals/approvals.controller';
import { SalesApprovalsInboxService } from './approvals/approvals-inbox.service';
import { SalesDashboardController } from './dashboard/dashboard.controller';
import { SalesDashboardService } from './dashboard/dashboard.service';
import { SalesLookupsController } from './lookups/lookups.controller';
import { SalesOrdersController } from './orders/orders.controller';
import { OrdersQuery } from './orders/orders.query';
import { OrdersService } from './orders/orders.service';
import { SALES_ROLE_GRANTS } from './sales.permissions';
import { CreditService } from './shared/credit.service';
import { SalesLinkedDocsService } from './shared/linked-docs.service';
import { ReceivablesService } from './shared/receivables.service';

/**
 * The Sales module (CLAUDE.md → Phase 2). Never imports from purchase/; shared data comes through
 * MasterDataPort and cross-module effects go out as outbox events.
 */
@Module({
  controllers: [SalesDashboardController, SalesApprovalsController, SalesOrdersController, SalesLookupsController],
  providers: [
    SalesDashboardService,
    SalesApprovalsInboxService,
    ReceivablesService,
    CreditService,
    SalesLinkedDocsService,
    OrdersQuery,
    OrdersService,
  ],
})
export class SalesModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionRegistry) {}

  onModuleInit(): void {
    for (const [role, granted] of Object.entries(SALES_ROLE_GRANTS)) this.permissions.grant(role, granted);
  }
}
