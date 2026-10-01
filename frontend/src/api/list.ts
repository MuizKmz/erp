/** The shape of every list endpoint (CLAUDE.md → API conventions). */
export interface ListResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  statusCounts: { all: number } & Record<string, number>
}

export type ListQuery = Record<string, string | number | undefined>
