import { Injectable } from '@nestjs/common';
import { Prisma, type SysApprovalRequest, type SysApprovalStep } from '@prisma/client';
import type { CurrentUserInfo, RequestContext } from '../context/request-context';
import { BusinessRuleError, NotFoundError } from '../http/errors';
import { toMoneyOrNull, type DecimalInput } from '../http/decimal';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  applyDecision,
  cancelSteps,
  checkDecision,
  initialSteps,
  type ApprovalDecision,
  type DecisionOutcome,
  type RequestState,
  type StepPlan,
} from './approval.rules';

export interface CreateApprovalInput {
  entityType: string;
  entityId: string;
  docNo: string;
  amount?: DecimalInput | null;
  /** What is being approved, for the inbox: "PO-0003 · Perabot Kayu Timur". */
  title: string;
  /** Why approval is needed: "Over the HQ limit of RM 10,000.00". */
  reason: string;
  requesterNote?: string | null;
  steps: StepPlan[];
}

export interface DecisionResult extends Pick<DecisionOutcome, 'outcome'> {
  requestId: string;
  entityType: string;
  entityId: string;
  docNo: string;
}

export interface ApprovalStepView {
  stepNo: number;
  approverRole: string;
  approverCode: string | null;
  approverName: string | null;
  status: string;
  decidedByCode: string | null;
  decidedByName: string | null;
  comment: string | null;
  decidedAt: string | null;
}

export interface ApprovalRequestView {
  id: string;
  entityType: string;
  entityId: string;
  docNo: string;
  branchCode: string;
  amount: string | null;
  title: string;
  reason: string;
  requesterNote: string | null;
  requestedByCode: string;
  requestedByName: string;
  status: string;
  currentStep: number;
  createdAt: string;
  decidedAt: string | null;
  steps: ApprovalStepView[];
}

type RequestWithSteps = SysApprovalRequest & { steps: SysApprovalStep[] };

function toState(r: RequestWithSteps): RequestState {
  return {
    status: r.status,
    currentStep: r.currentStep,
    requestedByCode: r.requestedByCode,
    steps: r.steps.map((s) => ({
      stepNo: s.stepNo,
      approverRole: s.approverRole,
      approverCode: s.approverCode,
      approverName: s.approverName,
      status: s.status,
    })),
  };
}

function toView(r: RequestWithSteps): ApprovalRequestView {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    docNo: r.docNo,
    branchCode: r.branchCode,
    amount: toMoneyOrNull(r.amount),
    title: r.title,
    reason: r.reason,
    requesterNote: r.requesterNote,
    requestedByCode: r.requestedByCode,
    requestedByName: r.requestedByName,
    status: r.status,
    currentStep: r.currentStep,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    steps: [...r.steps]
      .sort((a, b) => a.stepNo - b.stepNo)
      .map((s) => ({
        stepNo: s.stepNo,
        approverRole: s.approverRole,
        approverCode: s.approverCode,
        approverName: s.approverName,
        status: s.status,
        decidedByCode: s.decidedByCode,
        decidedByName: s.decidedByName,
        comment: s.comment,
        decidedAt: s.decidedAt?.toISOString() ?? null,
      })),
  };
}

/**
 * Generic approval requests. The owning module (e.g. Purchase orders) works out the steps, calls create()
 * when the document is submitted and reacts to decide()'s outcome (release, back to draft …), all inside its
 * own transaction. The module also writes its own activity rows and events.
 */
@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tx: Tx, ctx: RequestContext, input: CreateApprovalInput): Promise<ApprovalRequestView> {
    const steps = initialSteps(input.steps);
    if (!steps.ok) throw new BusinessRuleError(steps.code, steps.message);

    const open = await tx.sysApprovalRequest.findFirst({
      where: { tenantId: ctx.tenantId, entityType: input.entityType, entityId: input.entityId, status: 'PENDING' },
      select: { id: true },
    });
    if (open) {
      throw new BusinessRuleError('APPROVAL_ALREADY_PENDING', `${input.docNo} is already waiting for approval.`);
    }

    const created = await tx.sysApprovalRequest.create({
      data: {
        tenantId: ctx.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        docNo: input.docNo,
        branchCode: ctx.branchCode,
        amount: input.amount == null ? null : new Prisma.Decimal(input.amount),
        title: input.title,
        reason: input.reason,
        requesterNote: input.requesterNote?.trim() || null,
        requestedByCode: ctx.user.code,
        requestedByName: ctx.user.name,
        status: 'PENDING',
        currentStep: 1,
        steps: { create: steps.value.map((s) => ({ ...s, tenantId: ctx.tenantId })) },
      },
      include: { steps: true },
    });
    return toView(created);
  }

  /** Approve or reject the active step. Throws a 409 with a user-facing message when the rules say no. */
  async decide(
    tx: Tx,
    ctx: RequestContext,
    requestId: string,
    decision: ApprovalDecision,
    comment?: string | null,
  ): Promise<DecisionResult> {
    // Lock the request so two approvers clicking at once are handled one after the other.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sys_approval_request WHERE id = ${requestId} AND tenantId = ${ctx.tenantId} FOR UPDATE`;
    if (!locked.length) throw new NotFoundError('Approval');

    const request = await tx.sysApprovalRequest.findUniqueOrThrow({ where: { id: requestId }, include: { steps: true } });
    const state = toState(request);

    const check = checkDecision(state, ctx.user, decision, comment);
    if (!check.ok) throw new BusinessRuleError(check.code, check.message);

    const result = applyDecision(state, check.value, decision);
    const now = new Date();
    for (const change of result.stepChanges) {
      const decided = change.stepNo === check.value.stepNo;
      await tx.sysApprovalStep.update({
        where: { requestId_stepNo: { requestId, stepNo: change.stepNo } },
        data: {
          status: change.status,
          ...(decided && {
            decidedByCode: ctx.user.code,
            decidedByName: ctx.user.name,
            comment: comment?.trim() || null,
            decidedAt: now,
          }),
        },
      });
    }
    await tx.sysApprovalRequest.update({
      where: { id: requestId },
      data: {
        status: result.requestStatus,
        currentStep: result.currentStep,
        decidedAt: result.outcome === 'NEXT_STEP' ? null : now,
      },
    });

    return {
      requestId,
      entityType: request.entityType,
      entityId: request.entityId,
      docNo: request.docNo,
      outcome: result.outcome,
    };
  }

  /** Withdraw the pending request of a document (e.g. it was changed or cancelled). Returns true if one existed. */
  async cancelPending(tx: Tx, ctx: RequestContext, entityType: string, entityId: string): Promise<boolean> {
    const request = await tx.sysApprovalRequest.findFirst({
      where: { tenantId: ctx.tenantId, entityType, entityId, status: 'PENDING' },
      include: { steps: true },
    });
    if (!request) return false;

    for (const change of cancelSteps(toState(request))) {
      await tx.sysApprovalStep.update({
        where: { requestId_stepNo: { requestId: request.id, stepNo: change.stepNo } },
        data: { status: change.status },
      });
    }
    await tx.sysApprovalRequest.update({
      where: { id: request.id },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    return true;
  }

  /** The user's inbox: pending requests whose active step waits for them (never their own documents). */
  async listWaitingFor(tenantId: string, user: Pick<CurrentUserInfo, 'code' | 'roles'>): Promise<ApprovalRequestView[]> {
    const rows = await this.prisma.sysApprovalRequest.findMany({
      where: {
        tenantId,
        status: 'PENDING',
        requestedByCode: { not: user.code },
        steps: {
          some: {
            status: 'WAITING',
            OR: [{ approverCode: user.code }, { approverCode: null, approverRole: { in: user.roles } }],
          },
        },
      },
      include: { steps: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toView);
  }

  /** Approval history of one document, newest first. */
  async listForEntity(tenantId: string, entityType: string, entityId: string): Promise<ApprovalRequestView[]> {
    const rows = await this.prisma.sysApprovalRequest.findMany({
      where: { tenantId, entityType, entityId },
      include: { steps: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  async get(tenantId: string, requestId: string): Promise<ApprovalRequestView> {
    const row = await this.prisma.sysApprovalRequest.findFirst({
      where: { id: requestId, tenantId },
      include: { steps: true },
    });
    if (!row) throw new NotFoundError('Approval');
    return toView(row);
  }
}
