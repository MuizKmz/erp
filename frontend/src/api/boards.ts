import { api } from './http'

/** Home dashboards (SRS RPT-035 to RPT-039): a person's charts on a module home. Same shape for every module. */

export type IndicatorKind = 'table' | 'list' | 'bars' | 'columns'
export type IndicatorUnit = 'money' | 'count' | 'qty'
export type ChipGroup = 'draft' | 'pending' | 'released' | 'partial' | 'done' | 'cancelled'

export interface IndicatorChip {
  status: string
  label?: string
  group?: ChipGroup
}

export interface TableCell {
  text?: string
  to?: string
  strong?: boolean
  money?: string
  progress?: { done: string; of: string }
  chip?: IndicatorChip
}

export type IndicatorData =
  | { kind: 'table'; columns: { key: string; label: string; num?: boolean }[]; rows: { id: string; cells: Record<string, TableCell> }[] }
  | { kind: 'list'; items: { id: string; title: string; sub?: string; aside?: string; chip?: IndicatorChip; to?: string }[] }
  | {
      kind: 'bars'
      unit: IndicatorUnit
      rows: { key: string; label: string; value: string; sub?: string; tone?: 'primary' | 'muted' | 'warning' | 'danger'; to?: string }[]
    }
  | { kind: 'columns'; unit: IndicatorUnit; points: { month: string; value: string }[] }

export interface BoardCard {
  key: string
  title: string
  kind: IndicatorKind
  /** A table that takes the height of two cards */
  wide: boolean
  link: { label: string; to: string } | null
  empty: string
  /** "2026-09", shown after the title */
  month?: string
  note?: string
  data: IndicatorData | null
  /** Set when this one card could not be calculated; the others still show. */
  failed: string | null
}

export interface Board {
  board: string
  cols: 2 | 3
  /** No saved layout: the module's default charts */
  isDefault: boolean
  cards: BoardCard[]
  catalogue: { key: string; title: string; description: string; kind: IndicatorKind; onBoard: boolean }[]
  maxCards: number
}

/** The board API of one module home: "/sales/dashboard/board". */
export function boardsApi(path: string) {
  return {
    get: () => api<Board>(path),
    save: (cols: 2 | 3, cards: string[]) => api<Board>(path, { method: 'PUT', body: { cols, cards } }),
    reset: () => api<Board>(path, { method: 'DELETE' }),
  }
}
