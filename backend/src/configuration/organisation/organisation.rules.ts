/**
 * Company and branches (A04, A05; CLAUDE.md → Phase 4, rules 1 and 6). Pure functions: the service passes plain
 * values and gets back the refusal, the notice or the line the screen shows.
 */
import type { OpenDocument } from '../../platform/usage/record-usage.types';
import { countOf, joinAnd, someNames } from '../shared/text.rules';

/** CLB, CLB-MY: capitals, digits and dashes. Codes never change once saved (rule 1). */
export const COMPANY_CODE = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
/** HQ, PNG, KL-2. */
export const BRANCH_CODE = /^[A-Z0-9][A-Z0-9-]{0,9}$/;

export const COMPANY_LABELS: Record<string, string> = {
  legalName: 'Legal name',
  registrationNo: 'Registration no',
  tin: 'TIN',
  salesTaxNo: 'Sales tax no',
  serviceTaxNo: 'Service tax no',
  myinvoisName: 'MyInvois taxpayer name',
  address: 'Address',
  phone: 'Phone',
  email: 'Email',
};

export const BRANCH_LABELS: Record<string, string> = {
  name: 'Name',
  company: 'Company',
  parent: 'Under branch',
  docPrefix: 'Document prefix',
  address: 'Address',
  phone: 'Phone',
  email: 'Email',
  myinvoisBranchName: 'MyInvois branch name',
  isActive: 'Active',
};

/** The demo fields of a company or branch row (a JSON array of field names). */
export function demoFieldsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** A demo value stops being one when it is saved with another value, or cleared (choice 14). */
export function remainingDemoFields(demo: readonly string[], before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : (v ?? null));
  return demo.filter((field) => !(field in after) || (text(after[field]) !== null && text(before[field]) === text(after[field])));
}

/** "The TIN, registration and tax numbers are demo values." for the company banner (A04), or null. */
export function companyDemoNotice(demo: readonly string[]): string | null {
  const has = (f: string) => demo.includes(f);
  const salesTax = has('salesTaxNo');
  const serviceTax = has('serviceTaxNo');
  const words = [has('registrationNo') && 'registration', salesTax && serviceTax ? 'tax' : salesTax ? 'sales tax' : serviceTax ? 'service tax' : null].filter((w): w is string => !!w);
  const numbers = words.length ? `${joinAnd(words)} ${words.length > 1 || (salesTax && serviceTax) ? 'numbers' : 'number'}` : null;
  const parts = [has('tin') ? 'TIN' : null, numbers].filter((p): p is string => !!p);
  if (!parts.length) return null;
  const list = parts.length === 2 && words.length > 1 ? `${parts[0]}, ${parts[1]}` : joinAnd(parts);
  const many = parts.length > 1 || words.length > 1 || (salesTax && serviceTax);
  return `The ${list} ${many ? 'are demo values' : 'is a demo value'}.`;
}

const BRANCH_DEMO_WORD: Record<string, string> = { address: 'address', phone: 'phone', email: 'email', myinvoisBranchName: 'MyInvois branch name' };

/** "The address, phone and email are demo values." for a branch, or null. */
export function branchDemoNotice(demo: readonly string[]): string | null {
  const words = Object.keys(BRANCH_DEMO_WORD).filter((f) => demo.includes(f)).map((f) => BRANCH_DEMO_WORD[f]!);
  if (!words.length) return null;
  return `The ${joinAnd(words)} ${words.length > 1 ? 'are demo values' : 'is a demo value'}.`;
}

export interface BranchNode {
  id: string;
  code: string;
  parentId: string | null;
  legalEntityId: string;
}

/** The branches under a branch, at any depth. */
export function descendantsOf(id: string, branches: readonly BranchNode[]): Set<string> {
  const found = new Set<string>();
  const walk = (parent: string) => {
    for (const b of branches) {
      if (b.parentId === parent && !found.has(b.id)) {
        found.add(b.id);
        walk(b.id);
      }
    }
  };
  walk(id);
  return found;
}

/** Why the branch cannot sit under this parent: another company, or itself or one of its own branches (rule 6). */
export function parentError(branchId: string | null, parentId: string | null, legalEntityId: string, branches: readonly BranchNode[]): string | null {
  if (!parentId) return null;
  const parent = branches.find((b) => b.id === parentId);
  if (!parent) return 'Pick the branch it sits under from the list.';
  if (branchId && (parentId === branchId || descendantsOf(branchId, branches).has(parentId))) return 'A branch cannot sit under itself or one of its own branches.';
  if (parent.legalEntityId !== legalEntityId) return `${parent.code} belongs to another company. Pick a branch of the same company.`;
  return null;
}

/** The parents a branch may pick: branches of its company, not itself or below it. */
export function parentChoices<T extends BranchNode>(branchId: string | null, legalEntityId: string, branches: readonly T[]): T[] {
  const below = branchId ? descendantsOf(branchId, branches) : new Set<string>();
  return branches.filter((b) => b.legalEntityId === legalEntityId && b.id !== branchId && !below.has(b.id));
}

/** Branches in tree order with their depth: each parent followed by its children, by code. */
export function treeOrder<T extends BranchNode>(branches: readonly T[]): (T & { depth: number })[] {
  const out: (T & { depth: number })[] = [];
  const ids = new Set(branches.map((b) => b.id));
  const visit = (parentId: string | null, depth: number) => {
    for (const b of branches.filter((x) => (parentId === null ? !x.parentId || !ids.has(x.parentId) : x.parentId === parentId)).sort((a, z) => a.code.localeCompare(z.code))) {
      out.push({ ...b, depth });
      visit(b.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

/** "PNG is on 7 open documents (SO-0005, PO-0002, QT-0006 …)." */
function openDocumentsText(code: string, open: readonly OpenDocument[]): string {
  const numbers = open.slice(0, 3).map((d) => d.docNo).join(', ');
  return `${code} is on ${countOf(open.length, 'open document')} (${numbers}${open.length > 3 ? ' …' : ''}).`;
}

/**
 * Why a branch cannot be made inactive (rule 6): an active user works only there, or an open document needs it.
 * Users who have other branches simply stop seeing it.
 */
export function branchDeactivateRefusal(code: string, onlyBranchFor: readonly string[], open: readonly OpenDocument[]): string | null {
  if (onlyBranchFor.length) {
    return `${someNames(onlyBranchFor)} ${onlyBranchFor.length === 1 ? 'works' : 'work'} only in ${code}. Give them another branch first.`;
  }
  if (open.length) return `${openDocumentsText(code, open)} Finish or cancel them first.`;
  return null;
}

/** A branch of an inactive company cannot be made active. */
export function branchActivateRefusal(company: { legalName: string; isActive: boolean }): string | null {
  return company.isActive ? null : `${company.legalName} is inactive. Activate the company first.`;
}

/** A company is made inactive only when none of its branches is (rule 6). */
export function companyDeactivateRefusal(legalName: string, activeBranchCodes: readonly string[]): string | null {
  if (!activeBranchCodes.length) return null;
  return `${legalName} has ${countOf(activeBranchCodes.length, 'active branch', 'active branches')} (${someNames(activeBranchCodes)}). Make them inactive first.`;
}

/** A branch moves to another company only while no document carries it: the books are kept per company (SDD ADR-19). */
export function companyMoveRefusal(code: string, documents: number): string | null {
  return documents ? `${code} is on ${countOf(documents, 'document')}, so it stays with its company. Add a new branch for the other company instead.` : null;
}

/** The *In use* card on A05: who works there, its warehouses, and the documents that carry it. */
export function branchInUseText(users: number, warehouses: readonly string[], documents: number): string {
  const parts = [
    users ? `${countOf(users, 'user')} work${users === 1 ? 's' : ''} here` : 'Nobody works here',
    ...(warehouses.length ? [`${countOf(warehouses.length, 'warehouse')} belong${warehouses.length === 1 ? 's' : ''} to it (${warehouses.join(', ')})`] : []),
  ];
  const docs = documents ? `${documents} Purchase and Sales ${documents === 1 ? 'document carries' : 'documents carry'} it` : 'no document carries it';
  return `${parts.join(', ')}, and ${docs}. It can be made inactive only when no user and no open document needs it.`;
}

/** "CLB Groups Sdn Bhd · MYR · 2 branches" under the company title. */
export function companySubtitle(legalName: string, currency: string, branches: number): string {
  return `${legalName} · ${currency} · ${countOf(branches, 'branch', 'branches')}`;
}

export type CompanyAction = 'edit' | 'deactivate' | 'activate' | 'addBranch';

/** Buttons on A04: deactivate shows only when the company could go (no active branch). */
export function companyActions(canEdit: boolean, isActive: boolean, activeBranches: number): CompanyAction[] {
  if (!canEdit) return [];
  return ['edit', ...(isActive ? (activeBranches ? [] : ['deactivate' as const]) : ['activate' as const]), ...(isActive ? ['addBranch' as const] : [])];
}
