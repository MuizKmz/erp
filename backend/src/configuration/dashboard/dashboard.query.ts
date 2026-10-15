import { Injectable } from '@nestjs/common';
import { ClockService } from '../../platform/clock/clock.service';
import { rolesOn } from '../../platform/context/assignment.rules';
import { PermissionCatalogue } from '../../platform/context/permission-catalogue';
import type { RequestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { AUDITOR_ROLE } from '../roles/roles.rules';
import { readSignInSettings, SIGN_IN_PREFIX } from '../settings/sign-in.rules';
import {
  auditorAttention,
  demoAttention,
  demoFieldsOf,
  joinAnd,
  namesText,
  rolesText,
  twoFactorAttention,
  usersText,
  type AttentionLine,
} from './dashboard.rules';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A01 · Configuration home: who works here, how they sign in, and what needs attention. */
@Injectable()
export class ConfigDashboardQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly catalogue: PermissionCatalogue,
  ) {}

  async summary(ctx: RequestContext) {
    const tenantId = ctx.tenantId;
    const where = { tenantId };
    const now = this.clock.now();
    const [companies, branches, users, roles, settings, openSessions, failed, events] = await Promise.all([
      this.prisma.sysLegalEntity.findMany({ where, orderBy: { code: 'asc' }, select: { legalName: true, demoFields: true } }),
      this.prisma.sysBranch.findMany({ where, orderBy: { code: 'asc' }, select: { name: true } }),
      this.prisma.sysUser.findMany({
        where,
        orderBy: { name: 'asc' },
        select: {
          name: true,
          isActive: true,
          lockedUntil: true,
          twoFactorEnabledAt: true,
          roles: { select: { validFrom: true, validUntil: true, role: { select: { code: true } } } },
        },
      }),
      this.prisma.sysRole.findMany({ where, select: { id: true, code: true, isStarter: true, _count: { select: { users: true } } } }),
      this.prisma.sysSetting.findMany({ where: { tenantId, key: { startsWith: SIGN_IN_PREFIX } }, select: { key: true, value: true } }),
      this.prisma.sysSession.count({ where: { tenantId, revokedAt: null, expiresAt: { gt: now } } }),
      this.prisma.sysLoginAttempt.count({ where: { tenantId, success: false, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
      this.prisma.sysSecurityEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);

    const signIn = readSignInSettings(settings);
    const today = this.clock.todayDate();
    const active = users.filter((u) => u.isActive);
    const mustUseTwoFactor = active.filter((u) =>
      rolesOn(u.roles.map((r) => ({ code: r.role.code, validFrom: r.validFrom, validUntil: r.validUntil })), today).some((code) => signIn.twoFactorRoles.includes(code)),
    );
    const locked = active.filter((u) => u.lockedUntil && u.lockedUntil.getTime() > now.getTime()).length;
    const starter = roles.filter((r) => r.isStarter).length;
    const auditor = roles.find((r) => r.code === AUDITOR_ROLE);
    const modules = this.catalogue.modules();

    const cards = [
      { key: 'companies', label: 'Companies', value: String(companies.length), sub: namesText(companies.map((c) => c.legalName)), to: '/config/company' },
      { key: 'branches', label: 'Branches', value: String(branches.length), sub: namesText(branches.map((b) => b.name)), to: '/config/branches' },
      { key: 'users', label: 'Users', value: String(users.length), sub: usersText(active.length, locked, users.length - active.length), to: '/config/users' },
      { key: 'roles', label: 'Roles', value: String(roles.length), sub: rolesText(starter, roles.length - starter), to: '/config/roles' },
      { key: 'sessions', label: 'Signed in now', value: String(openSessions), sub: 'Sessions on any device', to: '/config/users' },
      {
        key: 'two-factor',
        label: 'Two-factor',
        value: `${mustUseTwoFactor.filter((u) => u.twoFactorEnabledAt).length} of ${mustUseTwoFactor.length}`,
        sub: 'users who must use it have set it up',
        to: '/config/sign-in-settings',
      },
      { key: 'failed', label: 'Failed sign-ins', value: String(failed), sub: 'in the last 24 hours', to: '/config/security-log' },
      {
        key: 'permissions',
        label: 'Permissions',
        value: String(this.catalogue.keys().size),
        sub: `declared by ${joinAnd(modules.map((m) => m.label))}`,
        to: '/config/permissions',
      },
    ];

    const attention = [
      twoFactorAttention(mustUseTwoFactor.filter((u) => !u.twoFactorEnabledAt).map((u) => u.name)),
      auditorAttention(auditor?._count.users ?? 0, auditor?.id ?? null),
      ...companies.map((c) => demoAttention(demoFieldsOf(c.demoFields))),
    ].filter((a): a is AttentionLine => a !== null);

    return {
      cards,
      attention,
      security: events.map((e) => ({ id: e.id, at: e.createdAt.toISOString(), kind: e.kind, userName: e.userName, message: e.message })),
    };
  }
}
