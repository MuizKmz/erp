import { formatDocNo } from './numbering.rules';

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
