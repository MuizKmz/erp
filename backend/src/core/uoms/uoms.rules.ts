/** Unit-of-measure rules (CLAUDE.md → Phase 3 · Core business rules 1, 3 and 6). Pure functions. */

/** PCS, ROLL, M: a capital first, then capitals and digits, up to 10. Typed once; it never changes. */
export const UOM_CODE = /^[A-Z][A-Z0-9]{0,9}$/;

/** Quantities are stored with 4 decimals, so a unit can allow at most 4. */
export const MAX_DECIMALS = 4;

export const UOM_LABELS: Record<string, string> = { name: 'Name', decimals: 'Decimals', isActive: 'Active' };

/** Decimals can go up any time; down only while nothing uses the unit, because saved quantities may need them. */
export function decimalsChangeError(code: string, from: number, to: number, used: boolean): string | null {
  if (to < from && used) return `${code} is in use, so its decimals cannot go down (from ${from} to ${to}). They can go up.`;
  return null;
}

/** A unit stays active while active items use it as their base, purchase or sales unit, or in a conversion. */
export function deactivateUnitError(code: string, items: string[]): string | null {
  if (!items.length) return null;
  const shown = items.slice(0, 3).join(', ') + (items.length > 3 ? ' …' : '');
  return `${code} is used by ${items.length} active item${items.length === 1 ? '' : 's'} (${shown}). Give ${items.length === 1 ? 'it' : 'them'} another unit first.`;
}
