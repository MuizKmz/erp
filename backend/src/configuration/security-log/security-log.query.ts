import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { RequestContext } from '../../platform/context/request-context';
import { toListResponse } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { csvCell, kindLabel, periodStart, PERIODS, SECURITY_KINDS, securityDetail, type Period } from './security-log.rules';

export class SecurityLogQueryDto {
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

  /** Person or detail. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  kind?: string;

  /** Whose account (user code). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  user?: string;

  @IsOptional()
  @IsIn([...Object.keys(PERIODS), 'all'], { message: 'Pick a period from the list.' })
  period?: Period;
}

type EventRow = Prisma.SysSecurityEventGetPayload<object>;

/** A12 · Security log: newest first, real times (sign-in timing never uses the demo's business date, choice 21). */
@Injectable()
export class SecurityLogQuery {
  constructor(private readonly prisma: PrismaService) {}

  private where(ctx: RequestContext, q: SecurityLogQueryDto): Prisma.SysSecurityEventWhereInput {
    const since = periodStart(q.period, new Date());
    const text = q.q?.trim();
    return {
      tenantId: ctx.tenantId,
      ...(since && { createdAt: { gte: since } }),
      ...(q.kind && { kind: q.kind }),
      ...(q.user && { userCode: q.user }),
      ...(text && { OR: [{ userName: { contains: text } }, { userCode: { contains: text } }, { message: { contains: text } }, { ipAddress: { contains: text } }] }),
    };
  }

  private row(e: EventRow, names: ReadonlyMap<string, string>) {
    const { label, group } = kindLabel(e.kind);
    const data = (e.data ?? {}) as { branchCode?: unknown };
    return {
      id: e.id,
      at: e.createdAt.toISOString(),
      kind: e.kind,
      label,
      group,
      userCode: e.userCode,
      // Whose account it is about; a change about no account (sign-in settings) shows who made it.
      who: e.userName ?? e.userCode ?? (e.actorCode ? (names.get(e.actorCode) ?? e.actorCode) : '—'),
      /** An administrator who acted on someone else's account. */
      by: e.userCode && e.actorCode && e.actorCode !== e.userCode ? (names.get(e.actorCode) ?? e.actorCode) : null,
      detail: securityDetail(e.message, e.ipAddress),
      branchCode: typeof data.branchCode === 'string' ? data.branchCode : null,
    };
  }

  private async names(tenantId: string) {
    const users = await this.prisma.sysUser.findMany({ where: { tenantId }, select: { code: true, name: true }, orderBy: { name: 'asc' } });
    return { users, names: new Map(users.map((u) => [u.code, u.name])) };
  }

  async list(ctx: RequestContext, q: SecurityLogQueryDto) {
    const where = this.where(ctx, q);
    const [total, rows, { users, names }] = await Promise.all([
      this.prisma.sysSecurityEvent.count({ where }),
      this.prisma.sysSecurityEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.names(ctx.tenantId),
    ]);
    return {
      ...toListResponse(rows.map((e) => this.row(e, names)), total, q, { all: total }),
      filters: { kinds: Object.entries(SECURITY_KINDS).map(([kind, k]) => ({ kind, label: k.label })), people: users },
    };
  }

  /** Every matching row as CSV (UTF-8 with a BOM, so Excel shows names right). */
  async exportCsv(ctx: RequestContext, q: SecurityLogQueryDto): Promise<string> {
    const [rows, { names }] = await Promise.all([this.prisma.sysSecurityEvent.findMany({ where: this.where(ctx, q), orderBy: { createdAt: 'desc' }, take: 50_000 }), this.names(ctx.tenantId)]);
    const lines = [['When', 'Event', 'Who', 'By', 'Detail', 'Branch'].map(csvCell).join(',')];
    for (const e of rows.map((r) => this.row(r, names))) lines.push([e.at, e.label, e.who, e.by, e.detail, e.branchCode].map(csvCell).join(','));
    return '﻿' + lines.join('\r\n');
  }
}
