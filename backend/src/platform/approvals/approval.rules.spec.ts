import {
  applyDecision,
  cancelSteps,
  checkDecision,
  initialSteps,
  isApproverFor,
  type RequestState,
  type StepState,
} from './approval.rules';

const buyer = { code: 'LMY', roles: ['PURCHASE_BUYER', 'AP_CLERK'] };
const manager = { code: 'AZ', roles: ['PURCHASE_MANAGER'] };
const finance = { code: 'RI', roles: ['FINANCE_DIRECTOR'] };
const store = { code: 'RAH', roles: ['STORE', 'REQUESTER'] };

/** PO-0003 style: Purchasing Manager, then Finance Director (over RM 50,000). */
function twoStepRequest(overrides: Partial<RequestState> = {}): RequestState {
  const steps = initialSteps([
    { approverRole: 'PURCHASE_MANAGER', approverCode: 'AZ', approverName: 'Ahmad Zaki' },
    { approverRole: 'FINANCE_DIRECTOR' },
  ]);
  if (!steps.ok) throw new Error('setup');
  return { status: 'PENDING', currentStep: 1, requestedByCode: 'LMY', steps: steps.value, ...overrides };
}

describe('initialSteps', () => {
  it('puts the first step in the inbox and queues the rest', () => {
    const r = twoStepRequest();
    expect(r.steps.map((s) => [s.stepNo, s.status])).toEqual([
      [1, 'WAITING'],
      [2, 'QUEUED'],
    ]);
  });

  it('needs at least one approver', () => {
    expect(initialSteps([])).toMatchObject({ ok: false, code: 'APPROVAL_NO_STEPS' });
  });
});

describe('checkDecision', () => {
  it('lets the named approver approve', () => {
    expect(checkDecision(twoStepRequest(), manager, 'APPROVE', null)).toMatchObject({ ok: true });
  });

  it('never lets the requester approve their own document', () => {
    const r = twoStepRequest({ requestedByCode: 'AZ' });
    expect(checkDecision(r, manager, 'APPROVE', null)).toMatchObject({ ok: false, code: 'APPROVAL_SELF' });
  });

  it('blocks a buyer approving their own PO even if they also held the approver role', () => {
    const buyerManager = { code: 'LMY', roles: ['PURCHASE_BUYER', 'PURCHASE_MANAGER'] };
    const r = twoStepRequest();
    r.steps[0]!.approverCode = null;
    expect(checkDecision(r, buyerManager, 'APPROVE', null)).toMatchObject({ ok: false, code: 'APPROVAL_SELF' });
  });

  it('refuses someone who is not the approver, naming who it waits for', () => {
    const result = checkDecision(twoStepRequest(), store, 'APPROVE', null);
    expect(result).toEqual({
      ok: false,
      code: 'APPROVAL_NOT_YOURS',
      message: 'This step is waiting for Ahmad Zaki.',
    });
  });

  it('refuses the second approver before the first has approved', () => {
    expect(checkDecision(twoStepRequest(), finance, 'APPROVE', null)).toMatchObject({
      ok: false,
      code: 'APPROVAL_NOT_YOURS',
    });
  });

  it('matches by role when the step names no person', () => {
    const r = twoStepRequest({ currentStep: 2 });
    r.steps[0]!.status = 'APPROVED';
    r.steps[1]!.status = 'WAITING';
    expect(checkDecision(r, finance, 'APPROVE', null)).toMatchObject({ ok: true });
  });

  it('requires a comment to reject', () => {
    expect(checkDecision(twoStepRequest(), manager, 'REJECT', '  ')).toMatchObject({
      ok: false,
      code: 'APPROVAL_COMMENT_REQUIRED',
    });
    expect(checkDecision(twoStepRequest(), manager, 'REJECT', 'Too expensive')).toMatchObject({ ok: true });
  });

  it('refuses a decision on a request that is already finished', () => {
    const r = twoStepRequest({ status: 'APPROVED' });
    expect(checkDecision(r, manager, 'APPROVE', null)).toMatchObject({ ok: false, code: 'APPROVAL_CLOSED' });
  });
});

describe('applyDecision', () => {
  const step1 = (r: RequestState): StepState => r.steps[0]!;

  it('moves to the next approver after the first approval', () => {
    const r = twoStepRequest();
    expect(applyDecision(r, step1(r), 'APPROVE')).toEqual({
      outcome: 'NEXT_STEP',
      requestStatus: 'PENDING',
      currentStep: 2,
      stepChanges: [
        { stepNo: 1, status: 'APPROVED' },
        { stepNo: 2, status: 'WAITING' },
      ],
    });
  });

  it('finishes as APPROVED after the last approval', () => {
    const r = twoStepRequest({ currentStep: 2 });
    r.steps[0]!.status = 'APPROVED';
    r.steps[1]!.status = 'WAITING';
    expect(applyDecision(r, r.steps[1]!, 'APPROVE')).toMatchObject({
      outcome: 'APPROVED',
      requestStatus: 'APPROVED',
      stepChanges: [{ stepNo: 2, status: 'APPROVED' }],
    });
  });

  it('a rejection finishes the request and skips later steps', () => {
    const r = twoStepRequest();
    expect(applyDecision(r, step1(r), 'REJECT')).toEqual({
      outcome: 'REJECTED',
      requestStatus: 'REJECTED',
      currentStep: 1,
      stepChanges: [
        { stepNo: 1, status: 'REJECTED' },
        { stepNo: 2, status: 'SKIPPED' },
      ],
    });
  });
});

describe('isApproverFor / cancelSteps', () => {
  it('a named step only matches that person', () => {
    const r = twoStepRequest();
    expect(isApproverFor(r.steps[0]!, manager)).toBe(true);
    expect(isApproverFor(r.steps[0]!, { code: 'XX', roles: ['PURCHASE_MANAGER'] })).toBe(false);
    expect(isApproverFor(r.steps[1]!, buyer)).toBe(false);
  });

  it('cancelling skips every open step', () => {
    expect(cancelSteps(twoStepRequest())).toEqual([
      { stepNo: 1, status: 'SKIPPED' },
      { stepNo: 2, status: 'SKIPPED' },
    ]);
  });
});
