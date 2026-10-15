/**
 * Configuration (docs/design/CONFIG_SEED_DATA.md): the company, its branches, the users with their roles and branches,
 * the starter roles with their permissions, and the sign-in settings. Runs first: everything else names these users.
 *
 * Starter roles are what Purchase, Sales and Core grant in code, unchanged, plus Administrator and the Auditor; their
 * permissions come from the modules' catalogues, the same ones the app registers. A reseed puts every seeded row back
 * as it was and removes companies, branches, users and roles made while testing.
 */
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { CONFIG_PERMISSION_CATALOGUE } from '../../src/configuration/configuration.permissions';
import { STARTER_ROLES, starterPermissions } from '../../src/configuration/roles/roles.rules';
import { SIGN_IN_DEFAULTS, signInKey, type SignInSettings } from '../../src/configuration/settings/sign-in.rules';
import { CORE_PERMISSION_CATALOGUE } from '../../src/core/core.permissions';
import type { ModulePermissions } from '../../src/platform/context/permission.rules';
import { PURCHASE_PERMISSION_CATALOGUE } from '../../src/purchase/purchase.permissions';
import { SALES_PERMISSION_CATALOGUE } from '../../src/sales/sales.permissions';
import { AS_SEEDED, type SeedCtx } from './util';

/** Every module's permissions, in the order the app registers them. */
export const CATALOGUE: readonly ModulePermissions[] = [PURCHASE_PERMISSION_CATALOGUE, SALES_PERMISSION_CATALOGUE, CORE_PERMISSION_CATALOGUE, CONFIG_PERMISSION_CATALOGUE];

const ADDRESS_HQ = 'Lot 12, Jalan Perusahaan 3, Seksyen 15, 40200 Shah Alam, Selangor';

/** The values marked demo in CONFIG_SEED_DATA.md are invented; A01 flags them until they are replaced (choice 14). */
const COMPANY = {
  code: 'CLB',
  legalName: 'CLB Groups Sdn Bhd',
  registrationNo: '202001012345 (1356789-K)',
  tin: 'C20881230010',
  salesTaxNo: 'B16-1808-32000001',
  serviceTaxNo: 'B16-1808-32000002',
  myinvoisName: 'CLB GROUPS SDN BHD',
  address: ADDRESS_HQ,
  phone: '+60 3-5510 2200',
  email: 'accounts@clbgroups.my',
  demoFields: ['registrationNo', 'tin', 'salesTaxNo', 'serviceTaxNo'],
};

const BRANCHES = [
  { code: 'HQ', name: 'HQ Shah Alam', docPrefix: 'HQ', myinvoisBranchName: 'HQ SHAH ALAM', address: ADDRESS_HQ, phone: '+60 3-5510 2200', email: 'hq@clbgroups.my', demoFields: [] as string[] },
  {
    code: 'PNG',
    name: 'Penang Branch',
    docPrefix: 'PNG',
    myinvoisBranchName: 'PENANG BRANCH',
    address: 'No. 8, Lorong Perusahaan Maju 5, 13600 Prai, Pulau Pinang',
    phone: '+60 4-507 1180',
    email: 'penang@clbgroups.my',
    demoFields: ['address', 'phone', 'email'],
  },
];

// Branch assignments are not in SEED_DATA.md: Penang manager → PNG only, requesters → HQ, the rest → both. The first
// branch is the default one, and the first role the main one ("Signed in as Lim Mei Ying, Buyer").
// Job titles follow the mockups: "Rahim · Store", "Siti · Admin"; Nurul and Hafiz show only their department.
const USERS: { code: string; name: string; email: string; roles: string[]; branchCodes: string[]; department?: string; jobTitle?: string }[] = [
  { code: 'LMY', name: 'Lim Mei Ying', email: 'meiying@warehouse.com', roles: ['PURCHASE_BUYER', 'AP_CLERK'], branchCodes: ['HQ', 'PNG'], department: 'Purchasing', jobTitle: 'Buyer' },
  { code: 'AZ', name: 'Ahmad Zaki', email: 'zaki@warehouse.com', roles: ['PURCHASE_MANAGER'], branchCodes: ['HQ', 'PNG'], department: 'Purchasing', jobTitle: 'Purchasing Manager' },
  { code: 'TWL', name: 'Tan Wei Ling', email: 'weiling@warehouse.com', roles: ['BRANCH_MANAGER'], branchCodes: ['PNG'], department: 'Penang', jobTitle: 'Branch Manager' },
  { code: 'RI', name: 'Rosnah Ismail', email: 'rosnah@warehouse.com', roles: ['FINANCE_DIRECTOR', 'FINANCE_MANAGER'], branchCodes: ['HQ', 'PNG'], department: 'Finance', jobTitle: 'Finance Director' },
  { code: 'RAH', name: 'Rahim', email: 'rahim@warehouse.com', roles: ['STORE', 'REQUESTER', 'SALES_STORE'], branchCodes: ['HQ', 'PNG'], department: 'Warehouse', jobTitle: 'Store' },
  { code: 'NUR', name: 'Nurul', email: 'nurul@warehouse.com', roles: ['REQUESTER'], branchCodes: ['HQ'], department: 'Production' },
  { code: 'HAF', name: 'Hafiz', email: 'hafiz@warehouse.com', roles: ['REQUESTER', 'STORE'], branchCodes: ['HQ'], department: 'Production' },
  { code: 'SIT', name: 'Siti', email: 'siti@warehouse.com', roles: ['REQUESTER'], branchCodes: ['HQ'], department: 'Office', jobTitle: 'Admin' },
  { code: 'ADM', name: 'Admin', email: 'admin@warehouse.com', roles: ['ADMIN', 'MASTER_DATA_ADMIN'], branchCodes: ['HQ', 'PNG'], jobTitle: 'Admin' },
  // Sales (SALES_SEED_DATA.md). Aina sells, bills and delivers at HQ, as in the mockups.
  { code: 'AR', name: 'Aina Rahman', email: 'aina@warehouse.com', roles: ['SALES_AGENT', 'SALES_BILLING', 'SALES_STORE'], branchCodes: ['HQ'], department: 'Sales', jobTitle: 'Sales agent' },
  { code: 'LWJ', name: 'Lim Wei Jie', email: 'weijie@warehouse.com', roles: ['SALES_AGENT', 'SALES_BILLING'], branchCodes: ['PNG'], department: 'Sales', jobTitle: 'Sales agent' },
  { code: 'FO', name: 'Faizal Omar', email: 'faizal@warehouse.com', roles: ['SALES_AGENT', 'SALES_BILLING'], branchCodes: ['HQ', 'PNG'], department: 'Sales', jobTitle: 'Sales agent' },
  { code: 'NA', name: 'Nor Azlina', email: 'azlina@warehouse.com', roles: ['SALES_MANAGER'], branchCodes: ['HQ', 'PNG'], department: 'Sales', jobTitle: 'Sales Manager' },
  { code: 'SC1', name: 'Siti Counter 1', email: 'counter1@warehouse.com', roles: ['COUNTER_STAFF'], branchCodes: ['HQ'], department: 'Showroom', jobTitle: 'Showroom counter' },
];

/** The users as the seed defines them, for the checks: code → roles and branches. */
export const SEEDED_USERS = USERS;

/** With AUTH_MODE=jwt every seeded user signs in with this password (CONFIG_SEED_DATA.md → Users). Dev mode needs none. */
export const DEMO_PASSWORD = 'Zora-demo-2026';

/** Nobody has signed in yet: no two-factor, no lockout, the demo password just set. */
const NOT_SIGNED_IN = {
  isActive: true,
  passwordChangedAt: null,
  twoFactorSecret: null,
  twoFactorEnabledAt: null,
  recoveryCodes: Prisma.DbNull,
  failedSignIns: 0,
  lockedUntil: null,
  lastSignInAt: null,
};

export async function seedConfiguration(ctx: SeedCtx): Promise<void> {
  const { prisma, tenantId } = ctx;
  const where = { tenantId };
  const madeInConfiguration = { tenantId, createdBy: { not: null } };

  // Assignments are rebuilt below; then whatever was made while testing goes.
  await prisma.sysUserRole.deleteMany({ where });
  await prisma.sysUserBranch.deleteMany({ where });
  await prisma.sysRolePermission.deleteMany({ where });
  await prisma.sysUser.deleteMany({ where: madeInConfiguration });
  await prisma.sysRole.deleteMany({ where: { tenantId, OR: [{ isStarter: false }, { code: { notIn: STARTER_ROLES.map((r) => r.code) } }] } });
  await prisma.sysBranch.updateMany({ where, data: { parentId: null } });
  await prisma.sysBranch.deleteMany({ where: madeInConfiguration });
  await prisma.sysLegalEntity.deleteMany({ where: madeInConfiguration });

  const { code, ...company } = COMPANY;
  const entity = await prisma.sysLegalEntity.upsert({
    where: { tenantId_code: { tenantId, code } },
    update: { ...company, isActive: true, ...AS_SEEDED },
    create: { tenantId, code, ...company },
  });

  const branchId = new Map<string, string>();
  for (const { code: branchCode, ...b } of BRANCHES) {
    const data = { ...b, legalEntityId: entity.id, parentId: null, isActive: true };
    const row = await prisma.sysBranch.upsert({
      where: { tenantId_code: { tenantId, code: branchCode } },
      update: { ...data, ...AS_SEEDED },
      create: { tenantId, code: branchCode, ...data },
    });
    branchId.set(branchCode, row.id);
  }

  const roleId = new Map<string, string>();
  for (const r of STARTER_ROLES) {
    const data = { name: r.name, description: r.description, isStarter: true, agentScopeCustomers: !!r.agentScope, agentScopeDocuments: !!r.agentScope };
    const row = await prisma.sysRole.upsert({
      where: { tenantId_code: { tenantId, code: r.code } },
      update: { ...data, ...AS_SEEDED },
      create: { tenantId, code: r.code, ...data },
    });
    roleId.set(r.code, row.id);
    const keys = starterPermissions(CATALOGUE, r.code);
    if (keys.length) await prisma.sysRolePermission.createMany({ data: keys.map((permission) => ({ tenantId, roleId: row.id, permission })) });
  }

  for (const u of USERS) {
    const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
    const data = { name: u.name, email: u.email, department: u.department ?? null, jobTitle: u.jobTitle ?? null, ...NOT_SIGNED_IN, passwordHash };
    const row = await prisma.sysUser.upsert({
      where: { tenantId_code: { tenantId, code: u.code } },
      update: { ...data, ...AS_SEEDED },
      create: { tenantId, code: u.code, ...data },
    });
    ctx.users.set(row.code, row);
    await prisma.sysUserRole.createMany({
      data: u.roles.map((role, sortOrder) => ({ tenantId, userId: row.id, roleId: roleId.get(role)!, sortOrder })),
    });
    await prisma.sysUserBranch.createMany({
      data: u.branchCodes.map((b, i) => ({ tenantId, userId: row.id, branchId: branchId.get(b)!, isDefault: i === 0 })),
    });
  }

  for (const [name, value] of Object.entries(SIGN_IN_DEFAULTS) as [keyof SignInSettings, unknown][]) {
    const key = signInKey(name);
    const json = value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
    await prisma.sysSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value: json, version: 1, updatedBy: null },
      create: { tenantId, key, value: json },
    });
  }
}
