import { HttpException, HttpStatus, Logger } from '@nestjs/common';

export interface WmsSettings {
  url: string;
  email: string;
  password: string;
  /** The WMS website, for "Open in WMS". */
  webUrl: string | null;
}

export interface WmsAnswer<T> {
  data: T;
  /** When the WMS gave this answer. */
  asOf: string;
  /** True when the WMS could not be reached and this is the last answer it gave. */
  stale: boolean;
}

/** 503: the WMS cannot be reached and there is no earlier answer to show. */
export class WmsUnavailableError extends HttpException {
  constructor() {
    super({ code: 'WMS_UNAVAILABLE', message: 'The WMS cannot be reached right now. Try again in a moment.' }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

/** Many screens ask at once, so one answer is reused briefly instead of asking the WMS each time. */
const CACHE_MS = 15_000;
const TIMEOUT_MS = 10_000;

/**
 * The ERP's only connection to a client's WMS. It is read only by construction: apart from signing in, the one thing it
 * can send is a GET (docs/integration/WMS_DATA_OWNERSHIP.md). It keeps the last answers in memory and stores nothing.
 */
export class WmsClient {
  private readonly logger = new Logger(WmsClient.name);
  private token: string | null = null;
  private readonly answers = new Map<string, { at: number; asOf: string; data: unknown }>();
  private readonly waiting = new Map<string, Promise<unknown>>();

  constructor(private readonly settings: WmsSettings) {}

  get webUrl(): string | null {
    return this.settings.webUrl;
  }

  /** A list that changes slowly enough to reuse for a moment. If the WMS is down, the last answer it gave. */
  async get<T>(path: string): Promise<WmsAnswer<T>> {
    const known = this.answers.get(path);
    if (known && Date.now() - known.at < CACHE_MS) return { data: known.data as T, asOf: known.asOf, stale: false };
    try {
      const data = await this.once<T>(path);
      const asOf = new Date().toISOString();
      this.answers.set(path, { at: Date.now(), asOf, data });
      return { data, asOf, stale: false };
    } catch (error) {
      this.logger.warn(`Cannot read ${path} from the WMS: ${error instanceof Error ? error.message : String(error)}`);
      if (known) return { data: known.data as T, asOf: known.asOf, stale: true };
      throw new WmsUnavailableError();
    }
  }

  /** One record, always fresh and never kept. Null when the WMS does not know it. */
  async find<T>(path: string): Promise<T | null> {
    try {
      const res = await this.send(path);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`answered ${res.status}`);
      return (await res.json()) as T;
    } catch (error) {
      this.logger.warn(`Cannot read ${path} from the WMS: ${error instanceof Error ? error.message : String(error)}`);
      throw new WmsUnavailableError();
    }
  }

  /** Screens asking for the same list at the same moment share one request. */
  private once<T>(path: string): Promise<T> {
    const running = this.waiting.get(path);
    if (running) return running as Promise<T>;
    const request = this.read<T>(path).finally(() => this.waiting.delete(path));
    this.waiting.set(path, request);
    return request;
  }

  private async read<T>(path: string): Promise<T> {
    const res = await this.send(path);
    if (!res.ok) throw new Error(`answered ${res.status}`);
    return (await res.json()) as T;
  }

  private async send(path: string): Promise<Response> {
    const url = `${this.settings.url}/api/${path}`;
    const res = await fetch(url, { headers: await this.headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status !== 401) return res;
    this.token = null; // The WMS token ended: sign in once more.
    return fetch(url, { headers: await this.headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  private async headers(): Promise<Record<string, string>> {
    if (!this.token) {
      const res = await fetch(`${this.settings.url}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: this.settings.email, password: this.settings.password }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`sign-in answered ${res.status}`);
      this.token = ((await res.json()) as { token: string }).token;
    }
    return { authorization: `Bearer ${this.token}` };
  }
}
