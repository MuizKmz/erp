import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../http/errors';
import type { IndicatorBoard } from './indicator.types';

/**
 * The home dashboards and their indicators. Each module registers its own board at start-up, the way it registers
 * its permissions, scope rules and record-usage provider; the platform serves the layouts.
 */
@Injectable()
export class IndicatorRegistry {
  private readonly boards = new Map<string, IndicatorBoard>();

  register(board: IndicatorBoard): void {
    if (this.boards.has(board.key)) throw new Error(`A dashboard "${board.key}" is already registered`);
    const keys = new Set<string>();
    for (const d of board.indicators) {
      if (keys.has(d.key)) throw new Error(`Indicator ${d.key} is declared twice on dashboard ${board.key}`);
      keys.add(d.key);
    }
    const unknown = board.defaults.cards.filter((k) => !keys.has(k));
    if (unknown.length) throw new Error(`Dashboard ${board.key} starts with unknown indicators: ${unknown.join(', ')}`);
    this.boards.set(board.key, board);
  }

  board(key: string): IndicatorBoard {
    const board = this.boards.get(key);
    if (!board) throw new NotFoundError('Dashboard');
    return board;
  }
}
