/**
 * Guards for reading an event payload. Payloads are JSON written by another module, so a listener checks every field
 * it uses instead of trusting the shape. Module-neutral: no business rules here.
 */

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A non-blank string, else null. */
export const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
