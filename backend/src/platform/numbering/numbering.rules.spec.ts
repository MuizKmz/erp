import { formatDocNo, formatPattern, nextInSequence } from './numbering.rules';

describe('formatDocNo', () => {
  it('pads the running number to the configured digits', () => {
    expect(formatDocNo('PO-', 4, 7)).toBe('PO-0007');
    expect(formatDocNo('PRQ-', 4, 1)).toBe('PRQ-0001');
    expect(formatDocNo('GRN-', 4, 1234)).toBe('GRN-1234');
  });

  it('keeps growing past the padding instead of cutting digits', () => {
    expect(formatDocNo('PO-', 4, 10000)).toBe('PO-10000');
  });

  it('refuses zero, negative and fractional numbers', () => {
    expect(() => formatDocNo('PO-', 4, 0)).toThrow();
    expect(() => formatDocNo('PO-', 4, -1)).toThrow();
    expect(() => formatDocNo('PO-', 4, 1.5)).toThrow();
  });

  it('refuses a digit count outside 1–10', () => {
    expect(() => formatDocNo('PO-', 0, 1)).toThrow();
    expect(() => formatDocNo('PO-', 11, 1)).toThrow();
  });
});

describe('formatPattern', () => {
  it('fills in the month, year, branch and running number', () => {
    expect(formatPattern('EQ-{YYMM}-{####}', 11, '2026-09-29')).toBe('EQ-2609-0011');
    expect(formatPattern('DO-{BR}-{YYYY}-{###}', 4, '2026-10-01', 'PNG')).toBe('DO-PNG-2026-004');
  });
  it('refuses a format without a running number or a missing branch', () => {
    expect(() => formatPattern('EQ-{YYMM}', 1, '2026-09-29')).toThrow();
    expect(() => formatPattern('DO-{BR}-{####}', 1, '2026-09-29')).toThrow();
  });
});

describe('nextInSequence', () => {
  it('never restarts a NEVER sequence (Purchase numbering is unchanged)', () => {
    expect(nextInSequence({ nextValue: 7, resetEvery: 'NEVER', periodKey: null }, '2026-10-01')).toEqual({ value: 7, storeNext: 8, storePeriod: null });
  });
  it('carries on inside the same month and restarts at 1 in a new month', () => {
    expect(nextInSequence({ nextValue: 11, resetEvery: 'MONTH', periodKey: '2609' }, '2026-09-29')).toEqual({ value: 11, storeNext: 12, storePeriod: '2609' });
    expect(nextInSequence({ nextValue: 11, resetEvery: 'MONTH', periodKey: '2609' }, '2026-10-01')).toEqual({ value: 1, storeNext: 2, storePeriod: '2610' });
  });
});
