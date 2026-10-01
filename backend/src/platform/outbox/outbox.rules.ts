/** Delivery rules for sys_outbox (docs/integration/EVENTS.md → "Rules for the dispatcher"). */

export const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60 * 60 * 1000;

/** `<module>.<document>.<what happened>`, lower case, past tense: purchase.order.released */
const EVENT_NAME = /^[a-z][a-z_]*(\.[a-z][a-z_]*){2,}$/;

export function isValidEventName(name: string): boolean {
  return EVENT_NAME.test(name);
}

/** 5 s, 10 s, 20 s … doubling, never more than 1 hour. `attempts` counts failures so far (≥ 1). */
export function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS);
}

/** After a failed delivery: try again later, or give up after MAX_ATTEMPTS so someone can see it. */
export function afterFailure(
  attempts: number,
  now: Date,
): { status: 'PENDING'; nextAttemptAt: Date } | { status: 'FAILED'; nextAttemptAt: Date } {
  if (attempts >= MAX_ATTEMPTS) return { status: 'FAILED', nextAttemptAt: now };
  return { status: 'PENDING', nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)) };
}
