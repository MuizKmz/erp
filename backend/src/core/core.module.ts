import { Module, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../platform/context/permission.registry';
import { CORE_ROLE_GRANTS } from './core.permissions';
import { CoreDashboardController } from './dashboard/dashboard.controller';
import { CoreDashboardQuery } from './dashboard/dashboard.query';
import { CoreRecordsService } from './shared/core-records.service';
import { CoreUsageController } from './usage/usage.controller';
import { CoreUsageQuery } from './usage/usage.query';

/**
 * The Core module (CLAUDE.md → Phase 3): the only writer of the mdm_ tables. Purchase and Sales keep reading them
 * through MasterDataPort. Never imports from purchase/ or sales/, and never reads their tables.
 */
@Module({
  controllers: [CoreDashboardController, CoreUsageController],
  providers: [CoreDashboardQuery, CoreRecordsService, CoreUsageQuery],
})
export class CoreModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionRegistry) {}

  onModuleInit(): void {
    for (const [role, granted] of Object.entries(CORE_ROLE_GRANTS)) this.permissions.grant(role, granted);
  }
}
