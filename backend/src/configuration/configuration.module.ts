import { Module, type OnModuleInit } from '@nestjs/common';
import { PermissionCatalogue } from '../platform/context/permission-catalogue';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { AuthGateModule } from './auth/auth-gate.module';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CredentialsService } from './auth/credentials.service';
import { CONFIG_PERMISSION_CATALOGUE } from './configuration.permissions';
import { ConfigDashboardController } from './dashboard/dashboard.controller';
import { ConfigDashboardQuery } from './dashboard/dashboard.query';
import { ConfigBranchesController, ConfigCompaniesController } from './organisation/organisation.controller';
import { OrganisationQuery } from './organisation/organisation.query';
import { OrganisationService } from './organisation/organisation.service';
import { ConfigPermissionsController, ConfigRolesController } from './roles/roles.controller';
import { RolesQuery } from './roles/roles.query';
import { RolesService } from './roles/roles.service';
import { ConfigSettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { ConfigRecordsService } from './shared/config-records.service';
import { ConfigUsersController } from './users/users.controller';
import { UserSignInService } from './users/user-sign-in.service';
import { UsersQuery } from './users/users.query';
import { UsersService } from './users/users.service';

/**
 * The Configuration module (CLAUDE.md → Phase 4): company, branches, users, roles and sign-in. The only writer of
 * the identity and organisation tables (sys_legal_entity, sys_branch, sys_user, sys_role …); other modules read users
 * and branches through MasterDataPort and permissions through @RequirePermission. Never imports purchase/, sales/ or core/.
 */
@Module({
  imports: [AuthGateModule],
  controllers: [
    AuthController,
    AccountController,
    ConfigDashboardController,
    ConfigCompaniesController,
    ConfigBranchesController,
    ConfigUsersController,
    ConfigRolesController,
    ConfigPermissionsController,
    ConfigSettingsController,
  ],
  providers: [
    AuthService,
    CredentialsService,
    AccountService,
    ConfigDashboardQuery,
    ConfigRecordsService,
    OrganisationQuery,
    OrganisationService,
    UsersQuery,
    UsersService,
    UserSignInService,
    RolesQuery,
    RolesService,
    SettingsService,
  ],
})
export class ConfigurationModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionCatalogue) {}

  onModuleInit(): void {
    this.permissions.register(CONFIG_PERMISSION_CATALOGUE);
  }
}
