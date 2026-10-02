import { Module, OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../platform/context/permission.registry';
import { PurchaseApprovalsController } from './approvals/approvals.controller';
import { ApprovalsInboxService } from './approvals/approvals-inbox.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { DemandController } from './demand/demand.controller';
import { DemandService } from './demand/demand.service';
import { InvoiceApprovalService } from './invoices/invoice-approval.service';
import { LookupsController } from './lookups/lookups.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersQuery } from './orders/orders.query';
import { OrdersService } from './orders/orders.service';
import { PURCHASE_ROLE_GRANTS } from './purchase.permissions';
import { RequestsController } from './requests/requests.controller';
import { RequestsQuery } from './requests/requests.query';
import { RequestsService } from './requests/requests.service';
import { LinkedDocsService } from './shared/linked-docs.service';
import { PurchaseMailService } from './shared/purchase-mail.service';
import { PurchaseSettingsService } from './shared/purchase-settings.service';

/**
 * The Purchase module. Reads shared data only through MasterDataPort and the integration ports, writes only
 * pur_ tables, and tells other modules about changes through the outbox. Never imports from sales/.
 */
@Module({
  controllers: [DashboardController, PurchaseApprovalsController, OrdersController, LookupsController, DemandController, RequestsController],
  providers: [
    DemandService,
    DashboardService,
    PurchaseSettingsService,
    PurchaseMailService,
    LinkedDocsService,
    OrdersQuery,
    OrdersService,
    InvoiceApprovalService,
    ApprovalsInboxService,
    RequestsQuery,
    RequestsService,
  ],
})
export class PurchaseModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionRegistry) {}

  onModuleInit(): void {
    for (const [role, granted] of Object.entries(PURCHASE_ROLE_GRANTS)) this.permissions.grant(role, granted);
  }
}
