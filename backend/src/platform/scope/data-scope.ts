import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from '../context/request-context';
import type { ScopeFacts } from './scope.rules';

/**
 * Who is asking, for the length of one HTTP request (SDD 10.3.1). The request middleware opens it; the auth guard has
 * put the RequestContext on the request by the time any query runs. Outside a request (outbox listeners, the seed,
 * scheduled work) there is no store, so nothing is scoped: that is the *system*.
 */
interface ScopeStore {
  request?: { context?: RequestContext };
  /** Set by asSystem(): a business rule that must see every row (credit exposure, record usage). */
  system: boolean;
  /** Worked out on the first scoped read of the request. */
  facts?: Promise<ScopeFacts>;
}

const storage = new AsyncLocalStorage<ScopeStore>();

/** Express middleware: one store per request. */
export function scopeMiddleware(req: object, _res: unknown, next: () => void): void {
  storage.run({ request: req as ScopeStore['request'], system: false }, next);
}

/** The signed-in user's context while scoped, or null (system, or before the guard has run). */
export function scopedContext(): { context: RequestContext; store: ScopeStore } | null {
  const store = storage.getStore();
  const context = store?.request?.context;
  return store && !store.system && context ? { context, store } : null;
}

/**
 * Runs fn as the system: every row, whoever asked. Only for rules that are about the whole company, never to show a
 * user what their scope hides (e.g. a customer's exposure over all branches, where a master-data record is used).
 */
export function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  // Awaited inside: a Prisma query only runs when awaited, and it must run while the system store is current.
  return storage.run({ system: true }, async () => await fn());
}
