import { Module, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../platform/context/permission.registry';
import { CORE_ROLE_GRANTS } from './core.permissions';
import { CoreCustomersController } from './customers/customers.controller';
import { CustomersQuery } from './customers/customers.query';
import { CustomersService } from './customers/customers.service';
import { CoreDashboardController } from './dashboard/dashboard.controller';
import { CoreDashboardQuery } from './dashboard/dashboard.query';
import { CoreItemsController } from './items/items.controller';
import { ItemsQuery } from './items/items.query';
import { ItemsService } from './items/items.service';
import { CoreLookupsController } from './lookups/lookups.controller';
import { CoreRecordsService } from './shared/core-records.service';
import { CoreSuppliersController } from './suppliers/suppliers.controller';
import { SuppliersQuery } from './suppliers/suppliers.query';
import { SuppliersService } from './suppliers/suppliers.service';
import { CoreUomsController } from './uoms/uoms.controller';
import { UomsQuery } from './uoms/uoms.query';
import { UomsService } from './uoms/uoms.service';
import { CoreUsageController } from './usage/usage.controller';
import { CoreUsageQuery } from './usage/usage.query';

/**
 * The Core module (CLAUDE.md → Phase 3): the only writer of the mdm_ tables. Purchase and Sales keep reading them
 * through MasterDataPort. Never imports from purchase/ or sales/, and never reads their tables.
 */
@Module({
  controllers: [CoreDashboardController, CoreUsageController, CoreLookupsController, CoreItemsController, CoreUomsController, CoreCustomersController, CoreSuppliersController],
  providers: [CoreDashboardQuery, CoreRecordsService, CoreUsageQuery, ItemsQuery, ItemsService, UomsQuery, UomsService, CustomersQuery, CustomersService, SuppliersQuery, SuppliersService],
})
export class CoreModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionRegistry) {}

  onModuleInit(): void {
    for (const [role, granted] of Object.entries(CORE_ROLE_GRANTS)) this.permissions.grant(role, granted);
  }
}
