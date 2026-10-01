/**
 * Generic approval rules, free of any database or framework, so they can be unit tested.
 * The owning module decides WHICH steps a document needs (e.g. PO over the HQ limit → Purchasing Manager);
 * these rules decide WHO may act on a step and WHAT happens after a decision.
 */

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type ApprovalStepStatus = 'QUEUED' | 'WAITING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
export type ApprovalDecision = 'APPROVE' | 'REJECT';

export interface StepState {
  stepNo: number;
  approverRole: string;
  approverCode: string | null;
  approverName: string | null;
  status: ApprovalStepStatus;
}

export interface RequestState {
  status: ApprovalStatus;
  currentStep: number;
  requestedByCode: string;
  steps: StepState[];
}

export interface Decider {
  code: string;
  roles: string[];
}

export interface StepPlan {
  approverRole: string;
  approverCode?: string | null;
  approverName?: string | null;
}

export type RuleResult<T = undefined> = { ok: true; value: T } | { ok: false; code: string; message: string };

const fail = (code: string, message: string) => ({ ok: false as const, code, message });

/** The step sitting in an inbox right now, if any. */
export function activeStep(request: RequestState): StepState | undefined {
  return request.steps.find((s) => s.stepNo === request.currentStep && s.status === 'WAITING');
}

/** Initial statuses for a new request: the first step waits, the rest queue behind it. */
export function initialSteps(plan: StepPlan[]): RuleResult<StepState[]> {
  if (plan.length === 0) return fail('APPROVAL_NO_STEPS', 'An approval request needs at least one approver.');
  return {
    ok: true,
    value: plan.map((p, i) => ({
      stepNo: i + 1,
      approverRole: p.approverRole,
      approverCode: p.approverCode ?? null,
      approverName: p.approverName ?? null,
      status: i === 0 ? 'WAITING' : 'QUEUED',
    })),
  };
}

/** Is this user the one the active step waits for? (Used for the inbox and for showing Approve/Reject.) */
export function isApproverFor(step: StepState, user: Decider): boolean {
  return step.approverCode ? step.approverCode === user.code : user.roles.includes(step.approverRole);
}

/**
 * May this user decide now?
 * - the request must still be pending
 * - nobody approves their own document (the buyer can never approve their own PO)
 * - the user must be the named approver, or hold the step's role
 * - a rejection needs a comment, so the requester knows why
 */
export function checkDecision(
  request: RequestState,
  user: Decider,
  decision: ApprovalDecision,
  comment: string | null | undefined,
): RuleResult<StepState> {
  if (request.status !== 'PENDING') {
    return fail('APPROVAL_CLOSED', 'This approval has already been decided.');
  }
  const step = activeStep(request);
  if (!step) {
    return fail('APPROVAL_CLOSED', 'This approval has no step waiting for a decision.');
  }
  if (request.requestedByCode === user.code) {
    return fail('APPROVAL_SELF', 'You cannot approve or reject your own document.');
  }
  if (!isApproverFor(step, user)) {
    const who = step.approverName ?? step.approverRole;
    return fail('APPROVAL_NOT_YOURS', `This step is waiting for ${who}.`);
  }
  if (decision === 'REJECT' && !comment?.trim()) {
    return fail('APPROVAL_COMMENT_REQUIRED', 'Please add a comment so the requester knows why it was rejected.');
  }
  return { ok: true, value: step };
}

export interface DecisionOutcome {
  /** APPROVED / REJECTED: the request is finished. NEXT_STEP: it moved to the next approver. */
  outcome: 'APPROVED' | 'REJECTED' | 'NEXT_STEP';
  requestStatus: ApprovalStatus;
  currentStep: number;
  /** New status per step number, for every step that changes. */
  stepChanges: { stepNo: number; status: ApprovalStepStatus }[];
}

/** What a (checked) decision does to the request and its steps. */
export function applyDecision(request: RequestState, decidedStep: StepState, decision: ApprovalDecision): DecisionOutcome {
  const later = request.steps.filter((s) => s.stepNo > decidedStep.stepNo).sort((a, b) => a.stepNo - b.stepNo);

  if (decision === 'REJECT') {
    return {
      outcome: 'REJECTED',
      requestStatus: 'REJECTED',
      currentStep: decidedStep.stepNo,
      stepChanges: [
        { stepNo: decidedStep.stepNo, status: 'REJECTED' },
        ...later.map((s) => ({ stepNo: s.stepNo, status: 'SKIPPED' as const })),
      ],
    };
  }

  const next = later[0];
  if (next) {
    return {
      outcome: 'NEXT_STEP',
      requestStatus: 'PENDING',
      currentStep: next.stepNo,
      stepChanges: [
        { stepNo: decidedStep.stepNo, status: 'APPROVED' },
        { stepNo: next.stepNo, status: 'WAITING' },
      ],
    };
  }

  return {
    outcome: 'APPROVED',
    requestStatus: 'APPROVED',
    currentStep: decidedStep.stepNo,
    stepChanges: [{ stepNo: decidedStep.stepNo, status: 'APPROVED' }],
  };
}

/** Withdrawing a request (document changed or cancelled): every open step is skipped. */
export function cancelSteps(request: RequestState): { stepNo: number; status: ApprovalStepStatus }[] {
  return request.steps
    .filter((s) => s.status === 'WAITING' || s.status === 'QUEUED')
    .map((s) => ({ stepNo: s.stepNo, status: 'SKIPPED' as const }));
}
