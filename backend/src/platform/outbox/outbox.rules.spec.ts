import { afterFailure, isValidEventName, MAX_ATTEMPTS, retryDelayMs } from './outbox.rules';

describe('isValidEventName', () => {
  it('accepts <module>.<document>.<what happened>', () => {
    expect(isValidEventName('purchase.order.released')).toBe(true);
    expect(isValidEventName('purchase.order.balance_cancelled')).toBe(true);
    expect(isValidEventName('mdm.item.updated')).toBe(true);
  });

  it('rejects upper case, missing parts and stray characters', () => {
    expect(isValidEventName('Purchase.Order.Released')).toBe(false);
    expect(isValidEventName('purchase.released')).toBe(false);
    expect(isValidEventName('purchase.order.released!')).toBe(false);
    expect(isValidEventName('')).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('doubles from 5 seconds', () => {
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(2)).toBe(10_000);
    expect(retryDelayMs(3)).toBe(20_000);
  });

  it('never waits more than an hour', () => {
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});

describe('afterFailure', () => {
  const now = new Date('2026-09-29T02:00:00.000Z');

  it('schedules a retry while attempts are below the limit', () => {
    expect(afterFailure(1, now)).toEqual({ status: 'PENDING', nextAttemptAt: new Date('2026-09-29T02:00:05.000Z') });
    expect(afterFailure(MAX_ATTEMPTS - 1, now).status).toBe('PENDING');
  });

  it(`marks the event FAILED after ${MAX_ATTEMPTS} failures`, () => {
    expect(afterFailure(MAX_ATTEMPTS, now).status).toBe('FAILED');
  });
});
