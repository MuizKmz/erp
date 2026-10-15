import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { readSignInSettings, SIGN_IN_PREFIX, type SignInSettings } from './sign-in.rules';

const MAX_AGE_MS = 30_000;

/** The sign-in settings (A14), read on every request by the session check, so kept for 30 seconds. */
@Injectable()
export class SignInSettingsService {
  private cached: { tenantId: string; at: number; settings: SignInSettings } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string): Promise<SignInSettings> {
    if (this.cached && this.cached.tenantId === tenantId && Date.now() - this.cached.at < MAX_AGE_MS) return this.cached.settings;
    const rows = await this.prisma.sysSetting.findMany({ where: { tenantId, key: { startsWith: SIGN_IN_PREFIX } }, select: { key: true, value: true } });
    const settings = readSignInSettings(rows);
    this.cached = { tenantId, at: Date.now(), settings };
    return settings;
  }

  /** After the settings are saved (A14). */
  invalidate(): void {
    this.cached = null;
  }
}
