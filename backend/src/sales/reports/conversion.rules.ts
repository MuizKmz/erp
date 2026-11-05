import { dec, type DecimalInput } from '../../platform/http/decimal';
import { isExpired } from '../quotations/quotation.rules';

/** Quotation conversion (S05): how the quotations sent in a month ended up. Pure. */

export type QuoteOutcome = 'WON' | 'OPEN' | 'EXPIRED' | 'LOST';

export const OUTCOMES: { key: QuoteOutcome; label: string }[] = [
  { key: 'WON', label: 'Turned into order' },
  { key: 'OPEN', label: 'Still open' },
  { key: 'EXPIRED', label: 'Expired' },
  { key: 'LOST', label: 'Lost' },
];

export const outcomeLabel = (key: QuoteOutcome) => OUTCOMES.find((o) => o.key === key)!.label;

/**
 * How a quotation stands, read from its latest revision: turned into an order, lost, expired or still open. A first
 * draft, or one waiting for discount approval, was never sent and does not count (null). A later revision being
 * drafted still counts as open, because an earlier revision was sent.
 */
export function quoteOutcome(q: { status: string; revision: number; validUntil: string | null }, today: string): QuoteOutcome | null {
  if (q.status === 'ORDERED') return 'WON';
  if (q.status === 'LOST') return 'LOST';
  if (q.status === 'SUPERSEDED') return null;
  if (q.status === 'RELEASED') return isExpired(q.status, q.validUntil, today) ? 'EXPIRED' : 'OPEN';
  return q.revision > 0 ? 'OPEN' : null;
}

/** Whole days from one date to a later one: 18 Sep → 21 Sep is 3. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface ConversionQuote {
  agentCode: string;
  agentName: string;
  total: DecimalInput;
  outcome: QuoteOutcome;
  lostReason: string | null;
  /** Quotation date to sales order date, for a quotation turned into an order. */
  daysToOrder: number | null;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * The conversion of a set of sent quotations: per outcome, the rate (turned into an order ÷ sent, by count and by
 * value), per sales agent, the reasons for losing, and the average days from quotation to order.
 */
export function conversion(quotes: ConversionQuote[]) {
  const amountOf = (qs: ConversionQuote[]) => qs.reduce((s, q) => s.add(dec(q.total)), dec(0));
  const sentAmount = amountOf(quotes);
  const won = quotes.filter((q) => q.outcome === 'WON');
  const wonAmount = amountOf(won);

  const agents = new Map<string, { agentCode: string; agentName: string; quotes: ConversionQuote[] }>();
  for (const q of quotes) {
    const a = agents.get(q.agentCode) ?? { agentCode: q.agentCode, agentName: q.agentName, quotes: [] };
    a.quotes.push(q);
    agents.set(q.agentCode, a);
  }
  const reasons = new Map<string, ConversionQuote[]>();
  for (const q of quotes.filter((x) => x.outcome === 'LOST')) {
    const reason = q.lostReason?.trim() || 'No reason given';
    reasons.set(reason, [...(reasons.get(reason) ?? []), q]);
  }
  const days = won.map((q) => q.daysToOrder).filter((d): d is number => d !== null);

  return {
    sent: { count: quotes.length, amount: sentAmount },
    outcomes: OUTCOMES.map((o) => {
      const these = quotes.filter((q) => q.outcome === o.key);
      return { key: o.key, label: o.label, count: these.length, amount: amountOf(these) };
    }),
    wonPct: pct(won.length, quotes.length),
    wonValuePct: sentAmount.gt(0) ? Math.round(wonAmount.div(sentAmount).mul(100).toNumber()) : 0,
    avgDaysToOrder: days.length ? (days.reduce((s, d) => s + d, 0) / days.length).toFixed(1) : null,
    agents: [...agents.values()]
      .map((a) => {
        const count = (o: QuoteOutcome) => a.quotes.filter((q) => q.outcome === o).length;
        return {
          agentCode: a.agentCode, agentName: a.agentName, sent: a.quotes.length, won: count('WON'), open: count('OPEN'), expired: count('EXPIRED'), lost: count('LOST'),
          wonAmount: amountOf(a.quotes.filter((q) => q.outcome === 'WON')), pct: pct(count('WON'), a.quotes.length),
        };
      })
      .sort((x, y) => y.pct - x.pct || y.sent - x.sent || x.agentName.localeCompare(y.agentName)),
    reasons: [...reasons]
      .map(([reason, qs]) => ({ reason, count: qs.length, amount: amountOf(qs) }))
      .sort((x, y) => y.count - x.count || y.amount.comparedTo(x.amount) || x.reason.localeCompare(y.reason)),
  };
}
