import { Module, OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../platform/context/permission.registry';
import { PurchaseApprovalsController } from './approvals/approvals.controller';
import { ApprovalsInboxService } from './approvals/approvals-inbox.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { DemandController } from './demand/demand.controller';
import { DemandService } from './demand/demand.service';
import { InvoiceApprovalService } from './invoices/invoice-approval.service';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesQuery } from './invoices/invoices.query';
import { InvoicesService } from './invoices/invoices.service';
import { LookupsController } from './lookups/lookups.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersQuery } from './orders/orders.query';
import { OrdersService } from './orders/orders.service';
import { PURCHASE_ROLE_GRANTS } from './purchase.permissions';
import { ReceiptsController } from './receipts/receipts.controller';
import { ReceiptsQuery } from './receipts/receipts.query';
import { ReceiptsService } from './receipts/receipts.service';
import { RequestsController } from './requests/requests.controller';
import { RequestsQuery } from './requests/requests.query';
import { RequestsService } from './requests/requests.service';
import { RfqsController } from './rfqs/rfqs.controller';
import { RfqsQuery } from './rfqs/rfqs.query';
import { RfqsService } from './rfqs/rfqs.service';
import { LinkedDocsService } from './shared/linked-docs.service';
import { PurchaseMailService } from './shared/purchase-mail.service';
import { PurchaseSettingsService } from './shared/purchase-settings.service';

/**
 * The Purchase module. Reads shared data only through MasterDataPort and the integration ports, writes only
 * pur_ tables, and tells other modules about changes through the outbox. Never imports from sales/.
 */
@Module({
  controllers: [DashboardController, PurchaseApprovalsController, OrdersController, LookupsController, DemandController, RequestsController, RfqsController, ReceiptsController, InvoicesController],
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
    RfqsQuery,
    RfqsService,
    ReceiptsQuery,
    ReceiptsService,
    InvoicesQuery,
    InvoicesService,
  ],
})
export class PurchaseModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionRegistry) {}

  onModuleInit(): void {
    for (const [role, granted] of Object.entries(PURCHASE_ROLE_GRANTS)) this.permissions.grant(role, granted);
  }
}
