import { Module, type OnModuleInit } from '@nestjs/common';
import { PermissionCatalogue } from '../platform/context/permission-catalogue';
import { CONFIG_PERMISSION_CATALOGUE } from './configuration.permissions';
import { ConfigDashboardController } from './dashboard/dashboard.controller';
import { ConfigDashboardQuery } from './dashboard/dashboard.query';

/**
 * The Configuration module (CLAUDE.md → Phase 4): company, branches, users, roles and sign-in. The only writer of
 * the identity and organisation tables (sys_legal_entity, sys_branch, sys_user, sys_role …); other modules read users
 * and branches through MasterDataPort and permissions through @RequirePermission. Never imports purchase/, sales/ or core/.
 */
@Module({
  controllers: [ConfigDashboardController],
  providers: [ConfigDashboardQuery],
})
export class ConfigurationModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionCatalogue) {}

  onModuleInit(): void {
    this.permissions.register(CONFIG_PERMISSION_CATALOGUE);
  }
}
