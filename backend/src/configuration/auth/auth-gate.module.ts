import { Global, Module } from '@nestjs/common';
import { SESSION_GATE } from '../../platform/context/session-gate';
import { SignInSettingsService } from '../settings/sign-in-settings.service';
import { SecurityEventsService } from '../shared/security-events.service';
import { SessionsGate } from './sessions.gate';

/**
 * Global, so the platform's JWT guard (registered app-wide by the context module) can reach the session check
 * Configuration owns. Also shares the sign-in settings and the security log with the rest of Configuration.
 */
@Global()
@Module({
  providers: [SignInSettingsService, SecurityEventsService, SessionsGate, { provide: SESSION_GATE, useExisting: SessionsGate }],
  exports: [SESSION_GATE, SignInSettingsService, SecurityEventsService],
})
export class AuthGateModule {}
