/**
 * The one way the frontend talks to the API.
 * - Base URL from VITE_API_URL
 * - Sign-in mode (AUTH_MODE=jwt): sends the access token, refreshes it once when it runs out (the refresh token is an
 *   httpOnly cookie), and reports a lost sign-in so the app opens the sign-in page
 * - Dev mode: sends the dev user (x-dev-user) and branch (x-branch)
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
let devBranchCode = ''
let accessToken: string | null = null
let errorListener: ((error: ApiError) => void) | null = null
let signedOutListener: ((message: string) => void) | null = null
let refreshing: Promise<boolean> | null = null

/** Set by the session when the dev user changes. */
export function setDevUser(code: string): void {
  devUserCode = code
}

/** Dev mode: the branch to work in (x-branch); empty = the user's default branch. */
export function setDevBranch(code: string): void {
  devBranchCode = code
}

/** Sign-in mode: the access token, kept in memory only (never in localStorage). */
export function setAccessToken(token: string | null): void {
  accessToken = token
}

/** The session registers here: a sign-in that cannot be refreshed any more sends the user to the sign-in page. */
export function onSignedOut(listener: (message: string) => void): void {
  signedOutListener = listener
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

/** Who is asking: the access token in sign-in mode, the dev user and branch in dev mode. */
function authHeaders(): Record<string, string> {
  if (accessToken) return { Authorization: `Bearer ${accessToken}` }
  return { ...(devUserCode && { 'x-dev-user': devUserCode }), ...(devBranchCode && { 'x-branch': devBranchCode }) }
}

/** One refresh at a time, shared by every request that found its token run out. */
export function refreshAccess(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const response = await fetch(buildUrl('/auth/refresh'), { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) return false
      accessToken = ((await response.json()) as { accessToken: string }).accessToken
      return true
    } catch {
      return false
    } finally {
      setTimeout(() => (refreshing = null), 0)
    }
  })()
  return refreshing
}

const AUTH_PATHS = ['/auth/sign-in', '/auth/refresh', '/auth/sign-out', '/auth/mode', '/auth/two-factor', '/auth/two-factor/setup', '/auth/forgot', '/auth/link', '/auth/reset']

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const isForm = options.body instanceof FormData
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json'

  const send = () =>
    fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers: { ...headers, ...authHeaders() },
      body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'include',
    })

  let response: Response
  try {
    response = await send()
    // Sign-in mode: the access token runs out after 15 minutes; refresh once and try again.
    if (response.status === 401 && accessToken && !AUTH_PATHS.includes(path)) {
      const body = await readError(response.clone())
      if (body.code === 'TOKEN_EXPIRED' && (await refreshAccess())) response = await send()
      if (response.status === 401) {
        const lost = await readError(response.clone())
        accessToken = null
        signedOutListener?.(lost.message)
      }
    }
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

/**
 * Opens a stored file (e.g. a supplier's quote PDF) in a new tab. Fetched with the access token (or the dev user),
 * since a plain link cannot send it.
 */
export async function openFile(path: string): Promise<void> {
  const tab = window.open('', '_blank')
  let response = await fetch(buildUrl(path), { headers: authHeaders(), credentials: 'include' })
  if (response.status === 401 && accessToken && (await refreshAccess())) response = await fetch(buildUrl(path), { headers: authHeaders(), credentials: 'include' })
  if (!response.ok) {
    tab?.close()
    const error = new ApiError(response.status, await readError(response))
    errorListener?.(error)
    throw error
  }
  const url = URL.createObjectURL(await response.blob())
  if (tab) tab.location.href = url
  else window.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
