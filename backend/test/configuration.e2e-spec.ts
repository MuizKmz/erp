import { CORE_ROLE_GRANTS } from '../src/core/core.permissions';
import { PermissionRegistry } from '../src/platform/context/permission.registry';
import { permissionsOf, toRoleGrants } from '../src/platform/context/permission.rules';
import { PURCHASE_ROLE_GRANTS } from '../src/purchase/purchase.permissions';
import { SALES_ROLE_GRANTS } from '../src/sales/sales.permissions';
import { TENANT_ID } from '../prisma/seed/util';
import { reseed, startApi, type Api } from './e2e-helpers';

interface Me {
  user: { code: string; roles: string[]; branchCodes: string[] };
  branchCode: string;
  permissions: string[];
}

/**
 * Configuration module journeys (CLAUDE.md → Phase 4), against the API on fresh demo data. Each build step adds its
 * journey here; A1 checks the module is open, the home's numbers, that users and roles moved without changing what
 * anybody can do, and that a role change applies on the next request.
 */
describe('Configuration (end to end)', () => {
  let api: Api;
  const USERS = ['ADM', 'AZ', 'AR', 'FO', 'HAF', 'LMY', 'LWJ', 'NA', 'NUR', 'RAH', 'RI', 'SIT', 'SC1', 'TWL'];

  beforeAll(async () => {
    reseed();
    api = await startApi();
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    reseed();
  }, 300_000);

  describe('A1 · Module, schema and shell', () => {
    it('opens Configuration from the launcher', async () => {
      const modules = await api.get<{ items: { code: string; state: string; route: string | null }[] }>('me/modules', 'LMY');
      expect(modules.items.find((m) => m.code === 'config')).toMatchObject({ state: 'OPEN', route: '/config' });
    });

    it('shows the A01 numbers and what needs attention, to the Administrator only', async () => {
      const home = await api.get<{ cards: { key: string; value: string; sub: string }[]; attention: { key: string; lead: string; text: string; to: string }[]; security: unknown[] }>(
        'config/dashboard',
      );
      expect(home.cards.map((c) => `${c.key} ${c.value} · ${c.sub}`)).toEqual([
        'companies 1 · CLB Groups Sdn Bhd',
        'branches 2 · HQ Shah Alam · Penang Branch',
        'users 14 · 14 active · 0 locked',
        'roles 16 · 16 starter roles · 0 custom',
        'sessions 0 · Sessions on any device',
        'two-factor 0 of 2 · users who must use it have set it up',
        'failed 0 · in the last 24 hours',
        'permissions 54 · declared by Purchase, Sales, Core and Configuration',
      ]);
      expect(home.attention.map((a) => a.lead)).toEqual(['2 users', 'Auditor', 'Company']);
      expect(home.attention[0]!.text).toContain(': Admin, Rosnah Ismail.');
      expect(home.attention[2]!.text).toBe('has demo values for its TIN and registration number. Replace them before the first real e-Invoice.');
      expect(home.security).toEqual([]);

      const denied = await api.call('GET', 'config/dashboard', 'LMY');
      expect(denied.status).toBe(403);
    });

    it('leaves every user able to do exactly what the code grants allowed before', async () => {
      const fromCode = toRoleGrants(PURCHASE_ROLE_GRANTS, SALES_ROLE_GRANTS, CORE_ROLE_GRANTS);
      for (const code of USERS) {
        const me = await api.get<Me>('me', code);
        expect({ code, permissions: me.permissions }).toEqual({ code, permissions: permissionsOf(fromCode, me.user.roles) });
      }
      const lmy = await api.get<Me>('me', 'LMY');
      expect(lmy.user).toMatchObject({ roles: ['PURCHASE_BUYER', 'AP_CLERK'], branchCodes: ['HQ', 'PNG'] });
      expect(lmy.branchCode).toBe('HQ');
      expect((await api.get<Me>('me', 'TWL')).branchCode).toBe('PNG');
    });

    it('keeps Core reading branches and sales agents, now through the port', async () => {
      const form = await api.get<{ branches: { code: string }[]; agents: { code: string }[] }>('core/lookups/customer-form');
      expect(form.branches.map((b) => b.code)).toEqual(['HQ', 'PNG']);
      expect(form.agents.map((a) => a.code)).toEqual(['AR', 'FO', 'LWJ']);
    });

    it('applies a role change on the next request, and stops an expired role on the day after its last day', async () => {
      const prisma = api.prisma;
      const buyer = await prisma.sysRole.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'PURCHASE_BUYER' } });
      await prisma.sysRolePermission.deleteMany({ where: { roleId: buyer.id, permission: 'purchase.order.release' } });
      api.app.get(PermissionRegistry).invalidate(); // what the role editor (A4) does after saving
      expect((await api.get<Me>('me', 'LMY')).permissions).not.toContain('purchase.order.release');
      await prisma.sysRolePermission.create({ data: { tenantId: TENANT_ID, roleId: buyer.id, permission: 'purchase.order.release' } });
      api.app.get(PermissionRegistry).invalidate();
      expect((await api.get<Me>('me', 'LMY')).permissions).toContain('purchase.order.release');

      // Today in the demo is 29 Sep 2026.
      const ri = await prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'RI' } });
      const finance = await prisma.sysRole.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'FINANCE_MANAGER' } });
      const assignment = { userId_roleId: { userId: ri.id, roleId: finance.id } };
      await prisma.sysUserRole.update({ where: assignment, data: { validUntil: new Date('2026-09-29T00:00:00.000Z') } });
      expect((await api.get<Me>('me', 'RI')).user.roles).toEqual(['FINANCE_DIRECTOR', 'FINANCE_MANAGER']);
      await prisma.sysUserRole.update({ where: assignment, data: { validUntil: new Date('2026-09-28T00:00:00.000Z') } });
      const after = await api.get<Me>('me', 'RI');
      expect(after.user.roles).toEqual(['FINANCE_DIRECTOR']);
      expect(after.permissions).not.toContain('core.customer.credit');
      await prisma.sysUserRole.update({ where: assignment, data: { validUntil: null } });
    });

    it('stamps the request on the activity it writes, so the audit trail can group a change', async () => {
      const base = `${(await api.app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`;
      const correlationId = '7d3c1e9a-4b2f-4c8e-9a51-0e6f2b7d8c41';
      const res = await fetch(`${base}/core/reference/areas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-user': 'ADM', 'x-correlation-id': correlationId },
        body: JSON.stringify({ name: 'Southern' }),
      });
      expect(res.status).toBe(201);
      const rows = await api.prisma.sysActivity.findMany({ where: { tenantId: TENANT_ID, correlationId } });
      expect(rows.map((r) => r.message)).toEqual([expect.stringContaining('Southern')]);
    });
  });

  describe('A2 · Company and branches', () => {
    interface Company {
      id: string;
      code: string;
      version: number;
      subtitle: string;
      demoNotice: string | null;
      branches: { code: string; parent: string | null; docPrefix: string; users: number; isActive: boolean }[];
      activity: { message: string }[];
      allowedActions: string[];
    }
    interface Tree {
      companies: { id: string; code: string; branches: { id: string; code: string; depth: number; users: number }[] }[];
    }
    interface Branch {
      id: string;
      code: string;
      version: number;
      isActive: boolean;
      legalEntityId: string;
      parentId: string | null;
      docPrefix: string | null;
      inUse: { text: string; documents: number; open: { docNo: string }[]; onlyBranchFor: string[] };
      refusals: { deactivate: string | null; activate: string | null };
    }
    const branchFields = (b: Branch & Record<string, unknown>) => ({
      name: b.name,
      legalEntityId: b.legalEntityId,
      parentId: b.parentId,
      docPrefix: b.docPrefix,
      address: b.address,
      phone: b.phone,
      email: b.email,
      myinvoisBranchName: b.myinvoisBranchName,
      isActive: b.isActive,
      version: b.version,
    });
    let clb: Company;
    const branchId = async (code: string) => (await api.get<Tree>('config/branches')).companies.flatMap((c) => c.branches).find((b) => b.code === code)!.id;

    it('shows the company as CfgCompany.html does, with its demo values flagged', async () => {
      const list = await api.get<{ items: { id: string; code: string }[] }>('config/companies');
      clb = await api.get<Company>(`config/companies/${list.items[0]!.id}`);
      expect(clb).toMatchObject({ code: 'CLB', subtitle: 'CLB Groups Sdn Bhd · MYR · 2 branches', demoNotice: 'The TIN, registration and tax numbers are demo values.', activity: [] });
      expect(clb.branches.map((b) => `${b.code} ${b.parent ?? '—'} ${b.docPrefix} ${b.users} ${b.isActive ? 'Active' : 'Inactive'}`)).toEqual(['HQ — HQ 12 Active', 'PNG — PNG 9 Active']);
      expect(clb.allowedActions).toEqual(['edit', 'addBranch']);
      expect((await api.call('GET', `config/companies/${clb.id}`, 'LMY')).status).toBe(403);
    });

    it('logs a change with old and new values, clears the demo flag it replaces, and publishes the event', async () => {
      const body = { legalName: 'CLB Groups Sdn Bhd', registrationNo: '202001012345 (1356789-K)', tin: 'c24000111222', salesTaxNo: 'B16-1808-32000001', serviceTaxNo: 'B16-1808-32000002', myinvoisName: 'CLB GROUPS SDN BHD', address: 'Lot 12, Jalan Perusahaan 3, Seksyen 15, 40200 Shah Alam, Selangor', phone: '+60 3-5510 2200', email: 'accounts@clbgroups.my' };
      expect((await api.call('PATCH', `config/companies/${clb.id}`, 'RI', { ...body, version: clb.version })).status).toBe(403);
      const bad = await api.call('PATCH', `config/companies/${clb.id}`, 'ADM', { ...body, email: 'not an email', version: clb.version });
      expect(bad.status).toBe(400);
      expect(bad.body.errors).toEqual([{ field: 'email', message: 'Enter a valid email address.' }]);

      const saved = (await api.call('PATCH', `config/companies/${clb.id}`, 'ADM', { ...body, version: clb.version })).body as Company;
      expect(saved.demoNotice).toBe('The registration and tax numbers are demo values.');
      expect(saved.activity.map((a) => a.message)).toEqual(['Changed TIN C20881230010 → C24000111222']);
      const stale = await api.call('PATCH', `config/companies/${clb.id}`, 'ADM', { ...body, version: clb.version });
      expect(stale.status).toBe(409);
      const event = await api.prisma.sysOutbox.findFirstOrThrow({ where: { tenantId: TENANT_ID, name: 'config.legal_entity.updated' }, orderBy: { seq: 'desc' } });
      expect(event.payload).toMatchObject({ code: 'CLB', action: 'updated', changedFields: ['tin'], snapshot: { tin: 'C24000111222' } });
      const home = await api.get<{ attention: { key: string; text: string }[] }>('config/dashboard');
      expect(home.attention.find((a) => a.key === 'company-demo')?.text).toBe('has demo values for its registration number. Replace them before the first real e-Invoice.');
      clb = saved;
    });

    it('keeps the company and a branch active while they are needed (rule 6)', async () => {
      const company = await api.call('POST', `config/companies/${clb.id}/deactivate`, 'ADM', { version: clb.version });
      expect(company.status).toBe(409);
      expect(company.body.message).toBe('CLB Groups Sdn Bhd has 2 active branches (HQ and PNG). Make them inactive first.');

      const png = await api.get<Branch & Record<string, unknown>>(`config/branches/${await branchId('PNG')}`);
      expect(png.inUse.text).toBe('9 users work here, 1 warehouse belongs to it (PNG-MAIN), and 44 Purchase and Sales documents carry it. It can be made inactive only when no user and no open document needs it.');
      expect(png.refusals.deactivate).toBe('Lim Wei Jie and Tan Wei Ling work only in PNG. Give them another branch first.');
      const off = await api.call('PATCH', `config/branches/${png.id}`, 'ADM', { ...branchFields(png), isActive: false });
      expect(off.status).toBe(409);
      expect(off.body.message).toBe('Lim Wei Jie and Tan Wei Ling work only in PNG. Give them another branch first.');

      // Give both an HQ link too: now the open documents keep PNG active.
      const hq = await api.prisma.sysBranch.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'HQ' } });
      for (const code of ['LWJ', 'TWL']) {
        const user = await api.prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code } });
        await api.prisma.sysUserBranch.create({ data: { tenantId: TENANT_ID, userId: user.id, branchId: hq.id } });
      }
      const stillOpen = await api.call('PATCH', `config/branches/${png.id}`, 'ADM', { ...branchFields(png), isActive: false });
      expect(stillOpen.status).toBe(409);
      expect(stillOpen.body.message).toBe('PNG is on 12 open documents (PO-0004, SO-0005, SO-0008 …). Finish or cancel them first.');
      await api.prisma.sysUserBranch.deleteMany({ where: { tenantId: TENANT_ID, branchId: hq.id, user: { code: { in: ['LWJ', 'TWL'] } } } });
    });

    it('adds a branch under HQ, refusing a taken code or prefix and a loop', async () => {
      const kl = { code: 'KL', name: 'Kuala Lumpur showroom', legalEntityId: clb.id, parentId: await branchId('HQ'), docPrefix: null, address: null, phone: null, email: null, myinvoisBranchName: null };
      const taken = await api.call('POST', 'config/branches', 'ADM', { ...kl, code: 'PNG', docPrefix: 'PNG' });
      expect(taken.status).toBe(400);
      expect(taken.body.errors).toEqual([
        { field: 'code', message: 'PNG is already a branch code.' },
        { field: 'docPrefix', message: 'PNG is already the document prefix of Penang Branch.' },
      ]);
      const created = await api.call('POST', 'config/branches', 'ADM', kl);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code: 'KL', docPrefix: 'KL', isActive: true, refusals: { deactivate: null } });
      expect(created.body.inUse.text).toBe('Nobody works here, and no document carries it. It can be made inactive only when no user and no open document needs it.');
      const tree = await api.get<Tree>('config/branches');
      expect(tree.companies[0]!.branches.map((b) => `${'-'.repeat(b.depth)}${b.code}`)).toEqual(['HQ', '-KL', 'PNG']);

      const hq = await api.get<Branch & Record<string, unknown>>(`config/branches/${await branchId('HQ')}`);
      const loop = await api.call('PATCH', `config/branches/${hq.id}`, 'ADM', { ...branchFields(hq), parentId: created.body.id });
      expect(loop.status).toBe(400);
      expect(loop.body.errors).toEqual([{ field: 'parentId', message: 'A branch cannot sit under itself or one of its own branches.' }]);
      const activity = await api.prisma.sysActivity.findMany({ where: { tenantId: TENANT_ID, entityType: 'SYS_BRANCH', entityId: created.body.id } });
      expect(activity.map((a) => a.message)).toEqual(['Branch KL added']);
    });

    it('makes an unused branch inactive, and then no user works in it as their default', async () => {
      const kl = await api.get<Branch & Record<string, unknown>>(`config/branches/${await branchId('KL')}`);
      const az = await api.prisma.sysUser.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: 'AZ' } });
      await api.prisma.sysUserBranch.updateMany({ where: { userId: az.id }, data: { isDefault: false } });
      await api.prisma.sysUserBranch.create({ data: { tenantId: TENANT_ID, userId: az.id, branchId: kl.id, isDefault: true } });
      expect((await api.get<{ branchCode: string }>('me', 'AZ')).branchCode).toBe('KL');

      const off = await api.call('PATCH', `config/branches/${kl.id}`, 'ADM', { ...branchFields(kl), isActive: false });
      expect(off.status).toBe(200);
      expect((await api.get<{ branchCode: string; user: { branchCodes: string[] } }>('me', 'AZ')).user.branchCodes).toEqual(['HQ', 'PNG']);
      const activity = await api.prisma.sysActivity.findMany({ where: { tenantId: TENANT_ID, entityType: 'SYS_BRANCH', entityId: kl.id }, orderBy: { createdAt: 'asc' } });
      expect(activity.map((a) => a.message)).toEqual(['Branch KL added', 'Branch KL made inactive']);
      const event = await api.prisma.sysOutbox.findFirstOrThrow({ where: { tenantId: TENANT_ID, name: 'config.branch.updated' }, orderBy: { seq: 'desc' } });
      expect(event.payload).toMatchObject({ code: 'KL', action: 'deactivated', changedFields: ['isActive'], snapshot: { company: 'CLB', parent: 'HQ', isActive: false } });
    });

    it('adds a second company, and moves only a branch no document carries', async () => {
      const created = await api.call('POST', 'config/companies', 'ADM', { code: 'clb-sg', legalName: 'CLB Groups Pte Ltd' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code: 'CLB-SG', subtitle: 'CLB Groups Pte Ltd · MYR · 0 branches', demoNotice: null, allowedActions: ['edit', 'deactivate', 'addBranch'] });
      expect((await api.call('POST', 'config/companies', 'ADM', { code: 'CLB', legalName: 'Again' })).body.errors).toEqual([{ field: 'code', message: 'CLB is already a company code.' }]);

      const png = await api.get<Branch & Record<string, unknown>>(`config/branches/${await branchId('PNG')}`);
      const moved = await api.call('PATCH', `config/branches/${png.id}`, 'ADM', { ...branchFields(png), legalEntityId: created.body.id });
      expect(moved.status).toBe(409);
      expect(moved.body.message).toBe('PNG is on 44 documents, so it stays with its company. Add a new branch for the other company instead.');

      const kl = await api.get<Branch & Record<string, unknown>>(`config/branches/${await branchId('KL')}`);
      const ok = await api.call('PATCH', `config/branches/${kl.id}`, 'ADM', { ...branchFields(kl), legalEntityId: created.body.id, parentId: null });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ company: { code: 'CLB-SG' }, parentId: null });
      const off = await api.call('POST', `config/companies/${created.body.id}/deactivate`, 'ADM', { version: created.body.version });
      expect(off.status).toBe(201);
      expect(off.body).toMatchObject({ isActive: false, allowedActions: ['edit', 'activate'] });
      const activate = await api.call('PATCH', `config/branches/${kl.id}`, 'ADM', { ...branchFields(ok.body), isActive: true });
      expect(activate.status).toBe(409);
      expect(activate.body.message).toBe('CLB Groups Pte Ltd is inactive. Activate the company first.');
    });
  });

  describe('A3 · Users', () => {
    interface UserList {
      items: { id: string; code: string; roles: { name: string }[]; branches: string[]; twoFactorText: string; statusLabel: string }[];
      total: number;
      statusCounts: Record<string, number>;
    }
    interface User {
      id: string;
      code: string;
      version: number;
      subtitle: string;
      roles: { roleCode: string; name: string; permissions: number; validFrom: string | null; validUntil: string | null; counts: boolean }[];
      rolesNote: string;
      branches: string[];
      defaultBranch: string;
      branchNote: string;
      effective: { text: string };
      signIn: { twoFactorText: string; lastSignInAt: string | null; failedSignIns: number };
      activity: { message: string }[];
      allowedActions: string[];
      refusals: { deactivate: string | null };
      status: string;
    }
    const codes = (l: UserList) => l.items.map((i) => i.code);
    const userId = async (code: string) => (await api.get<UserList>(`config/users?q=${code}`)).items.find((i) => i.code === code)!.id;
    const fields = (u: User & Record<string, unknown>) => ({
      name: u.name,
      email: u.email,
      jobTitle: u.jobTitle,
      department: u.department,
      roles: u.roles.map((r) => ({ roleCode: r.roleCode, validFrom: r.validFrom, validUntil: r.validUntil })),
      branches: u.branches,
      defaultBranch: u.defaultBranch,
      version: u.version,
    });
    let nz: User & Record<string, unknown>;

    it('lists the 14 users as CfgUserList.html does, with its filters and tabs', async () => {
      const all = await api.get<UserList>('config/users');
      expect(all.total).toBe(14);
      expect(all.statusCounts).toEqual({ all: 14, active: 14, locked: 0, inactive: 0 });
      expect(all.items[0]).toMatchObject({ code: 'ADM', roles: [{ name: 'Administrator' }, { name: 'Master Data Admin' }], branches: ['HQ', 'PNG'], twoFactorText: 'Required · not set up', statusLabel: 'Active' });
      expect(codes(await api.get<UserList>('config/users?twoFactor=missing'))).toEqual(['ADM', 'RI']);
      expect(codes(await api.get<UserList>('config/users?role=SALES_AGENT'))).toEqual(['AR', 'FO', 'LWJ']);
      expect((await api.get<UserList>('config/users?branch=PNG')).total).toBe(9);
      expect(codes(await api.get<UserList>('config/users?q=wei'))).toEqual(['LWJ', 'TWL']);
      expect((await api.call('GET', 'config/users', 'LMY')).status).toBe(403);
    });

    it('shows a user with what each role gives and what the roles add up to', async () => {
      const ar = await api.get<User>(`config/users/${await userId('AR')}`);
      expect(ar.subtitle).toBe('Aina Rahman · Sales agent · HQ');
      expect(ar.roles.map((r) => `${r.name} ${r.permissions}`)).toEqual(['Sales agent 9', 'Billing 6', 'Sales store 5']);
      expect(ar.rolesNote).toBe('Permissions are the sum of all roles. Sales agent limits them to their own customers (Aina Rahman: C-0012, C-0102). A role can end on a date for temporary access.');
      expect(ar.branchNote).toBe('Works in HQ only. A user with no branch cannot make documents.');
      expect(ar.effective.text).toBe('16 permissions from 3 roles.');
      expect(ar.signIn).toMatchObject({ twoFactorText: 'Not required by their roles', lastSignInAt: null, failedSignIns: 0 });
      expect(ar.allowedActions).toEqual(['edit', 'deactivate']);
      expect(ar.activity).toEqual([]);
      expect((await api.get<User>(`config/users/${await userId('ADM')}`)).refusals.deactivate).toBe('You cannot deactivate yourself. Ask another administrator.');
    });

    it('adds a user only with a free code and email, a role and a branch (rules 1 and 3)', async () => {
      const input = { code: 'NZ', name: 'Nadia Zain', email: 'NADIA@warehouse.com', jobTitle: 'Internal auditor', department: 'Finance', roles: [{ roleCode: 'AUDITOR' }], branches: ['HQ'], defaultBranch: 'HQ' };
      const bad = await api.call('POST', 'config/users', 'ADM', { ...input, code: 'LMY', email: 'meiying@warehouse.com', roles: [], branches: [], defaultBranch: null });
      expect(bad.status).toBe(400);
      expect(bad.body.errors).toEqual([
        { field: 'code', message: 'LMY is already the code of Lim Mei Ying.' },
        { field: 'email', message: 'meiying@warehouse.com is already the email of Lim Mei Ying.' },
        { field: 'roles', message: 'Give the user at least one role.' },
        { field: 'branches', message: 'Give the user at least one branch. A user with no branch cannot make documents.' },
      ]);
      expect((await api.call('POST', 'config/users', 'RI', input)).status).toBe(403);

      const created = await api.call('POST', 'config/users', 'ADM', input);
      expect(created.status).toBe(201);
      nz = created.body;
      expect(nz).toMatchObject({ code: 'NZ', email: 'nadia@warehouse.com', subtitle: 'Nadia Zain · Internal auditor · HQ', effective: { text: '6 permissions from 1 role.' } });
      expect(nz.activity.map((a) => a.message)).toEqual(['User NZ created']);
      const me = await api.get<Me>('me', 'NZ');
      expect(me.permissions).toEqual(['config.audit.view', 'config.security.view', 'config.view', 'core.view', 'purchase.view', 'sales.view']);
      expect(me.branchCode).toBe('HQ');
      const home = await api.get<{ attention: { key: string }[] }>('config/dashboard');
      expect(home.attention.map((a) => a.key)).not.toContain('auditor');
      const event = await api.prisma.sysOutbox.findFirstOrThrow({ where: { tenantId: TENANT_ID, name: 'config.user.created' }, orderBy: { seq: 'desc' } });
      expect(event.payload).toMatchObject({ code: 'NZ', snapshot: { roles: [{ roleCode: 'AUDITOR', validFrom: null, validUntil: null }], branches: ['HQ'], defaultBranch: 'HQ' } });
      const logged = await api.prisma.sysSecurityEvent.findFirstOrThrow({ where: { tenantId: TENANT_ID, userCode: 'NZ' } });
      expect(logged).toMatchObject({ kind: 'USER_CREATED', actorCode: 'ADM', message: 'Nadia Zain added with Auditor' });
    });

    it('gives a role for a while: dates are checked, an ended role stops, and the change is logged', async () => {
      const wrong = await api.call('PATCH', `config/users/${nz.id}`, 'ADM', { ...fields(nz), roles: [{ roleCode: 'AUDITOR' }, { roleCode: 'SALES_BILLING', validFrom: '2026-10-01', validUntil: '2026-09-30' }] });
      expect(wrong.status).toBe(400);
      expect(wrong.body.errors).toEqual([{ field: 'roles[1]', message: 'Until (30 Sep 2026) is before From (1 Oct 2026).' }]);

      const saved = await api.call('PATCH', `config/users/${nz.id}`, 'ADM', { ...fields(nz), roles: [{ roleCode: 'AUDITOR' }, { roleCode: 'SALES_BILLING', validUntil: '2026-09-28' }], branches: ['HQ', 'PNG'], defaultBranch: 'PNG' });
      expect(saved.status).toBe(200);
      nz = saved.body;
      expect(nz.roles.map((r) => `${r.name} ${r.counts ? 'counts' : 'ended'}`)).toEqual(['Auditor counts', 'Billing ended']);
      expect(nz.branchNote).toBe('Works in HQ and PNG; new documents start in PNG, the default branch. A user with no branch cannot make documents.');
      expect(nz.activity[0]!.message).toBe('Changed roles Auditor → Auditor, Billing (until 28 Sep 2026), branches HQ → HQ, PNG and default branch HQ → PNG');
      const me = await api.get<Me>('me', 'NZ');
      expect(me.user.roles).toEqual(['AUDITOR']);
      expect(me.branchCode).toBe('PNG');
      const logged = await api.prisma.sysSecurityEvent.findFirstOrThrow({ where: { tenantId: TENANT_ID, userCode: 'NZ', kind: 'ROLES_CHANGED' } });
      expect(logged.message).toBe('Roles of Nadia Zain changed: added Billing');
    });

    it('always keeps one active Administrator with no end date (rule 2)', async () => {
      const adm = await api.get<User & Record<string, unknown>>(`config/users/${await userId('ADM')}`);
      const ending = { ...fields(adm), roles: [{ roleCode: 'ADMIN', validUntil: '2026-12-31' }, { roleCode: 'MASTER_DATA_ADMIN' }] };
      const refused = await api.call('PATCH', `config/users/${adm.id}`, 'ADM', ending);
      expect(refused.status).toBe(409);
      expect(refused.body.message).toBe('Admin is the only active user who holds Administrator for good. Give the role to someone else first.');

      const second = await api.call('PATCH', `config/users/${nz.id}`, 'ADM', { ...fields(nz), roles: [{ roleCode: 'AUDITOR' }, { roleCode: 'ADMIN' }] });
      expect(second.status).toBe(200);
      nz = second.body;
      expect((await api.call('PATCH', `config/users/${adm.id}`, 'ADM', ending)).status).toBe(200);
      const lastOne = await api.call('PATCH', `config/users/${nz.id}`, 'ADM', { ...fields(nz), roles: [{ roleCode: 'AUDITOR' }] });
      expect(lastOne.status).toBe(409);
      expect(lastOne.body.message).toBe('Nadia Zain is the only active user who holds Administrator for good. Give the role to someone else first.');
      expect((await api.get<User>(`config/users/${nz.id}`)).refusals.deactivate).toBe('Nadia Zain is the only active user who holds Administrator for good. Give the role to someone else first.');
      const restored = await api.call('PATCH', `config/users/${adm.id}`, 'ADM', { ...fields((await api.call('GET', `config/users/${adm.id}`, 'ADM')).body), roles: [{ roleCode: 'ADMIN' }, { roleCode: 'MASTER_DATA_ADMIN' }] });
      expect(restored.status).toBe(200);
    });

    it('deactivates a user, ending their sessions, and never deletes them (rule 3)', async () => {
      await api.prisma.sysSession.create({
        data: { tenantId: TENANT_ID, userId: nz.id, refreshTokenHash: 'test', activeBranchCode: 'PNG', lastActivityAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) },
      });
      const adm = await api.get<User>(`config/users/${await userId('ADM')}`);
      const self = await api.call('POST', `config/users/${adm.id}/deactivate`, 'ADM', { version: adm.version });
      expect(self.status).toBe(409);
      expect(self.body.message).toBe('You cannot deactivate yourself. Ask another administrator.');

      nz = (await api.get<User & Record<string, unknown>>(`config/users/${nz.id}`)) as User & Record<string, unknown>;
      const off = await api.call('POST', `config/users/${nz.id}/deactivate`, 'ADM', { version: nz.version });
      expect(off.status).toBe(201);
      expect(off.body).toMatchObject({ status: 'inactive', allowedActions: ['edit', 'activate'] });
      const session = await api.prisma.sysSession.findFirstOrThrow({ where: { userId: nz.id } });
      expect(session.revokedReason).toBe('DEACTIVATED');
      expect((await api.call('GET', 'me', 'NZ')).status).toBe(401);
      const logged = await api.prisma.sysSecurityEvent.findFirstOrThrow({ where: { tenantId: TENANT_ID, userCode: 'NZ', kind: 'USER_DEACTIVATED' } });
      expect(logged.message).toBe('Nadia Zain deactivated; 1 session ended');
      expect((await api.get<UserList>('config/users')).statusCounts).toEqual({ all: 15, active: 14, locked: 0, inactive: 1 });

      const on = await api.call('POST', `config/users/${nz.id}/activate`, 'ADM', { version: off.body.version });
      expect(on.status).toBe(201);
      expect((await api.get<Me>('me', 'NZ')).user.code).toBe('NZ');
    });
  });
});
