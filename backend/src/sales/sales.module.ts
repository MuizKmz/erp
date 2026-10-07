import { Module, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../platform/context/permission.registry';
import { SalesApprovalsController } from './approvals/approvals.controller';
import { SalesApprovalsInboxService } from './approvals/approvals-inbox.service';
import { SalesDashboardController } from './dashboard/dashboard.controller';
import { SalesDeliveriesController } from './deliveries/deliveries.controller';
import { SalesInvoicesController } from './invoices/invoices.controller';
import { SalesProformasController } from './proformas/proformas.controller';
import { SalesCancelOrdersController } from './cancel-orders/cancel-orders.controller';
import { CancelOrdersQuery } from './cancel-orders/cancel-orders.query';
import { CancelOrdersService } from './cancel-orders/cancel-orders.service';
import { ProformasQuery } from './proformas/proformas.query';
import { ProformasService } from './proformas/proformas.service';
import { DepositsService } from './shared/deposits.service';
import { InvoicesQuery } from './invoices/invoices.query';
import { InvoicesService } from './invoices/invoices.service';
import { DeliveriesQuery } from './deliveries/deliveries.query';
import { DeliveriesService } from './deliveries/deliveries.service';
import { SalesEnquiriesController } from './enquiries/enquiries.controller';
import { EnquiriesQuery } from './enquiries/enquiries.query';
import { EnquiriesService } from './enquiries/enquiries.service';
import { SalesDashboardService } from './dashboard/dashboard.service';
import { SalesLookupsController } from './lookups/lookups.controller';
import { SalesOrdersController } from './orders/orders.controller';
import { OrdersQuery } from './orders/orders.query';
import { OrdersService } from './orders/orders.service';
import { SalesQuotationsController } from './quotations/quotations.controller';
import { QuotationsQuery } from './quotations/quotations.query';
import { QuotationsService } from './quotations/quotations.service';
import { SALES_ROLE_GRANTS } from './sales.permissions';
import { CreditService } from './shared/credit.service';
import { SalesDocumentLines } from './shared/document-lines.service';
import { SalesLinkedDocsService } from './shared/linked-docs.service';
import { ReceivablesService } from './shared/receivables.service';
import { SalesMailService } from './shared/sales-mail.service';

/**
 * The Sales module (CLAUDE.md → Phase 2). Never imports from purchase/; shared data comes through
 * MasterDataPort and cross-module effects go out as outbox events.
 */
@Module({
  controllers: [SalesDashboardController, SalesApprovalsController, SalesOrdersController, SalesLookupsController, SalesQuotationsController, SalesEnquiriesController, SalesDeliveriesController, SalesInvoicesController, SalesProformasController, SalesCancelOrdersController],
  providers: [
    SalesDashboardService,
    SalesApprovalsInboxService,
    ReceivablesService,
    CreditService,
    SalesLinkedDocsService,
    OrdersQuery,
    OrdersService,
    SalesDocumentLines,
    SalesMailService,
    QuotationsQuery,
    QuotationsService,
    EnquiriesQuery,
    EnquiriesService,
    DeliveriesQuery,
    DeliveriesService,
    InvoicesQuery,
    InvoicesService,
    DepositsService,
    ProformasQuery,
    ProformasService,
    CancelOrdersQuery,
    CancelOrdersService,
  ],
})
export class SalesModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionRegistry) {}

  onModuleInit(): void {
    for (const [role, granted] of Object.entries(SALES_ROLE_GRANTS)) this.permissions.grant(role, granted);
  }
}
