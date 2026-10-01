/**
 * Seeds docs/design/SEED_DATA.md. Safe to run again: every row is upserted on its natural key.
 *
 * Step 1 seeds only what the platform needs to run: the tenant, branches and users
 * (so the x-dev-user header works). Step 2 adds master data, settings and the Purchase documents.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Fixed id so logs, tests and docs can refer to the one tenant. */
const TENANT_ID = '00000000-0000-4000-8000-000000000001';

const BRANCHES = [
  { code: 'HQ', name: 'HQ Shah Alam' },
  { code: 'PNG', name: 'Penang Branch' },
];

const USERS: { code: string; name: string; email: string; roles: string[]; branchCodes: string[]; department?: string }[] = [
  { code: 'LMY', name: 'Lim Mei Ying', email: 'meiying@warehouse.com', roles: ['PURCHASE_BUYER', 'AP_CLERK'], branchCodes: ['HQ', 'PNG'] },
  { code: 'AZ', name: 'Ahmad Zaki', email: 'zaki@warehouse.com', roles: ['PURCHASE_MANAGER'], branchCodes: ['HQ', 'PNG'] },
  { code: 'TWL', name: 'Tan Wei Ling', email: 'weiling@warehouse.com', roles: ['BRANCH_MANAGER'], branchCodes: ['PNG'] },
  { code: 'RI', name: 'Rosnah Ismail', email: 'rosnah@warehouse.com', roles: ['FINANCE_DIRECTOR'], branchCodes: ['HQ', 'PNG'] },
  { code: 'RAH', name: 'Rahim', email: 'rahim@warehouse.com', roles: ['STORE', 'REQUESTER'], branchCodes: ['HQ', 'PNG'] },
  { code: 'NUR', name: 'Nurul', email: 'nurul@warehouse.com', roles: ['REQUESTER'], branchCodes: ['HQ'], department: 'Production' },
  { code: 'HAF', name: 'Hafiz', email: 'hafiz@warehouse.com', roles: ['REQUESTER', 'STORE'], branchCodes: ['HQ'], department: 'Production' },
  { code: 'SIT', name: 'Siti', email: 'siti@warehouse.com', roles: ['REQUESTER'], branchCodes: ['HQ'], department: 'Office' },
  { code: 'ADM', name: 'Admin', email: 'admin@warehouse.com', roles: ['ADMIN'], branchCodes: ['HQ', 'PNG'] },
];

async function seedTenant(): Promise<void> {
  await prisma.sysTenant.upsert({
    where: { code: 'CLB' },
    update: { name: 'CLB Groups' },
    create: { id: TENANT_ID, code: 'CLB', name: 'CLB Groups', baseCurrency: 'MYR', timezone: 'Asia/Kuala_Lumpur' },
  });
}

async function seedBranches(tenantId: string): Promise<void> {
  for (const b of BRANCHES) {
    await prisma.mdmBranch.upsert({
      where: { tenantId_code: { tenantId, code: b.code } },
      update: { name: b.name, isActive: true },
      create: { tenantId, ...b },
    });
  }
}

async function seedUsers(tenantId: string): Promise<void> {
  for (const u of USERS) {
    const data = {
      name: u.name,
      email: u.email,
      roles: u.roles,
      branchCodes: u.branchCodes,
      department: u.department ?? null,
      isActive: true,
    };
    await prisma.mdmUser.upsert({
      where: { tenantId_code: { tenantId, code: u.code } },
      update: data,
      create: { tenantId, code: u.code, ...data },
    });
  }
}

async function printCounts(): Promise<void> {
  const counts = {
    sys_tenant: await prisma.sysTenant.count(),
    mdm_branch: await prisma.mdmBranch.count(),
    mdm_user: await prisma.mdmUser.count(),
  };
  console.table(counts);
}

async function main(): Promise<void> {
  await seedTenant();
  const tenant = await prisma.sysTenant.findUniqueOrThrow({ where: { code: 'CLB' } });
  await seedBranches(tenant.id);
  await seedUsers(tenant.id);
  await printCounts();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
