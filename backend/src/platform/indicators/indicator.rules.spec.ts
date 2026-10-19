import { agingBucket, lastMonths, monthOf } from './indicator.rules';

describe('indicator reporting conventions (RPT-037)', () => {
  it('lists the last months up to today, across a year end', () => {
    expect(lastMonths('2026-09-29', 6)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(lastMonths('2026-02-10', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(monthOf(new Date('2026-09-15T00:00:00.000Z'))).toBe('2026-09');
  });

  it('puts a balance in its aging bucket by days past the due date', () => {
    const today = '2026-09-29';
    expect(agingBucket(null, today)).toBe('current');
    expect(agingBucket('2026-10-26', today)).toBe('current');
    expect(agingBucket('2026-09-29', today)).toBe('current'); // due today is not late yet
    expect(agingBucket('2026-09-28', today)).toBe('d30');
    expect(agingBucket('2026-08-30', today)).toBe('d30'); // 30 days
    expect(agingBucket('2026-08-29', today)).toBe('d60'); // 31 days
    expect(agingBucket('2026-07-01', today)).toBe('d90'); // 90 days
    expect(agingBucket('2026-06-30', today)).toBe('over90'); // 91 days
  });
});
