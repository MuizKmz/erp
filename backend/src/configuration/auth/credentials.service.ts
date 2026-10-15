import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type SysUser } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import type { Env } from '../../config/env';
import { TenantService } from '../../platform/context/tenant.service';
import type { PrismaService, Tx } from '../../platform/prisma/prisma.service';
import { CONFIG_ENTITY } from '../configuration.constants';
import { groupedKey, ISSUER, normalizeRecoveryCode, RECOVERY_CODES, recoveryCodeFrom, totpCode } from './two-factor.rules';

/** argon2id with the library's defaults (64 MiB, 3 passes): NFR-SEC-003, SDD 10.2. */
export const ARGON2 = { type: argon2.argon2id } as const;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// One code back and one ahead, for a phone clock that is a little off.
authenticator.options = { window: 1 };

export interface TwoFactorSetup {
  /** "JBSW Y3DP EHPK 3PXP", to type into the app */
  key: string;
  otpauthUrl: string;
  /** PNG as a data URL, to scan */
  qr: string;
}

export type LinkKind = 'RESET_PASSWORD' | 'SET_PASSWORD';

/**
 * Passwords, two-factor secrets, recovery codes, single-use links and sessions: the pieces sign-in (A02, A03), My
 * account (A11) and the user page (A07) share. Only the hashes of codes and links are kept.
 */
@Injectable()
export class CredentialsService {
  private readonly appUrl: string;

  constructor(
    private readonly tenants: TenantService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true });
  }

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2);
  }

  verifyPassword(hash: string | null, password: string): Promise<boolean> {
    return hash ? argon2.verify(hash, password).catch(() => false) : Promise.resolve(false);
  }

  /** A new secret waiting to be confirmed with a code (set-up is not done until then). */
  async startSetup(db: Tx | PrismaService, user: Pick<SysUser, 'id' | 'email'>): Promise<TwoFactorSetup> {
    const secret = authenticator.generateSecret(20);
    await db.sysUser.update({ where: { id: user.id }, data: { twoFactorSecret: secret, twoFactorEnabledAt: null, recoveryCodes: Prisma.DbNull } });
    return this.setupOf(user.email, secret);
  }

  async setupOf(email: string, secret: string): Promise<TwoFactorSetup> {
    const otpauthUrl = authenticator.keyuri(email, `${ISSUER} · ${await this.tenants.name()}`, secret);
    return { key: groupedKey(secret), otpauthUrl, qr: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }) };
  }

  /** A code from the app: six digits, valid for 30 seconds (one step either side). */
  checkTotp(secret: string | null, typed: string): boolean {
    const code = totpCode(typed);
    return !!secret && !!code && authenticator.check(code, secret);
  }

  /** 8 new recovery codes: shown once, kept only as hashes. */
  newRecoveryCodes(): { plain: string[]; hashes: string[] } {
    const plain = Array.from({ length: RECOVERY_CODES }, () => recoveryCodeFrom(randomBytes(8)));
    return { plain, hashes: plain.map(sha256) };
  }

  /** Uses a recovery code once: the hashes left, or null when the code is not one of them. */
  useRecoveryCode(stored: unknown, typed: string): string[] | null {
    const code = normalizeRecoveryCode(typed);
    const hashes = Array.isArray(stored) ? stored.filter((h): h is string => typeof h === 'string') : [];
    if (!code || !hashes.includes(sha256(code))) return null;
    return hashes.filter((h) => h !== sha256(code));
  }

  /**
   * A single-use link (FR-SEC-063, 064) written to sys_email_log, since real email comes later (choice 10). A newer link
   * replaces any unused older one.
   */
  async issueLink(db: Tx, user: Pick<SysUser, 'id' | 'tenantId' | 'code' | 'name' | 'email'>, kind: LinkKind, minutes: number, sentBy: string): Promise<{ expiresAt: Date }> {
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    await db.sysAuthToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await db.sysAuthToken.create({ data: { tenantId: user.tenantId, userId: user.id, kind, tokenHash: sha256(raw), expiresAt, createdBy: sentBy } });
    const url = `${this.appUrl}/sign-in/reset?token=${raw}`;
    const tenant = await this.tenants.name();
    const reset = kind === 'RESET_PASSWORD';
    await db.sysEmailLog.create({
      data: {
        tenantId: user.tenantId,
        entityType: CONFIG_ENTITY.USER,
        entityId: user.id,
        docNo: user.code,
        templateKey: reset ? 'sign_in.reset' : 'sign_in.set_password',
        toAddress: user.email,
        subject: reset ? 'Reset your Zora Pro ERP password' : 'Set your Zora Pro ERP password',
        body: reset
          ? `Hello ${user.name},\n\nSomeone asked to reset the password of ${user.code} (${user.email}). If it was you, open this link within ${minutes} minutes:\n\n${url}\n\nThe link works once. If you did not ask, ignore this email: your password stays as it is.\n\nZora Pro ERP · ${tenant}`
          : `Hello ${user.name},\n\nAn account was made for you (${user.code}). Choose your password with this link within ${minutes} minutes:\n\n${url}\n\nThe link works once. When it runs out, ask the administrator for a new one.\n\nZora Pro ERP · ${tenant}`,
        sentByCode: sentBy,
      },
    });
    return { expiresAt };
  }

  /** Ends the user's open sessions (all, or all but one); returns how many ended. */
  async endSessions(db: Tx | PrismaService, userId: string, reason: string, keep?: string): Promise<number> {
    const ended = await db.sysSession.updateMany({
      where: { userId, revokedAt: null, ...(keep && { id: { not: keep } }) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return ended.count;
  }
}
