import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export type ApiResponse = {
  status: number;
  headers: Record<string, string | string[] | number | undefined>;
  text: string;
  json: <T = Record<string, unknown>>() => T;
};

export type ErrorPayload = { error: { code: string; message: string; requestId: string } };

export type AuthPayload = {
  user: { id: string; email: string; displayName: string; createdAt: string };
  accessToken: string;
  refreshToken: string;
};

export type RequestOptions = {
  body?: unknown;
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** The caller's source address. A fresh one per request unless a test pins it. */
  ip?: string;
  headers?: Record<string, string>;
};

export const DEFAULT_PASSWORD = 'correct-horse-9';

let ipCounter = 0;
let emailCounter = 0;

/** A new address per call: every request would otherwise come from 127.0.0.1 and share limits. */
export function freshIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export function uniqueEmail(prefix = 'user'): string {
  emailCounter += 1;
  return `${prefix}-${emailCounter}-${randomUUID().slice(0, 8)}@example.com`;
}

/** A thin wrapper over `app.inject` that speaks the API the way the app does. */
export class TestClient {
  constructor(private readonly app: NestFastifyApplication) {}

  async request(method: string, url: string, options: RequestOptions = {}): Promise<ApiResponse> {
    const response = await this.app.inject({
      method: method as 'GET',
      url,
      remoteAddress: options.ip ?? freshIp(),
      headers: {
        ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
    });
    return {
      status: response.statusCode,
      headers: response.headers,
      text: response.body,
      json: <T>() => JSON.parse(response.body) as T,
    };
  }

  get(url: string, options?: RequestOptions) {
    return this.request('GET', url, options);
  }

  post(url: string, body: unknown, options: RequestOptions = {}) {
    return this.request('POST', url, { ...options, body });
  }

  delete(url: string, body: unknown, options: RequestOptions = {}) {
    return this.request('DELETE', url, { ...options, body });
  }

  async nonce(ip?: string): Promise<string> {
    const response = await this.get('/api/integrity/nonce', ip === undefined ? {} : { ip });
    if (response.status !== 200) throw new Error(`nonce failed: ${response.status}`);
    return response.json<{ nonce: string }>().nonce;
  }

  /**
   * Registers a user the way the app would in `bypass` mode: fetches a nonce, then registers.
   * Pass `integrityToken` / `integrityNonce` to drive the `enforce` tests by hand.
   */
  async register(
    overrides: Record<string, unknown> = {},
    options: { ip?: string } = {},
  ): Promise<{ response: ApiResponse; email: string; password: string }> {
    const ip = options.ip ?? freshIp();
    const email = typeof overrides['email'] === 'string' ? overrides['email'] : uniqueEmail();
    const password =
      typeof overrides['password'] === 'string' ? overrides['password'] : DEFAULT_PASSWORD;
    const body = {
      displayName: 'Test User',
      email,
      password,
      integrityToken: 'bypass-token',
      integrityNonce: await this.nonce(ip),
      ...overrides,
    };
    return { response: await this.post('/api/auth/register', body, { ip }), email, password };
  }

  async login(
    email: string,
    password: string,
    overrides: Record<string, unknown> = {},
    options: { ip?: string } = {},
  ): Promise<ApiResponse> {
    const ip = options.ip ?? freshIp();
    const body = {
      email,
      password,
      integrityToken: 'bypass-token',
      integrityNonce: await this.nonce(ip),
      ...overrides,
    };
    return this.post('/api/auth/login', body, { ip });
  }

  /** Registers and returns the parsed tokens; fails the test loudly if it did not work. */
  async signUp(
    overrides: Record<string, unknown> = {},
  ): Promise<AuthPayload & { password: string }> {
    const { response, password } = await this.register(overrides);
    if (response.status !== 201) {
      throw new Error(`sign-up failed with ${response.status}: ${response.text}`);
    }
    return { ...response.json<AuthPayload>(), password };
  }

  refresh(refreshToken: string, options?: RequestOptions) {
    return this.post('/api/auth/refresh', { refreshToken }, options);
  }

  logout(refreshToken: string, options?: RequestOptions) {
    return this.post('/api/auth/logout', { refreshToken }, options);
  }
}
