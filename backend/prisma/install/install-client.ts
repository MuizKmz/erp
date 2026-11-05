/**
 * Sets up one client on an empty tenant: the system items every client needs and one administrator, nothing else.
 * Items, suppliers, customers, units, tax codes and warehouses are the client's own: they add or import them in Core.
 *
 * It never deletes or overwrites: a tenant code that already exists is refused. Amounts are the standard defaults, which
 * the client changes on the settings screens.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { BRANCH_CODE, COMPANY_CODE } from '../../src/configuration/organisation/organisation.rules';
import { STARTER_ROLES, starterPermissions } from '../../src/configuration/roles/roles.rules';
import { SIGN_IN_DEFAULTS, signInKey, type SignInSettings } from '../../src/configuration/settings/sign-in.rules';
import { USER_CODE } from '../../src/configuration/users/users.rules';
import { CATALOGUE } from '../seed/configuration';
import { CREDIT_RULES, ENQUIRY_SOURCES, SALES_EMAIL_TEMPLATES, SEQUENCES as SALES_SEQUENCES } from '../seed/sales-settings';
import { EMAIL_TEMPLATES, PO_TYPES, SEQUENCES as PURCHASE_SEQUENCES } from '../seed/settings';

export interface ClientConfig {
  tenant: { code: string; name: string };
  company: { code: string; legalName: string };
  branch: { code: string; name: string };
  admin: { code: string; name: string; email: string };
}

/** How long the first administrator's set-password link works. Long enough to hand over a new install. */
const LINK_HOURS = 72;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WALK_IN_PRICE_LIST = 'STD';

/** What is wrong with a client file, in words for the person running the install. */
export function checkClientConfig(raw: unknown): string[] {
  const c = (raw ?? {}) as Partial<Record<keyof ClientConfig, Record<string, unknown>>>;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const problems: string[] = [];
  const need = (name: string, value: unknown) => {
    if (!text(value)) problems.push(`${name} is required.`);
  };
  const code = (name: string, value: unknown, pattern: RegExp) => {
    if (!pattern.test(text(value))) problems.push(`${name} must use capitals and digits, like ACME (got "${text(value)}").`);
  };
  code('tenant.code', c.tenant?.code, COMPANY_CODE);
  need('tenant.name', c.tenant?.name);
  code('company.code', c.company?.code, COMPANY_CODE);
  need('company.legalName', c.company?.legalName);
  code('branch.code', c.branch?.code, BRANCH_CODE);
  need('branch.name', c.branch?.name);
  code('admin.code', c.admin?.code, USER_CODE);
  need('admin.name', c.admin?.name);
  if (!EMAIL.test(text(c.admin?.email))) problems.push('admin.email must be an email address.');
  return problems;
}

export interface InstallResult {
  tenantId: string;
  adminCode: string;
  setPasswordUrl: string;
  expiresAt: Date;
}

export async function installClient(prisma: PrismaClient, config: ClientConfig, appUrl: string): Promise<InstallResult> {
  const problems = checkClientConfig(config);
  if (problems.length) throw new Error(`The client file has problems:\n  - ${problems.join('\n  - ')}`);

  const existing = await prisma.sysTenant.findUnique({ where: { code: config.tenant.code } });
  if (existing) throw new Error(`Tenant "${config.tenant.code}" already exists. Nothing was changed.`);

  const { tenant, company, branch, admin } = config;
  const by = admin.code;
  const rawToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + LINK_HOURS * 3_600_000);

  const tenantId = await prisma.$transaction(
    async (tx) => {
      const { id: tenantId } = await tx.sysTenant.create({ data: { code: tenant.code, name: tenant.name, baseCurrency: 'MYR', timezone: 'Asia/Kuala_Lumpur' } });

      // Who works here: the company, its first branch, the starter roles and one administrator.
      const entity = await tx.sysLegalEntity.create({ data: { tenantId, code: company.code, legalName: company.legalName } });
      const firstBranch = await tx.sysBranch.create({ data: { tenantId, legalEntityId: entity.id, code: branch.code, name: branch.name, docPrefix: branch.code } });

      let adminRoleId = '';
      for (const r of STARTER_ROLES) {
        const role = await tx.sysRole.create({
          data: { tenantId, code: r.code, name: r.name, description: r.description, isStarter: true, agentScopeCustomers: !!r.agentScope, agentScopeDocuments: !!r.agentScope },
        });
        if (r.code === 'ADMIN') adminRoleId = role.id;
        const keys = starterPermissions(CATALOGUE, r.code);
        if (keys.length) await tx.sysRolePermission.createMany({ data: keys.map((permission) => ({ tenantId, roleId: role.id, permission })) });
      }

      // No password: the administrator chooses one with the link below.
      const user = await tx.sysUser.create({ data: { tenantId, code: admin.code, name: admin.name, email: admin.email, passwordHash: null } });
      await tx.sysUserRole.create({ data: { tenantId, userId: user.id, roleId: adminRoleId, sortOrder: 0 } });
      await tx.sysUserBranch.create({ data: { tenantId, userId: user.id, branchId: firstBranch.id, isDefault: true } });
      await tx.sysAuthToken.create({
        data: { tenantId, userId: user.id, kind: 'SET_PASSWORD', tokenHash: createHash('sha256').update(rawToken).digest('hex'), expiresAt, createdBy: by },
      });

      for (const [name, value] of Object.entries(SIGN_IN_DEFAULTS) as [keyof SignInSettings, unknown][]) {
        await tx.sysSetting.create({ data: { tenantId, key: signInKey(name), value: value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue) } });
      }

      // Document numbers, all starting at 1.
      await tx.sysNumberSequence.createMany({
        data: [
          ...PURCHASE_SEQUENCES.map((s) => ({ tenantId, docType: s.docType, module: 'purchase', name: s.name, prefix: `${s.docType}-`, digits: 4, nextValue: 1 })),
          ...SALES_SEQUENCES.map((s) => ({
            tenantId, docType: s.docType, module: 'sales', name: s.name, prefix: s.prefix, digits: 4, nextValue: 1,
            format: s.format, resetEvery: s.resetEvery, periodKey: null, perBranch: s.perBranch, printTemplate: s.print,
          })),
          { tenantId, docType: 'CUSTOMER', module: 'core', name: 'Customer', prefix: 'C-', digits: 4, nextValue: 1 },
          { tenantId, docType: 'SUPPLIER', module: 'core', name: 'Supplier', prefix: 'S-', digits: 4, nextValue: 1 },
        ],
      });

      // Purchase policies. Approvers are left empty: the client names them on Approval Rules once its people exist.
      const money = (v: string) => new Prisma.Decimal(v);
      await tx.purPoType.createMany({
        data: PO_TYPES.map((t, i) => ({
          tenantId, code: t.code, name: t.name, description: t.description, needsGoodsReceipt: t.needsGoodsReceipt,
          linkedToSalesOrder: t.linkedToSalesOrder ?? false, sendsToAssetRegister: t.sendsToAssetRegister ?? false, sortOrder: i + 1,
        })),
      });
      await tx.purApprovalRule.createMany({
        data: [
          { docType: 'PO', branchCode: branch.code, condition: 'OVER_AMOUNT', thresholdAmount: money('10000'), approverRole: 'PURCHASE_MANAGER', secondOverAmount: money('50000'), secondApproverRole: 'FINANCE_DIRECTOR' },
          { docType: 'PI', branchCode: null, condition: 'OUTSIDE_TOLERANCE', thresholdAmount: null, approverRole: 'PURCHASE_MANAGER' },
          { docType: 'PDN', branchCode: null, condition: 'CHARGE_NOT_ON_PO', thresholdAmount: null, approverRole: 'PURCHASE_MANAGER' },
          { docType: 'CP', branchCode: null, condition: 'BLOCKED_OVER_AMOUNT', thresholdAmount: money('1000'), approverRole: null },
        ].map((r, i) => ({ tenantId, sortOrder: i + 1, updatedBy: by, ...r })),
      });
      await tx.purSetting.create({
        data: {
          tenantId, priceTolerancePct: money('2'), qtyToleranceOver: money('0'), taxToleranceAmount: money('1'),
          rfqRequiredOn: true, rfqRequiredOver: money('50000'), rfqMinReplies: 2, allowOverReceipt: false, autoDraftBuyToOrder: true,
          onlyActiveSuppliers: true, buyerCannotApproveOwnPo: true, numberWithBranchCode: false, updatedBy: by,
        },
      });
      await tx.purPaymentMethod.create({ data: { tenantId, code: `PETTY-${branch.code}`, kind: 'PETTY_CASH', label: `Petty cash · ${branch.code}`, holder: branch.name, branchCode: branch.code } });
      await tx.purEmailTemplate.createMany({ data: EMAIL_TEMPLATES.map((t, i) => ({ tenantId, sortOrder: i + 1, updatedBy: by, isActive: true, ...t })) });

      // Sales policies.
      await tx.salSetting.create({ data: { tenantId, creditScope: 'GROUP', updatedBy: by } });
      await tx.salCreditRule.createMany({
        data: CREDIT_RULES.map((r, i) => ({ tenantId, docType: r.docType, overCreditAction: r.overCredit, overOverdueAction: r.overOverdue, approverRole: r.approver, sortOrder: i + 1, updatedBy: by })),
      });
      await tx.salOrderType.createMany({
        data: [
          { code: 'STD', name: 'Standard', meaning: 'Ship from stock', isDefault: true },
          { code: 'BTO', name: 'Buy to order', meaning: 'Purchase drafts a PO when released', isDefault: false },
          { code: 'PRJ', name: 'Project', meaning: 'Linked to a project for reporting', isDefault: false },
        ].map((t, i) => ({ tenantId, ...t, sortOrder: i + 1 })),
      });
      await tx.salEnquiryType.create({ data: { tenantId, code: 'GENERAL', name: 'General', details: [], sortOrder: 1 } });
      await tx.salEnquirySource.createMany({ data: ENQUIRY_SOURCES.map((s, i) => ({ tenantId, ...s, sortOrder: i + 1 })) });
      await tx.salEmailTemplate.createMany({ data: SALES_EMAIL_TEMPLATES.map((t, i) => ({ tenantId, ...t, attachPdf: true, isActive: true, sortOrder: i + 1, updatedBy: by })) });

      // Cash sales need the walk-in customer, and it needs a price list and the Cash credit term.
      await tx.mdmPriceList.create({ data: { tenantId, code: WALK_IN_PRICE_LIST, name: 'Standard', validFrom: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)) } });
      await tx.mdmCreditTerm.create({ data: { tenantId, name: 'Cash', days: 0 } });
      await tx.mdmCustomerCategory.create({ data: { tenantId, name: 'Walk-in' } });
      await tx.mdmCustomer.create({
        data: {
          tenantId, code: 'C-CASH', name: 'Cash customer (walk-in)', category: 'Walk-in', branchCode: branch.code, creditTermDays: 0,
          priceListCode: WALK_IN_PRICE_LIST, taxMode: 'INCLUSIVE', isCash: true, status: 'ACTIVE', visibleToAllBranches: true,
        },
      });

      return tenantId;
    },
    { timeout: 60_000 },
  );

  return { tenantId, adminCode: admin.code, setPasswordUrl: `${appUrl.replace(/\/+$/, '')}/sign-in/reset?token=${rawToken}`, expiresAt };
}
