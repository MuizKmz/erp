// A client's server in sign-in mode: set before the app module is loaded (it is required inside beforeAll).
process.env.AUTH_MODE = 'jwt';
process.env.JWT_SECRET = 'e2e-only-secret-0123456789abcdef0123456789abcdef';
process.env.DEV_TENANT_CODE = 'E2E-INSTALL';

import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';
import { checkClientConfig, installClient, type ClientConfig, type InstallResult } from '../prisma/install/install-client';
import { STARTER_ROLES } from '../src/configuration/roles/roles.rules';
import type { Api } from './e2e-helpers';

const CLIENT: ClientConfig = {
  tenant: { code: 'E2E-INSTALL', name: 'Install Test Sdn Bhd' },
  company: { code: 'ITSB', legalName: 'Install Test Sdn Bhd' },
  branch: { code: 'MAIN', name: 'Main Office' },
  admin: { code: 'FIRSTADMIN', name: 'First Admin', email: 'first.admin@install-test.example' },
};
const PASSWORD = 'Chosen-by-the-client-2026';
const backendDir = path.resolve(__dirname, '..');

/** Removes the test tenant from every table, so the demo seed and the other test files find the database as usual. */
async function removeTenant(prisma: PrismaClient): Promise<void> {
  const tenant = await prisma.sysTenant.findUnique({ where: { code: CLIENT.tenant.code } });
  if (!tenant) return;
  const tables = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'tenantId'));
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      for (const m of tables) await tx.$executeRawUnsafe(`DELETE FROM \`${m.dbName ?? m.name}\` WHERE tenantId = ?`, tenant.id);
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
      await tx.sysTenant.delete({ where: { id: tenant.id } });
    },
    { timeout: 60_000 },
  );
}

describe('Client install (end to end, AUTH_MODE=jwt)', () => {
  const prisma = new PrismaClient();
  let helpers: typeof import('./e2e-helpers');
  let api: Api;
  let base: string;
  let installed: InstallResult;

  const call = async (method: string, route: string, opts: { body?: unknown; token?: string } = {}) => {
    const res = await fetch(`${base}/${route}`, {
      method,
      headers: { 'content-type': 'application/json', ...(opts.token && { authorization: `Bearer ${opts.token}` }) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const signIn = (password: string) => call('POST', 'auth/sign-in', { body: { identifier: CLIENT.admin.code, password } });

  beforeAll(async () => {
    helpers = await import('./e2e-helpers');
    await removeTenant(prisma);
    helpers.reseed();
    installed = await installClient(prisma, CLIENT, 'http://localhost:5173/');
    api = await helpers.startApi();
    base = `${(await api.app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`;
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    await removeTenant(prisma);
    await prisma.$disconnect();
    helpers?.reseed();
  }, 300_000);

  it('creates the system items and no demo data', async () => {
    const where = { tenantId: installed.tenantId };
    const counts = {
      users: await prisma.sysUser.count({ where }),
      branches: await prisma.sysBranch.count({ where }),
      roles: await prisma.sysRole.count({ where }),
      items: await prisma.mdmItem.count({ where }),
      suppliers: await prisma.mdmSupplier.count({ where }),
      customers: await prisma.mdmCustomer.count({ where }),
      warehouses: await prisma.mdmWarehouse.count({ where }),
      taxCodes: await prisma.mdmTaxCode.count({ where }),
      purchaseOrders: await prisma.purPurchaseOrder.count({ where }),
      salesOrders: await prisma.salSalesOrder.count({ where }),
      invoices: await prisma.salInvoice.count({ where }),
      outbox: await prisma.sysOutbox.count({ where }),
    };
    expect(counts).toEqual({ users: 1, branches: 1, roles: STARTER_ROLES.length, items: 0, suppliers: 0, customers: 1, warehouses: 0, taxCodes: 0, purchaseOrders: 0, salesOrders: 0, invoices: 0, outbox: 0 });

    const sequences = await prisma.sysNumberSequence.findMany({ where });
    expect(sequences).toHaveLength(21);
    expect(sequences.every((s) => s.nextValue === 1)).toBe(true);

    const walkIn = await prisma.mdmCustomer.findFirstOrThrow({ where });
    expect(walkIn).toMatchObject({ code: 'C-CASH', isCash: true, status: 'ACTIVE', branchCode: 'MAIN' });
    const cash = await prisma.purApprovalRule.findFirstOrThrow({ where: { ...where, docType: 'CP' } });
    expect(cash.thresholdAmount?.toFixed(2)).toBe('1000.00');
  });

  it('refuses a tenant that already exists and changes nothing', async () => {
    await expect(installClient(prisma, { ...CLIENT, admin: { ...CLIENT.admin, code: 'OTHER' } }, 'http://x')).rejects.toThrow('already exists');
    expect(await prisma.sysUser.count({ where: { tenantId: installed.tenantId } })).toBe(1);
  });

  it('names what is wrong with a client file', () => {
    expect(checkClientConfig({})).toEqual(expect.arrayContaining(['tenant.name is required.', 'admin.email must be an email address.']));
    expect(checkClientConfig(CLIENT)).toEqual([]);
  });

  it('refuses the demo seed while a client is on the database, and leaves it alone', () => {
    expect(() => execSync('npx prisma db seed', { cwd: backendDir, stdio: 'pipe' })).toThrow(/holds a client \(E2E-INSTALL\)/);
  });

  it('has no password until the administrator chooses one, and the demo password never works', async () => {
    expect((await prisma.sysUser.findFirstOrThrow({ where: { tenantId: installed.tenantId } })).passwordHash).toBeNull();
    expect((await signIn('Zora-demo-2026')).status).toBe(401);
    await prisma.sysLoginAttempt.deleteMany({ where: { tenantId: installed.tenantId } });
  });

  it('lets the administrator set a password once, sign in with two-factor and open an empty ERP', async () => {
    const token = new URL(installed.setPasswordUrl).searchParams.get('token')!;
    expect(installed.setPasswordUrl.startsWith('http://localhost:5173/sign-in/reset?token=')).toBe(true);

    expect((await call('POST', 'auth/reset', { body: { token, newPassword: PASSWORD } })).status).toBe(200);
    expect((await call('POST', 'auth/reset', { body: { token, newPassword: 'Another-password-2026' } })).status).toBeGreaterThanOrEqual(400);

    // The Administrator role requires two-factor, so the first sign-in sets it up.
    const first = await signIn(PASSWORD);
    expect(first.body.step).toBe('TWO_FACTOR_SETUP');
    const secret = (first.body.setup.key as string).replace(/ /g, '');
    const done = await call('POST', 'auth/two-factor/setup', { body: { ticket: first.body.ticket, code: authenticator.generate(secret) } });
    expect(done.status).toBe(200);
    const access: string = done.body.accessToken;
    expect(access).toBeTruthy();

    for (const route of ['purchase/orders', 'sales/orders', 'sales/invoices', 'core/items']) {
      const list = await call('GET', route, { token: access });
      expect({ route, status: list.status, total: list.body.total }).toEqual({ route, status: 200, total: 0 });
    }
    for (const route of ['purchase/dashboard', 'sales/dashboard', 'core/dashboard', 'config/dashboard', 'purchase/settings/approval-rules', 'sales/settings/credit-control']) {
      expect({ route, status: (await call('GET', route, { token: access })).status }).toEqual({ route, status: 200 });
    }
  });
});
