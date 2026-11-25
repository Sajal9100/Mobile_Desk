import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const DIST = resolve(import.meta.dirname, '../../../dist');

export type Entry = 'main-api.js' | 'main-realtime.js' | 'main-worker.js';

/** Fail with an actionable message instead of a confusing spawn error. */
export function assertBuilt(entry: Entry): string {
  const path = resolve(DIST, entry);
  if (!existsSync(path)) {
    throw new Error(
      `dist/${entry} not found. Run "npm run build" (npm run test:integration does).`,
    );
  }
  return path;
}

/** Only what Node itself needs on Windows/Linux, plus the variables a test passes explicitly. */
function baseEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'] ?? '' };
  if (process.env['SystemRoot'] !== undefined) env['SystemRoot'] = process.env['SystemRoot'];
  return { ...env, ...extra };
}

/** Runs the server to completion (it is expected to exit by itself) and returns what it printed. */
export function runToExit(entry: Entry, env: Record<string, string>) {
  const result = spawnSync(process.execPath, [assertBuilt(entry)], {
    cwd: tmpdir(), // an empty directory: no .env file can fill in missing variables
    env: baseEnv(env),
    encoding: 'utf8',
    timeout: 20_000,
  });
  return {
    exitCode: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

export type RunningServer = {
  child: ChildProcess;
  baseUrl: string;
  output: () => string;
  stop: () => Promise<void>;
};

/** Starts the server and waits until GET /health answers 200. */
export async function startServer(entry: Entry, env: Record<string, string>, port: number) {
  const child = spawn(process.execPath, [assertBuilt(entry)], {
    cwd: tmpdir(),
    env: baseEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let captured = '';
  child.stdout?.on('data', (chunk: Buffer) => (captured += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (captured += chunk.toString()));
  let exited = false;
  child.once('exit', () => (exited = true));

  const baseUrl = `http://127.0.0.1:${port}`;
  const server: RunningServer = {
    child,
    baseUrl,
    output: () => captured,
    stop: async () => {
      if (!exited) child.kill();
      for (let i = 0; i < 40 && !exited; i++) await delay(100);
    },
  };

  for (let attempt = 0; attempt < 80; attempt++) {
    if (exited) throw new Error(`server exited early:\n${captured}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return server;
    } catch {
      // not listening yet
    }
    await delay(250);
  }
  await server.stop();
  throw new Error(`server did not become healthy:\n${captured}`);
}

export type RunningWorker = {
  child: ChildProcess;
  output: () => string;
  isRunning: () => boolean;
  stop: () => Promise<void>;
};

/** Starts the worker (no HTTP listener) and waits for its "worker started" log line. */
export async function startWorker(env: Record<string, string>): Promise<RunningWorker> {
  const child = spawn(process.execPath, [assertBuilt('main-worker.js')], {
    cwd: tmpdir(),
    env: baseEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let captured = '';
  child.stdout?.on('data', (chunk: Buffer) => (captured += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (captured += chunk.toString()));
  let exited = false;
  child.once('exit', () => (exited = true));

  const worker: RunningWorker = {
    child,
    output: () => captured,
    isRunning: () => !exited,
    stop: async () => {
      if (!exited) child.kill();
      for (let i = 0; i < 40 && !exited; i++) await delay(100);
    },
  };

  for (let attempt = 0; attempt < 80; attempt++) {
    if (exited) throw new Error(`worker exited early:\n${captured}`);
    if (captured.includes('worker started')) return worker;
    await delay(250);
  }
  await worker.stop();
  throw new Error(`worker did not start:\n${captured}`);
}
