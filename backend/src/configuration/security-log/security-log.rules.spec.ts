import { SECURITY_EVENT } from '../configuration.constants';
import { csvCell, kindLabel, periodStart, SECURITY_KINDS, securityDetail } from './security-log.rules';

describe('security log rules (A12)', () => {
  it('names every kind of security event the application writes', () => {
    expect(Object.keys(SECURITY_KINDS).sort()).toEqual(Object.values(SECURITY_EVENT).sort());
    expect(kindLabel('SIGNED_IN')).toEqual({ label: 'Signed in', group: 'done' });
    expect(kindLabel('LOCKED_OUT')).toEqual({ label: 'Account locked', group: 'cancelled' });
    expect(kindLabel('SOMETHING_NEW')).toEqual({ label: 'SOMETHING_NEW', group: 'draft' });
  });

  it('starts the period 7 days back by default, and not at all for "all"', () => {
    const now = new Date('2026-10-16T08:00:00Z');
    expect(periodStart(undefined, now)).toEqual(new Date('2026-10-09T08:00:00Z'));
    expect(periodStart('day', now)).toEqual(new Date('2026-10-15T08:00:00Z'));
    expect(periodStart('all', now)).toBeNull();
  });

  it('adds where it came from, without the IPv6 wrapper', () => {
    expect(securityDetail('Lim Mei Ying signed in on Chrome on Windows', '::ffff:10.0.4.21')).toBe('Lim Mei Ying signed in on Chrome on Windows · 10.0.4.21');
    expect(securityDetail('Admin changed a role', null)).toBe('Admin changed a role');
  });

  it('quotes CSV cells so commas and quotes survive', () => {
    expect(csvCell('Roles of "Aina", changed')).toBe('"Roles of ""Aina"", changed"');
    expect(csvCell(null)).toBe('""');
  });
});
