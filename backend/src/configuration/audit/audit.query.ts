import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { toListResponse } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { csvCell, periodStart, PERIODS, type Period } from '../security-log/security-log.rules';
import { AUDIT_MODULES, changesOf, moduleOf, prefixOf, shortId, type AuditModule } from './audit.rules';

export class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  /** Record number or text. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(Object.keys(AUDIT_MODULES), { message: 'Pick a module from the list.' })
  module?: AuditModule;

  /** Who made the change (user code). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  user?: string;

  @IsOptional()
  @IsIn([...Object.keys(PERIODS), 'all'], { message: 'Pick a period from the list.' })
  period?: Period;
}

type ActivityRow = Prisma.SysActivityGetPayload<object>;

/**
 * A13 · Audit trail: every change in every module (sys_activity), newest first. Times are the business clock the
 * modules wrote them with. Read only; nothing here changes or deletes a row (rule 9).
 */
@Injectable()
export class AuditQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  private where(ctx: RequestContext, q: AuditQueryDto): Prisma.SysActivityWhereInput {
    const since = periodStart(q.period, this.clock.now());
    const text = q.q?.trim();
    return {
      tenantId: ctx.tenantId,
      ...(since && { createdAt: { gte: since } }),
      ...(q.module && { entityType: { startsWith: prefixOf(q.module) } }),
      ...(q.user && { userCode: q.user }),
      ...(text && { OR: [{ docNo: { contains: text } }, { message: { contains: text } }, { comment: { contains: text } }] }),
    };
  }

  private row(a: ActivityRow) {
    const module = moduleOf(a.entityType);
    return {
      id: a.id,
      at: a.createdAt.toISOString(),
      module,
      moduleLabel: module ? AUDIT_MODULES[module] : a.entityType,
      entityType: a.entityType,
      entityId: a.entityId,
      record: a.docNo ?? '—',
      message: a.message,
      comment: a.comment,
      userCode: a.userCode,
      who: a.userName,
      hasChanges: changesOf(a.data).length > 0,
    };
  }

  async list(ctx: RequestContext, q: AuditQueryDto) {
    const where = this.where(ctx, q);
    const [total, rows, people] = await Promise.all([
      this.prisma.sysActivity.count({ where }),
      this.prisma.sysActivity.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.sysUser.findMany({ where: { tenantId: ctx.tenantId }, select: { code: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      ...toListResponse(rows.map((a) => this.row(a)), total, q, { all: total }),
      filters: { modules: Object.entries(AUDIT_MODULES).map(([key, label]) => ({ key, label })), people },
    };
  }

  /** One change with its before-and-after values, and the other changes the same request made (FR-PLT-016). */
  async detail(ctx: RequestContext, id: string) {
    const a = await this.prisma.sysActivity.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!a) throw new NotFoundError('Change');
    const [sameRequest, user] = await Promise.all([
      a.correlationId
        ? this.prisma.sysActivity.findMany({ where: { tenantId: ctx.tenantId, correlationId: a.correlationId, id: { not: a.id } }, orderBy: { createdAt: 'asc' }, take: 50 })
        : Promise.resolve([]),
      this.prisma.sysUser.findFirst({ where: { tenantId: ctx.tenantId, code: a.userCode }, select: { jobTitle: true } }),
    ]);
    return {
      ...this.row(a),
      changes: changesOf(a.data),
      jobTitle: user?.jobTitle ?? null,
      request: shortId(a.correlationId),
      sameRequest: sameRequest.map((s) => this.row(s)),
    };
  }

  async exportCsv(ctx: RequestContext, q: AuditQueryDto): Promise<string> {
    const rows = await this.prisma.sysActivity.findMany({ where: this.where(ctx, q), orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 50_000 });
    const lines = [['When', 'Module', 'Record', 'What happened', 'Who', 'Before and after'].map(csvCell).join(',')];
    for (const a of rows) {
      const r = this.row(a);
      const changes = changesOf(a.data).map((c) => `${c.label}: ${c.from ?? '(blank)'} → ${c.to ?? '(blank)'}`).join('; ');
      lines.push([r.at, r.moduleLabel, r.record, r.message, r.who, changes].map(csvCell).join(','));
    }
    return '﻿' + lines.join('\r\n');
  }
}
