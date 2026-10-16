import type { RequestContext } from '../context/request-context';
import { asSystem, scopeMiddleware, scopedContext } from './data-scope';

describe('data scope store', () => {
  const context = { tenantId: 't', user: { code: 'AR' } } as unknown as RequestContext;
  const inRequest = <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => scopeMiddleware({ context }, null, () => void fn().then(resolve, reject)));

  it('knows the signed-in user during a request, and nobody outside one (the system)', async () => {
    expect(scopedContext()).toBeNull();
    expect(await inRequest(async () => scopedContext()?.context.user.code)).toBe('AR');
  });

  it('runs a rule as the system inside a request, also for a lazy query that starts only when awaited', async () => {
    // Like a PrismaPromise: nothing happens until then() is called.
    const lazy = { then: (resolve: (v: unknown) => void) => resolve(scopedContext()) } as unknown as Promise<unknown>;
    const seen = await inRequest(() => asSystem(() => lazy));
    expect(seen).toBeNull();
  });
});
