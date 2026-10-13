import 'reflect-metadata';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OutboxDispatcher } from '../src/platform/outbox/outbox.dispatcher';
import { PrismaService } from '../src/platform/prisma/prisma.service';

/**
 * End-to-end harness. The tests run against the database in backend/.env (zora_erp), so they reset it with the demo
 * seed before and after: run them when you do not mind losing what you clicked. The API runs in this process on a
 * free port with its own outbox polling off; the tests drive the dispatcher themselves (a running dev server may
 * deliver events too, which is why `until` keeps polling instead of checking once).
 */

const backendDir = path.resolve(__dirname, '..');

export function reseed(): void {
  execSync('npx prisma db seed', { cwd: backendDir, stdio: 'pipe' });
}

export interface Api {
  app: INestApplication;
  prisma: PrismaService;
  call<T = any>(method: string, route: string, user: string, body?: unknown): Promise<{ status: number; body: T }>;
  get<T = any>(route: string, user?: string): Promise<T>;
  /** Finds a document id by number through its list endpoint, e.g. idOf('sales/orders', 'SO-0002'). */
  idOf(resource: string, docNo: string, user?: string): Promise<string>;
  /** Delivers waiting events, then checks; repeats until the check returns something truthy (or fails after 20 s). */
  until<T>(what: string, check: () => Promise<T | null | undefined | false>): Promise<T>;
  close(): Promise<void>;
}

export async function startApi(): Promise<Api> {
  process.env.OUTBOX_DISPATCH = 'off';
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`;
  const dispatcher = app.get(OutboxDispatcher);

  const call: Api['call'] = async (method, route, user, body) => {
    const res = await fetch(`${base}/${route}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-user': user },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as never };
  };
  const get: Api['get'] = async (route, user = 'ADM') => {
    const res = await call('GET', route, user);
    if (res.status !== 200) throw new Error(`GET ${route} as ${user}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };

  return {
    app,
    prisma: app.get(PrismaService),
    call,
    get,
    async idOf(resource, docNo, user = 'ADM') {
      const list = await get<{ items: { id: string; docNo: string }[] }>(`${resource}?q=${encodeURIComponent(docNo)}`, user);
      const hit = list.items.find((i) => i.docNo === docNo);
      if (!hit) throw new Error(`${docNo} not found in ${resource}`);
      return hit.id;
    },
    async until(what, check) {
      for (let i = 0; i < 40; i++) {
        await dispatcher.tick();
        const result = await check();
        if (result) return result;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`Timed out waiting for ${what}`);
    },
    close: () => app.close(),
  };
}
