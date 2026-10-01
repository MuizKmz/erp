/**
 * The one way the frontend talks to the API.
 * - Base URL from VITE_API_URL
 * - Sends the dev user (x-dev-user) until login exists
 * - Turns error responses into ApiError and shows them as a toast (unless `silent`)
 */

export interface FieldError {
  field: string
  message: string
}

export interface ApiErrorBody {
  code?: string
  message: string
  errors?: FieldError[]
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message)
    this.name = 'ApiError'
  }

  get code(): string | undefined {
    return this.body.code
  }

  /** Validation errors by field path ("lines[0].qty"), for showing next to inputs. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.body.errors ?? []).map((e) => [e.field, e.message]))
  }
}

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
  /** Do not show a toast; the caller handles the error. */
  silent?: boolean
  signal?: AbortSignal
}

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '')

let devUserCode = ''
let errorListener: ((error: ApiError) => void) | null = null

/** Set by the session when the dev user changes. */
export function setDevUser(code: string): void {
  devUserCode = code
}

/** App.vue registers the toast here. */
export function onApiError(listener: (error: ApiError) => void): void {
  errorListener = listener
}

function buildUrl(path: string, query?: Query): string {
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function readError(response: Response): Promise<ApiErrorBody> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as Partial<ApiErrorBody>
    return { code: parsed.code, message: parsed.message ?? response.statusText, errors: parsed.errors }
  } catch {
    return { message: text || response.statusText || 'Request failed.' }
  }
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (devUserCode) headers['x-dev-user'] = devUserCode

  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    const error = new ApiError(0, { code: 'NETWORK', message: 'Cannot reach the server. Is the API running on port 3000?' })
    if (!options.silent) errorListener?.(error)
    throw error
  }

  if (!response.ok) {
    const error = new ApiError(response.status, await readError(response))
    if (!options.silent) errorListener?.(error)
    throw error
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
