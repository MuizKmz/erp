import { businessDate, monthRange, shiftToDate } from './clock.rules';

describe('businessDate', () => {
  it('uses the Kuala Lumpur calendar day, not UTC', () => {
    expect(businessDate(new Date('2026-09-28T17:30:00Z'))).toBe('2026-09-29'); // 01:30 in KL
    expect(businessDate(new Date('2026-09-29T15:59:00Z'))).toBe('2026-09-29'); // 23:59 in KL
    expect(businessDate(new Date('2026-09-29T16:00:00Z'))).toBe('2026-09-30'); // midnight in KL
  });
});

describe('monthRange', () => {
  it('gives the first and last day of the month', () => {
    const r = monthRange('2026-09-29');
    expect(r.month).toBe('2026-09');
    expect(r.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });

  it('handles February in a leap year', () => {
    expect(monthRange('2028-02-10').to.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
});

describe('shiftToDate', () => {
  it('moves the date but keeps the time of day', () => {
    const real = new Date('2026-10-01T02:01:00Z'); // 1 Oct, 10:01 in KL
    const shifted = shiftToDate(real, '2026-09-29');
    expect(shifted.toISOString()).toBe('2026-09-29T02:01:00.000Z'); // 29 Sep, 10:01 in KL
    expect(businessDate(shifted)).toBe('2026-09-29');
  });
});
