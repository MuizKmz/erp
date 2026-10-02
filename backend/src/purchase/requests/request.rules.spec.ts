import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { allowedRequestActions, groupLinesBySupplier, submitProblems, summarizeLines } from './request.rules';

const requester = (p: string) => [P.REQUEST_CREATE].includes(p as never);
const buyer = (p: string) => [P.REQUEST_CREATE, P.REQUEST_PROCESS].includes(p as never);

describe('allowedRequestActions', () => {
  it('the requester edits, deletes and submits their own draft', () => {
    expect(allowedRequestActions({ status: 'DRAFT', isMigrated: false, isRequester: true, can: requester })).toEqual(['edit', 'delete', 'submit']);
  });

  it('nobody else touches someone else’s draft', () => {
    expect(allowedRequestActions({ status: 'DRAFT', isMigrated: false, isRequester: false, can: buyer })).toEqual([]);
  });

  it('a submitted request: the buyer rejects or converts, the requester waits', () => {
    expect(allowedRequestActions({ status: 'SUBMITTED', isMigrated: false, isRequester: false, can: buyer })).toEqual(['reject', 'toPo', 'toRfq']);
    expect(allowedRequestActions({ status: 'SUBMITTED', isMigrated: false, isRequester: true, can: requester })).toEqual([]);
  });

  it('converted, rejected and migrated requests are closed', () => {
    expect(allowedRequestActions({ status: 'CONVERTED', isMigrated: false, isRequester: false, can: buyer })).toEqual([]);
    expect(allowedRequestActions({ status: 'REJECTED', isMigrated: false, isRequester: true, can: buyer })).toEqual([]);
    expect(allowedRequestActions({ status: 'SUBMITTED', isMigrated: true, isRequester: false, can: buyer })).toEqual([]);
  });
});

describe('submitProblems', () => {
  const ok = { neededBy: '2026-10-10', reason: 'Below reorder level', lineCount: 2, today: '2026-09-29' };

  it('accepts a complete request', () => {
    expect(submitProblems(ok)).toEqual([]);
  });

  it('needs a needed-by date and a reason (FlowP1 step 2)', () => {
    expect(submitProblems({ ...ok, neededBy: null, reason: '  ' }).map((p) => p.field)).toEqual(['neededBy', 'reason']);
  });

  it('refuses a date in the past and an empty request', () => {
    expect(submitProblems({ ...ok, neededBy: '2026-09-28', lineCount: 0 }).map((p) => p.field)).toEqual(['neededBy', 'lines']);
  });
});

describe('summarizeLines', () => {
  it('PRQ-0006: "Wood screw 4 × 40 mm ×20, lacquer ×8"', () => {
    expect(
      summarizeLines([
        { itemName: 'Wood screw 4 × 40 mm, box of 200', qty: '20.0000' },
        { itemName: 'Lacquer, 5 L', qty: '8' },
      ]),
    ).toBe('Wood screw 4 × 40 mm ×20, lacquer ×8');
  });

  it('shortens long requests', () => {
    const lines = ['A', 'B', 'C', 'D', 'E'].map((n) => ({ itemName: n, qty: 1 }));
    expect(summarizeLines(lines)).toBe('A ×1, b ×1, c ×1 and 2 more');
  });
});

describe('groupLinesBySupplier', () => {
  it('PRQ-0006 becomes two POs: Hardware Mart and Cat Warna', () => {
    const lines = [
      { lineNo: 1, item: 'SC-WOD-08', supplier: 'S-0009' },
      { lineNo: 2, item: 'VR-LAC-01', supplier: 'S-0015' },
    ];
    const { groups, missing } = groupLinesBySupplier(lines, (l) => l.supplier);
    expect([...groups.keys()]).toEqual(['S-0009', 'S-0015']);
    expect(missing).toEqual([]);
  });

  it('reports lines without a supplier', () => {
    const { missing } = groupLinesBySupplier([{ lineNo: 1 }, { lineNo: 2 }], (l) => (l.lineNo === 1 ? 'S-0009' : null));
    expect(missing).toEqual([2]);
  });
});
