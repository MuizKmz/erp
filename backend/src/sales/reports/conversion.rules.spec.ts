import { conversion, daysBetween, quoteOutcome, type ConversionQuote } from './conversion.rules';

const today = '2026-09-29';

describe('quotation conversion (S05)', () => {
  it('reads how a quotation stands from its latest revision', () => {
    expect(quoteOutcome({ status: 'ORDERED', revision: 0, validUntil: '2026-10-02' }, today)).toBe('WON');
    expect(quoteOutcome({ status: 'LOST', revision: 0, validUntil: '2026-09-19' }, today)).toBe('LOST');
    expect(quoteOutcome({ status: 'RELEASED', revision: 0, validUntil: '2026-10-02' }, today)).toBe('OPEN'); // QT-0004
    expect(quoteOutcome({ status: 'RELEASED', revision: 0, validUntil: '2026-09-24' }, today)).toBe('EXPIRED'); // QT-0005
    expect(quoteOutcome({ status: 'RELEASED', revision: 1, validUntil: '2026-10-09' }, today)).toBe('OPEN'); // QT-0010 rev 1
  });

  it('leaves out what was never sent, but counts a revision being drafted as still open', () => {
    expect(quoteOutcome({ status: 'DRAFT', revision: 0, validUntil: null }, today)).toBeNull(); // QT-0012
    expect(quoteOutcome({ status: 'PENDING_APPROVAL', revision: 0, validUntil: '2026-10-09' }, today)).toBeNull();
    expect(quoteOutcome({ status: 'SUPERSEDED', revision: 0, validUntil: '2026-10-06' }, today)).toBeNull();
    expect(quoteOutcome({ status: 'DRAFT', revision: 2, validUntil: null }, today)).toBe('OPEN');
  });

  it('counts days from quotation to order', () => {
    expect(daysBetween('2026-09-24', '2026-09-27')).toBe(3); // QT-0008 → SO-0003
    expect(daysBetween('2026-09-18', '2026-09-18')).toBe(0); // QT-0001 → SO-0001
  });

  it('works out September: 10 sent, 5 turned into orders, by agent and by reason', () => {
    const q = (agentCode: string, agentName: string, total: string, outcome: ConversionQuote['outcome'], extra: Partial<ConversionQuote> = {}): ConversionQuote => ({
      agentCode, agentName, total, outcome, lostReason: null, daysToOrder: null, ...extra,
    });
    const sent = [
      q('AR', 'Aina Rahman', '27500.00', 'WON', { daysToOrder: 0 }), // QT-0001
      q('FO', 'Faizal Omar', '13090.00', 'WON', { daysToOrder: 1 }), // QT-0003
      q('FO', 'Faizal Omar', '3300.00', 'OPEN'), // QT-0004
      q('FO', 'Faizal Omar', '8580.00', 'EXPIRED'), // QT-0005
      q('AR', 'Aina Rahman', '70400.00', 'WON', { daysToOrder: 3 }), // QT-0008
      q('FO', 'Faizal Omar', '4400.00', 'WON', { daysToOrder: 7 }), // QT-0009
      q('FO', 'Faizal Omar', '12540.00', 'OPEN'), // QT-0010 rev 1
      q('AR', 'Aina Rahman', '36960.00', 'WON', { daysToOrder: 0 }), // QT-0011
      q('FO', 'Faizal Omar', '5610.00', 'LOST', { lostReason: 'Customer chose a cheaper supplier' }), // QT-L-0099
      q('LWJ', 'Lim Wei Jie', '14575.00', 'LOST', { lostReason: 'Price too high' }), // QT-L-0101
    ];
    const r = conversion(sent);
    expect([r.sent.count, r.sent.amount.toFixed(2), r.wonPct, r.wonValuePct, r.avgDaysToOrder]).toEqual([10, '196955.00', 50, 77, '2.2']);
    expect(r.outcomes.map((o) => `${o.label} ${o.count} ${o.amount.toFixed(2)}`)).toEqual([
      'Turned into order 5 152350.00',
      'Still open 2 15840.00',
      'Expired 1 8580.00',
      'Lost 2 20185.00',
    ]);
    expect(r.agents.map((a) => `${a.agentName} ${a.won}/${a.sent} ${a.pct}% ${a.wonAmount.toFixed(2)}`)).toEqual([
      'Aina Rahman 3/3 100% 134860.00',
      'Faizal Omar 2/6 33% 17490.00',
      'Lim Wei Jie 0/1 0% 0.00',
    ]);
    expect(r.reasons.map((x) => `${x.reason} ${x.count}`)).toEqual(['Price too high 1', 'Customer chose a cheaper supplier 1']);
  });

  it('has nothing to average when nothing turned into an order', () => {
    expect(conversion([]).avgDaysToOrder).toBeNull();
    expect(conversion([]).wonPct).toBe(0);
  });
});
