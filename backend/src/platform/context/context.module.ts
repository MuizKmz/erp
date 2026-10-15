import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env';
import { DevUserGuard } from './dev-user.guard';
import { DevUsersController } from './dev-users.controller';
import { JwtUserGuard } from './jwt-user.guard';
import { MeController } from './me.controller';
import { PermissionCatalogue } from './permission-catalogue';
import { PermissionGuard } from './permission.guard';
import { PermissionRegistry } from './permission.registry';
import { TenantService } from './tenant.service';

/**
 * Current user, tenant and branch. Guards run in this order: DevUserGuard (who, AUTH_MODE=dev) → JwtUserGuard (who,
 * AUTH_MODE=jwt) → PermissionGuard (may they); the guard of the other mode stands aside. Needs a USER_DIRECTORY provider,
 * which MasterDataModule supplies, and a SESSION_GATE, which Configuration supplies. Modules declare their permissions in the
 * PermissionCatalogue; the PermissionRegistry reads which role holds which from the roles Configuration keeps.
 */
@Global()
@Module({
  imports: [
    // Access tokens (SDD 10.2). Without a secret (dev mode) nothing is ever signed.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({ secret: config.get('JWT_SECRET', { infer: true }) ?? 'dev-mode-signs-nothing' }),
    }),
  ],
  controllers: [MeController, DevUsersController],
  providers: [
    PermissionRegistry,
    PermissionCatalogue,
    TenantService,
    { provide: APP_GUARD, useClass: DevUserGuard },
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PermissionRegistry, PermissionCatalogue, TenantService, JwtModule],
})
export class ContextModule {}
