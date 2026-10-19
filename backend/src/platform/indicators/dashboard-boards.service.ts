import { Injectable, Logger } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, MaxLength } from 'class-validator';
import { PermissionRegistry } from '../context/permission.registry';
import type { RequestContext } from '../context/request-context';
import { ValidationFailedError } from '../http/errors';
import { PrismaService } from '../prisma/prisma.service';
import { COLUMN_CHOICES, effectiveLayout, layoutErrors, MAX_CARDS, type BoardLayout } from './dashboard.rules';
import { IndicatorRegistry } from './indicator.registry';
import type { IndicatorBoard, IndicatorDef } from './indicator.types';

/** Body of PUT …/dashboard/board: the columns and the charts, in order. */
export class SaveBoardDto {
  @Type(() => Number)
  @IsIn(COLUMN_CHOICES, { message: 'Pick 2 or 3 columns.' })
  cols!: 2 | 3;

  @IsArray()
  @ArrayMaxSize(MAX_CARDS, { message: `A dashboard holds at most ${MAX_CARDS} charts. Remove one first.` })
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  cards!: string[];
}

const FAILED = 'This chart could not be loaded. Try again in a moment.';

/**
 * A person's home dashboard for one module (SRS RPT-035 to RPT-039): the layout they saved (or the module's
 * default), each card calculated by its module inside the person's request, and the charts they could add. A layout
 * is a personal preference, so saving it writes no activity line and no event.
 */
@Injectable()
export class DashboardBoardsService {
  private readonly logger = new Logger(DashboardBoardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: IndicatorRegistry,
    private readonly permissions: PermissionRegistry,
  ) {}

  /** The indicators of a board this person may see (RPT-036). */
  private allowed(ctx: RequestContext, board: IndicatorBoard): IndicatorDef[] {
    return board.indicators.filter((d) => this.permissions.has(ctx.user.roles, d.permission));
  }

  private where(ctx: RequestContext, board: string) {
    return { tenantId_userId_board: { tenantId: ctx.tenantId, userId: ctx.user.id, board } };
  }

  async view(ctx: RequestContext, key: string) {
    const board = this.registry.board(key);
    const allowed = this.allowed(ctx, board);
    const byKey = new Map(allowed.map((d) => [d.key, d]));
    const saved = await this.prisma.sysUserDashboard.findUnique({ where: this.where(ctx, key) });
    const { layout, isDefault } = effectiveLayout(saved, board.defaults, new Set(byKey.keys()));

    // One card failing never takes the others down.
    const cards = await Promise.all(
      layout.cards.map(async (k) => {
        const d = byKey.get(k)!;
        const meta = { key: d.key, title: d.title, kind: d.kind, wide: Boolean(d.wide), link: d.link ?? null, empty: d.empty };
        try {
          return { ...meta, ...(await d.compute(ctx)), failed: null };
        } catch (err) {
          this.logger.error(`Indicator ${d.key} failed`, err instanceof Error ? err.stack : String(err));
          return { ...meta, data: null, failed: FAILED };
        }
      }),
    );

    return {
      board: key,
      cols: layout.cols,
      isDefault,
      cards,
      catalogue: allowed.map((d) => ({ key: d.key, title: d.title, description: d.description, kind: d.kind, onBoard: layout.cards.includes(d.key) })),
      maxCards: MAX_CARDS,
    };
  }

  async save(ctx: RequestContext, key: string, layout: BoardLayout) {
    const board = this.registry.board(key);
    const errors = layoutErrors(layout, new Set(this.allowed(ctx, board).map((d) => d.key)));
    if (errors.length) throw new ValidationFailedError(errors);
    await this.prisma.sysUserDashboard.upsert({
      where: this.where(ctx, key),
      create: { tenantId: ctx.tenantId, userId: ctx.user.id, board: key, cols: layout.cols, cards: layout.cards },
      update: { cols: layout.cols, cards: layout.cards },
    });
    return this.view(ctx, key);
  }

  /** Back to the module's default charts and columns. */
  async reset(ctx: RequestContext, key: string) {
    this.registry.board(key);
    await this.prisma.sysUserDashboard.deleteMany({ where: { tenantId: ctx.tenantId, userId: ctx.user.id, board: key } });
    return this.view(ctx, key);
  }
}
