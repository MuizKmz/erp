// Sign-in mode for this file, with the local demo's two-factor code for ADM: set before the app module is loaded.
process.env.AUTH_MODE = 'jwt';
process.env.JWT_SECRET = 'e2e-only-secret-0123456789abcdef0123456789abcdef';
process.env.DEMO_ADMIN_2FA_BYPASS_CODE = '123456';

import { authenticator } from 'otplib';
import { TENANT_ID } from '../prisma/seed/util';
import type { Api } from './e2e-helpers';

interface Answer<T = any> {
  status: number;
  body: T;
  cookie: string | null;
}

/**
 * The Configuration handbook's journeys A–I (CLAUDE.md → Phase 4 · A8), step by step, in sign-in mode on fresh demo
 * data, expecting the numbers the handbook prints. Run in the handbook's order: later journeys build on earlier ones.
 */
describe('Configuration journeys (end to end, AUTH_MODE=jwt)', () => {
  let api: Api;
  let base = '';
  let helpers: typeof import('./e2e-helpers');
  const DEMO = 'Zora-demo-2026';

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    helpers = require('./e2e-helpers');
    helpers.reseed();
    api = await helpers.startApi();
    base = `${(await api.app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`;
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    helpers?.reseed();
  }, 300_000);

  async function call<T = any>(method: string, route: string, opts: { token?: string; cookie?: string | null; body?: unknown } = {}): Promise<Answer<T>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.cookie) headers.cookie = opts.cookie;
    const res = await fetch(`${base}/${route}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const cookie = res.headers.get('set-cookie')?.match(/zora_refresh=([^;]*)/)?.[1];
    return { status: res.status, body: (await res.json().catch(() => null)) as T, cookie: cookie ? `zora_refresh=${cookie}` : null };
  }
  const signIn = (identifier: string, password = DEMO) => call('POST', 'auth/sign-in', { body: { identifier, password } });
  /** Signed in to the end; ADM types the demo code 123456 where the handbook says so. */
  async function token(identifier: string, password = DEMO): Promise<string> {
    const first = await signIn(identifier, password);
    if (first.body?.step === 'DONE') return first.body.accessToken;
    const route = first.body?.step === 'TWO_FACTOR_SETUP' ? 'auth/two-factor/setup' : 'auth/two-factor';
    const done = await call('POST', route, { body: { ticket: first.body.ticket, code: '123456' } });
    if (done.status !== 200) throw new Error(`${identifier} could not finish sign-in: ${JSON.stringify(done.body)}`);
    return done.body.accessToken;
  }
  const get = async <T = any>(route: string, tok: string): Promise<T> => {
    const res = await call<T>('GET', route, { token: tok });
    if (res.status !== 200) throw new Error(`GET ${route}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const userId = async (code: string) => (await api.prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code } })).id;
  /** The newest sign-in email of a user, as the user page shows it, and the link token in it. */
  async function mailed(admin: string, code: string, kind: 'sign_in.reset' | 'sign_in.set_password') {
    const page = await get<{ signIn: { emails: { kind: string; to: string; body: string }[] } }>(`config/users/${await userId(code)}`, admin);
    const email = page.signIn.emails.find((e) => e.kind === kind)!;
    return { email, token: email.body.match(/token=([A-Za-z0-9_-]+)/)![1]! };
  }
  const clearAttempts = () => api.prisma.sysLoginAttempt.deleteMany({ where: { tenantId: TENANT_ID } });

  let adm = '';

  describe('A · The Administrator signs in and sets up two-factor', () => {
    it('asks for set-up after the password, takes the demo code, and gives 8 recovery codes', async () => {
      const first = await signIn('admin@warehouse.com');
      expect(first.body).toMatchObject({
        step: 'TWO_FACTOR_SETUP',
        reason: 'Your roles (Administrator, Master Data Admin) handle admin and finance work, so a code from your phone is needed at each sign-in.',
        demoBypassCode: '123456',
      });
      const done = await call('POST', 'auth/two-factor/setup', { body: { ticket: first.body.ticket, code: '123456' } });
      expect(done.status).toBe(200);
      expect(done.body.recoveryCodes).toHaveLength(8);
      adm = done.body.accessToken;

      const home = await get<{ cards: { key: string; value: string; sub: string }[]; attention: { lead: string; text: string }[] }>('config/dashboard', adm);
      expect(home.cards.find((c) => c.key === 'two-factor')).toMatchObject({ value: '1 of 2' });
      expect(home.cards.find((c) => c.key === 'sessions')).toMatchObject({ value: '1' });
      expect(home.attention[0]).toMatchObject({ lead: '1 user' });
      expect(home.attention[0]!.text).toContain('Rosnah Ismail');
    });

    it('asks for the code at the next sign-in, and logs the demo code each time', async () => {
      const again = await signIn('ADM');
      expect(again.body.step).toBe('TWO_FACTOR');
      expect((await call('POST', 'auth/two-factor', { body: { ticket: again.body.ticket, code: '000000' } })).status).toBe(401);
      expect((await call('POST', 'auth/two-factor', { body: { ticket: again.body.ticket, code: '123456' } })).status).toBe(200);
      const log = await get<{ items: { kind: string }[] }>('config/security-events?user=ADM&kind=DEMO_CODE_USED', adm);
      expect(log.items).toHaveLength(2);
    });
  });

  describe('B · Company and branches', () => {
    it('flags the demo values, adds a showroom under HQ, and keeps Penang active while two people work only there', async () => {
      const companies = await get<{ items: { id: string }[] }>('config/companies', adm);
      const clb = await get<{ id: string; subtitle: string; demoNotice: string }>(`config/companies/${companies.items[0]!.id}`, adm);
      expect(clb).toMatchObject({ subtitle: 'CLB Groups Sdn Bhd · MYR · 2 branches', demoNotice: 'The TIN, registration and tax numbers are demo values.' });

      const tree = async () => (await get<{ companies: { branches: { id: string; code: string; depth: number }[] }[] }>('config/branches', adm)).companies[0]!.branches;
      const hq = (await tree()).find((b) => b.code === 'HQ')!;
      const kl = await call('POST', 'config/branches', { token: adm, body: { code: 'KL', name: 'Kuala Lumpur showroom', legalEntityId: clb.id, parentId: hq.id, docPrefix: null, address: null, phone: null, email: null, myinvoisBranchName: null } });
      expect(kl.status).toBe(201);
      expect((await tree()).map((b) => `${'-'.repeat(b.depth)}${b.code}`)).toEqual(['HQ', '-KL', 'PNG']);

      const png = await get<{ refusals: { deactivate: string } }>(`config/branches/${(await tree()).find((b) => b.code === 'PNG')!.id}`, adm);
      expect(png.refusals.deactivate).toBe('Lim Wei Jie and Tan Wei Ling work only in PNG. Give them another branch first.');
    });
  });

  let hana = '';

  describe('C · A new user, with a set-password link', () => {
    it('adds Hana Yusof as a sales agent at HQ; she sets her own password from the emailed link', async () => {
      const created = await call('POST', 'config/users', { token: adm, body: { code: 'HY', name: 'Hana Yusof', email: 'hana@warehouse.com', jobTitle: 'Sales agent', department: 'Sales', roles: [{ roleCode: 'SALES_AGENT' }], branches: ['HQ'], defaultBranch: 'HQ' } });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code: 'HY', subtitle: 'Hana Yusof · Sales agent · HQ', signIn: { hasPassword: false } });
      expect((await signIn('HY', 'anything-at-all')).status).toBe(401);

      const { email, token: link } = await mailed(adm, 'HY', 'sign_in.set_password');
      expect(email).toMatchObject({ to: 'hana@warehouse.com' });
      expect((await call('POST', 'auth/link', { body: { token: link } })).body).toMatchObject({ kind: 'SET_PASSWORD', user: { name: 'Hana Yusof' } });
      expect((await call('POST', 'auth/reset', { body: { token: link, newPassword: 'Harbour-light-77' } })).status).toBe(200);
      hana = await token('HY', 'Harbour-light-77');

      const me = await get<{ user: { roles: string[] }; branchCode: string; permissions: string[] }>('me', hana);
      expect(me).toMatchObject({ branchCode: 'HQ', user: { roles: ['SALES_AGENT'] } });
      expect(me.permissions).toHaveLength(9);
    });

    it('shows her no customer yet: a sales agent sees only the customers whose agent she is', async () => {
      expect((await get<{ total: number }>('core/customers', hana)).total).toBe(0);
      expect((await get<{ total: number }>('sales/orders', hana)).total).toBe(0);
    });
  });

  describe('D · Roles and permissions', () => {
    it('adds a permission to Sales agent, which applies on her next request, compares roles, and resets to starter', async () => {
      const roles = await get<{ items: { id: string; code: string; users: number }[] }>('config/roles', adm);
      const agentRow = roles.items.find((r) => r.code === 'SALES_AGENT')!;
      expect(agentRow.users).toBe(4);
      const agent = await get<{ name: string; description: string | null; agentScopeCustomers: boolean; agentScopeDocuments: boolean; permissions: string[]; version: number }>(`config/roles/${agentRow.id}`, adm);
      const saved = await call('PATCH', `config/roles/${agentRow.id}`, {
        token: adm,
        body: { name: agent.name, description: agent.description, agentScopeCustomers: agent.agentScopeCustomers, agentScopeDocuments: agent.agentScopeDocuments, permissions: [...agent.permissions, 'sales.margin.view'], version: agent.version },
      });
      expect(saved.body).toMatchObject({ subtitle: '10 permissions · 4 users · own customers only', asStarter: false });
      expect((await get<{ permissions: string[] }>('me', hana)).permissions).toContain('sales.margin.view');

      const compared = await get<{ text: string }>('config/permissions/compare?a=SALES_AGENT&b=SALES_MANAGER', adm);
      expect(compared.text).toBe('Both roles give 9 permissions. Sales agent sees only its own customers; Sales Manager sees all customers in its branches.');

      const reset = await call('POST', `config/roles/${agentRow.id}/reset-to-starter`, { token: adm, body: { version: saved.body.version } });
      expect(reset.body).toMatchObject({ asStarter: true, subtitle: '9 permissions · 4 users · own customers only' });
      expect((await get<{ permissions: string[] }>('me', hana)).permissions).not.toContain('sales.margin.view');
    });
  });

  describe('E · My account', () => {
    it('Aina changes her password, signs out her other device, and turns two-factor on and off', async () => {
      const laptop = await token('AR');
      const phone = await signIn('AR');
      const account = await get<{ password: { hint: string }; sessions: { current: boolean }[]; twoFactor: { enabled: boolean; required: boolean } }>('account', laptop);
      expect(account).toMatchObject({ password: { hint: 'At least 10 characters. Common passwords are refused.' }, twoFactor: { enabled: false, required: false } });
      expect(account.sessions.length).toBeGreaterThanOrEqual(2);

      const changed = await call('POST', 'account/password', { token: laptop, body: { currentPassword: DEMO, newPassword: 'River-stone-2026' } });
      expect(changed.status).toBe(200);
      expect(changed.body.sessions).toHaveLength(1);
      expect((await call('POST', 'auth/refresh', { cookie: phone.cookie })).status).toBe(401);

      const setup = await call('POST', 'account/two-factor/setup', { token: laptop });
      const on = await call('POST', 'account/two-factor/enable', { token: laptop, body: { code: authenticator.generate((setup.body.key as string).replace(/ /g, '')) } });
      expect(on.body.account.twoFactor).toEqual({ enabled: true, required: false, recoveryCodesLeft: 8 });
      const off = await call('POST', 'account/two-factor/disable', { token: laptop, body: { password: 'River-stone-2026' } });
      expect(off.body.twoFactor.enabled).toBe(false);
    });
  });

  describe('F · Sign-in settings', () => {
    it('locks after 3 wrong passwords, counted per account only, from the next sign-in', async () => {
      const view = await get<{ version: number }>('config/settings/sign-in', adm);
      const saved = await call('PATCH', 'config/settings/sign-in', { token: adm, body: { version: view.version, lockoutAttempts: 3, lockoutPerAddress: false } });
      expect(saved.status).toBe(200);
      expect(saved.body.settings).toMatchObject({ lockoutAttempts: 3, lockoutPerAddress: false });
      const log = await get<{ items: { detail: string }[] }>('config/security-events?kind=SETTINGS_CHANGED', adm);
      expect(log.items[0]!.detail).toBe('Sign-in settings: Changed lock after wrong passwords 5 → 3 and count per network address too Yes → No');
    });
  });

  describe('G · Locked out, and back in', () => {
    beforeAll(() => clearAttempts());

    it('locks Siti after 3 wrong passwords; the Administrator unlocks her', async () => {
      for (const n of [1, 2, 3]) expect((await signIn('SIT', `wrong-${n}`)).status).toBe(401);
      const locked = await signIn('SIT');
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
      expect((await signIn('FO')).status).toBe(200); // the address is not counted any more (journey F)

      const page = await get<{ status: string; allowedActions: string[] }>(`config/users/${await userId('SIT')}`, adm);
      expect(page).toMatchObject({ status: 'locked', allowedActions: expect.arrayContaining(['unlock']) });
      const unlocked = await call('POST', `config/users/${await userId('SIT')}/unlock`, { token: adm });
      expect(unlocked.body.status).toBe('active');
      expect((await signIn('SIT')).body.step).toBe('DONE');
    });

    it('Tan Wei Ling forgets her password and resets it from the emailed link, which then stops working', async () => {
      const answer = await call('POST', 'auth/forgot', { body: { identifier: 'weiling@warehouse.com' } });
      expect(answer.body.message).toBe('If an account matches, a link to reset the password is on its way to its email.');
      const { email, token: link } = await mailed(adm, 'TWL', 'sign_in.reset');
      expect(email.to).toBe('weiling@warehouse.com');
      expect((await call('POST', 'auth/reset', { body: { token: link, newPassword: 'Ocean-lantern-42' } })).status).toBe(200);
      expect((await call('POST', 'auth/reset', { body: { token: link, newPassword: 'Another-lantern-43' } })).status).toBe(410);
      expect((await signIn('TWL', 'Ocean-lantern-42')).body.step).toBe('DONE');
    });
  });

  describe('H · Who sees what (data scopes)', () => {
    it('shows Tan Wei Ling only Penang orders, Aina only her customers, and an HQ order to nobody in Penang', async () => {
      const twl = await token('TWL', 'Ocean-lantern-42');
      const pngOrders = await get<{ total: number; items: { docNo: string }[] }>('purchase/orders?pageSize=100', twl);
      const allOrders = await get<{ total: number }>('purchase/orders?pageSize=100', adm);
      expect(pngOrders.items.map((o) => o.docNo)).toEqual(['PO-0004']);
      expect(allOrders.total).toBe(11);
      const hqPo = await api.prisma.purPurchaseOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, branchCode: 'HQ' } });
      expect((await call('GET', `purchase/orders/${hqPo.id}`, { token: twl })).status).toBe(404);

      const aina = await token('AR', 'River-stone-2026');
      expect((await get<{ items: { code: string }[] }>('core/customers', aina)).items.map((c) => c.code)).toEqual(['C-0012', 'C-0102']);
      const c0045 = await api.prisma.mdmCustomer.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'C-0045' } });
      expect((await call('GET', `core/customers/${c0045.id}`, { token: aina })).status).toBe(404);
    });

    it('shows a Penang customer to HQ once it is visible to all branches', async () => {
      const hafiz = await token('HAF');
      const c0031 = await api.prisma.mdmCustomer.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'C-0031' } });
      expect((await call('GET', `core/customers/${c0031.id}`, { token: hafiz })).status).toBe(404);

      const detail = await get<Record<string, unknown>>(`core/customers/${c0031.id}`, adm);
      const keys = ['name', 'category', 'area', 'branchCode', 'defaultAgentCode', 'billingAddress', 'deliveryAddress', 'contactName', 'email', 'phone', 'tin', 'idType', 'idNumber', 'salesTaxNo', 'serviceTaxNo', 'einvoiceEmail', 'taxMode', 'creditTermDays', 'creditLimit', 'overdueLimit', 'creditScope', 'priceListCode', 'version'];
      const body = Object.fromEntries(keys.map((k) => [k, detail[k]]));
      const saved = await call('PATCH', `core/customers/${c0031.id}`, { token: adm, body: { ...body, visibleToAllBranches: true } });
      expect(saved.status).toBe(200);
      expect(saved.body.activity[0].message).toBe('Changed visible to all branches No → Yes');
      expect((await call('GET', `core/customers/${c0031.id}`, { token: hafiz })).status).toBe(200);
    });
  });

  describe('I · Security log and audit trail', () => {
    it('shows what happened to Siti in the security log, and the role change with its before and after in the audit trail', async () => {
      const siti = await get<{ items: { label: string }[] }>('config/security-events?user=SIT', adm);
      expect(siti.items.map((e) => e.label)).toEqual(['Signed in', 'Unlocked', 'Account locked', 'Sign-in failed', 'Sign-in failed', 'Sign-in failed']);

      const audit = await get<{ items: { id: string; message: string; record: string }[] }>('config/audit?module=config&q=SALES_AGENT&pageSize=50', adm);
      const added = audit.items.find((a) => a.message === 'Permissions: added See margin (Sales)')!;
      expect(added.record).toBe('SALES_AGENT');
      const change = await get<{ changes: { label: string; from: string | null; to: string | null }[] }>(`config/audit/${added.id}`, adm);
      expect(change.changes).toEqual([expect.objectContaining({ label: 'Permissions' })]);
      expect((await call('GET', 'config/audit', { token: hana })).status).toBe(403);
    });
  });
});
