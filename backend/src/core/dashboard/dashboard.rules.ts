/** Core home (C01). Pure functions: counts grouped by status become the cards' numbers; gaps become *Needs attention*. */
import { validOn } from '../../master-data/master-data.rules';

export interface CountPart {
  key: string;
  label: string;
  count: number;
}

/**
 * Turns `groupBy` rows ({ value, count }) into parts in a fixed order, with 0 for a status nobody has yet, and the
 * total. Values not in `order` still count towards the total.
 */
export function statusParts(rows: { value: string | boolean; count: number }[], order: { key: string; label: string }[]): { total: number; parts: CountPart[] } {
  const byKey = new Map(rows.map((r) => [String(r.value), r.count]));
  return {
    total: rows.reduce((sum, r) => sum + r.count, 0),
    parts: order.map((o) => ({ key: o.key, label: o.label, count: byKey.get(o.key) ?? 0 })),
  };
}

export const ACTIVE_ORDER = [
  { key: 'true', label: 'Active' },
  { key: 'false', label: 'Inactive' },
];

/**
 * Tax codes keep one row per rate period, so they are counted per code: a code is active while it has an active
 * rate today or one still to come.
 */
export function taxCodeCounts(rows: { code: string; isActive: boolean; validFrom: Date; validTo: Date | null }[], today: Date): { value: boolean; count: number }[] {
  const active = new Map<string, boolean>();
  for (const r of rows) {
    const live = r.isActive && (validOn(r, today) || r.validFrom.getTime() > today.getTime());
    active.set(r.code, (active.get(r.code) ?? false) || live);
  }
  const yes = [...active.values()].filter(Boolean).length;
  return [
    { value: true, count: yes },
    { value: false, count: active.size - yes },
  ].filter((r) => r.count > 0);
}

// ── Needs attention ──

export interface AttentionLine {
  key: string;
  /** The linked part, "39 items" */
  lead: string;
  /** The rest of the sentence */
  text: string;
  to: string;
}

export interface PartyIdentity {
  code: string;
  tin: string | null;
  idNumber: string | null;
}

export interface AttentionInput {
  itemsWithoutClassification: number;
  /** Active suppliers, walk-in shops left out. */
  suppliers: PartyIdentity[];
  /** Active customers, the cash customer left out. */
  customers: PartyIdentity[];
  purchasableWithoutSupplier: string[];
  /** Names of the active entries in each reference list. */
  itemGroups: string[];
  customerCategories: string[];
  areas: string[];
}

const blank = (v: string | null) => !v || !v.trim();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Names that are probably the same entry typed twice: "Service" and "Services", "Hardware" and "hardware ". */
export function lookAlikeNames(names: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const key = name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '');
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => [...g].sort());
}

function quoteList(names: string[]): string {
  const q = names.map((n) => `“${n}”`);
  return q.length <= 2 ? q.join(' and ') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
}

/** The sentence for parties that miss part of their e-Invoice identity (SRS FR-MST-042, FR-EIV-002). */
function partyLine(key: string, noun: string, leftOut: string, parties: PartyIdentity[], to: string): AttentionLine | null {
  const gaps = parties.filter((p) => blank(p.tin) || blank(p.idNumber));
  if (!gaps.length) return null;
  const both = gaps.every((p) => blank(p.tin) && blank(p.idNumber));
  const idOnly = gaps.every((p) => blank(p.idNumber) && !blank(p.tin));
  const tinOnly = gaps.every((p) => blank(p.tin) && !blank(p.idNumber));
  const one = gaps.length === 1;
  const have = one ? 'has' : 'have';
  let text: string;
  if (both) text = `${have} no TIN or ID number (${leftOut}). e-Invoices with ${one ? 'it' : 'them'} need both.`;
  else if (idOnly) text = `${have} no ID number yet (${leftOut}). e-Invoices need it with the TIN.`;
  else if (tinOnly) text = `${have} no TIN yet (${leftOut}). e-Invoices need it with the ID number.`;
  else text = `${one ? 'is' : 'are'} missing a TIN or an ID number (${leftOut}). e-Invoices need both.`;
  return { key, lead: plural(gaps.length, noun), text, to };
}

/** What C01 lists under *Needs attention*, in the mockup's order. Nothing here blocks Purchase or Sales. */
export function buildAttention(input: AttentionInput): AttentionLine[] {
  const lines: (AttentionLine | null)[] = [];
  const n = input.itemsWithoutClassification;
  if (n > 0) {
    lines.push({ key: 'item-classification', lead: plural(n, 'item'), text: `${n === 1 ? 'has' : 'have'} no e-Invoice classification code yet. LHDN needs it on every e-Invoice line.`, to: '/core/items' });
  }
  lines.push(partyLine('supplier-identity', 'supplier', 'walk-in shops left out', input.suppliers, '/core/suppliers'));
  lines.push(partyLine('customer-identity', 'customer', 'the cash customer left out', input.customers, '/core/customers'));
  const noSupplier = input.purchasableWithoutSupplier;
  if (noSupplier.length) {
    const shown = noSupplier.slice(0, 5).join(', ') + (noSupplier.length > 5 ? ' …' : '');
    lines.push({
      key: 'preferred-supplier',
      lead: plural(noSupplier.length, 'purchasable item'),
      text: `${noSupplier.length === 1 ? 'has' : 'have'} no preferred supplier: ${shown}. Buyers pick one each time.`,
      to: '/core/items',
    });
  }
  const lists: [string, string, string[]][] = [
    ['Item groups', 'group', input.itemGroups],
    ['Customer categories', 'category', input.customerCategories],
    ['Areas', 'area', input.areas],
  ];
  for (const [lead, noun, names] of lists) {
    for (const group of lookAlikeNames(names)) {
      lines.push({ key: `look-alike-${noun}-${group.join('-')}`, lead, text: `${quoteList(group)} look like the same ${noun}.`, to: '/core/reference' });
    }
  }
  return lines.filter((l): l is AttentionLine => l !== null);
}
