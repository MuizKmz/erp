import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DevUserGuard } from './dev-user.guard';
import { DevUsersController } from './dev-users.controller';
import { MeController } from './me.controller';
import { PermissionGuard } from './permission.guard';
import { PermissionRegistry } from './permission.registry';

/**
 * Current user, tenant and branch. Guards run in this order: DevUserGuard (who) → PermissionGuard (may they).
 * Needs a USER_DIRECTORY provider, which MasterDataModule supplies.
 */
@Global()
@Module({
  controllers: [MeController, DevUsersController],
  providers: [
    PermissionRegistry,
    { provide: APP_GUARD, useClass: DevUserGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PermissionRegistry],
})
export class ContextModule {}
