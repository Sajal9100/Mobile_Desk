import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Parser } from '@asyncapi/parser';
import { createConfig, lint, parseYaml } from '@redocly/openapi-core';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../src/common/errors/codes.js';

const CONTRACTS = resolve(import.meta.dirname, '../../contracts');
const OPENAPI_PATH = resolve(CONTRACTS, 'openapi.yaml');
const ASYNCAPI_PATH = resolve(CONTRACTS, 'asyncapi.yaml');

type Json = Record<string, unknown>;
const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

const openapi = parseYaml(readFileSync(OPENAPI_PATH, 'utf8')) as Json;
const asyncapi = parseYaml(readFileSync(ASYNCAPI_PATH, 'utf8')) as Json;

type Operation = {
  method: string;
  path: string;
  op: Json;
  pathItem: Json;
};

function operations(): Operation[] {
  const result: Operation[] = [];
  for (const [path, pathItem] of Object.entries(openapi['paths'] as Record<string, Json>)) {
    for (const method of METHODS) {
      const op = pathItem[method] as Json | undefined;
      if (op !== undefined) result.push({ method: method.toUpperCase(), path, op, pathItem });
    }
  }
  return result;
}

/** Every endpoint of the briefs (Phases 0-7). Adding one to a brief means adding it here. */
const EXPECTED_ENDPOINTS = [
  'GET /health',
  'GET /ready',
  'GET /api/integrity/nonce',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/refresh',
  'POST /api/auth/logout',
  'DELETE /api/account',
  'GET /api/me',
  'POST /api/devices/register',
  'GET /api/devices',
  'PATCH /api/devices/{id}',
  'DELETE /api/devices/{id}',
  'PUT /api/devices/{id}/push-token',
  'POST /api/realtime/ticket',
  'POST /api/dev/push-test',
  'POST /api/sessions/request',
  'GET /api/sessions/{id}',
  'POST /api/sessions/{id}/accept',
  'POST /api/sessions/{id}/reject',
  'POST /api/sessions/{id}/cancel',
  'POST /api/sessions/{id}/disconnect',
  'POST /api/sessions/{id}/report',
  'GET /api/sessions/history',
  'GET /api/settings',
  'PUT /api/settings',
  'POST /api/blocks',
  'GET /api/blocks',
  'DELETE /api/blocks/{userId}',
  'POST /api/devices/{id}/pin',
  'GET /api/webrtc/ice-config',
  'GET /api/account/export',
  'POST /api/sessions/{id}/control/request',
  'POST /api/sessions/{id}/control/grant',
  'POST /api/sessions/{id}/control/revoke',
];

const EXPECTED_EVENTS = [
  'ping',
  'device:presence',
  'session:incoming',
  'session:accepted',
  'session:rejected',
  'session:cancelled',
  'session:expired',
  'session:ended',
  'webrtc:offer',
  'webrtc:answer',
  'webrtc:ice-candidate',
  'webrtc:connected',
  'session:control-requested',
  'session:control-changed',
];

describe('openapi.yaml', () => {
  it('has no lint errors', async () => {
    const config = await createConfig({ extends: ['minimal'] });
    const problems = await lint({ ref: OPENAPI_PATH, config });
    const errors = problems.filter((problem) => problem.severity === 'error');
    expect(errors.map((problem) => `${problem.ruleId}: ${problem.message}`)).toEqual([]);
  });

  it('ErrorCode enum is identical to src/common/errors/codes.ts', () => {
    const schemas = (openapi['components'] as Json)['schemas'] as Record<string, Json>;
    expect([...(schemas['ErrorCode']?.['enum'] as string[])].sort()).toEqual(
      [...ERROR_CODES].sort(),
    );
  });

  it('documents every endpoint of the briefs, and nothing else', () => {
    const found = operations().map(({ method, path }) => `${method} ${path}`);
    expect(found.sort()).toEqual([...EXPECTED_ENDPOINTS].sort());
  });

  it('marks every operation implemented or planned, with a phase', () => {
    for (const { method, path, op } of operations()) {
      const label = `${method} ${path}`;
      expect(['implemented', 'planned'], label).toContain(op['x-status']);
      expect(Number.isInteger(op['x-phase']), label).toBe(true);
    }
  });

  it('only /health and /ready are implemented in Phase 0', () => {
    const implemented = operations()
      .filter(({ op }) => op['x-status'] === 'implemented')
      .map(({ path }) => path);
    expect(implemented.sort()).toEqual(['/health', '/ready']);
  });

  it('every operation has a unique operationId', () => {
    const ids = operations().map(({ op }) => op['operationId'] as string);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every protected operation documents 401, and only public ones omit it', () => {
    for (const { method, path, op } of operations()) {
      const isPublic = Array.isArray(op['security']) && op['security'].length === 0;
      const responses = op['responses'] as Json;
      if (!isPublic) {
        expect(Object.keys(responses), `${method} ${path}`).toContain('401');
      }
    }
  });

  it('request bodies reject unknown fields (additionalProperties: false)', () => {
    const schemas = (openapi['components'] as Json)['schemas'] as Record<string, Json>;
    for (const { method, path, op } of operations()) {
      const body = op['requestBody'] as Json | undefined;
      if (body === undefined) continue;
      const schema = ((body['content'] as Json)['application/json'] as Json)['schema'] as Json;
      const ref = schema['$ref'] as string | undefined;
      const resolved = ref === undefined ? schema : schemas[ref.split('/').pop() ?? ''];
      expect(resolved?.['additionalProperties'], `${method} ${path}`).toBe(false);
    }
  });

  it('create/accept/grant operations require an Idempotency-Key', () => {
    const needKey = new Set([
      'POST /api/sessions/request',
      'POST /api/sessions/{id}/accept',
      'POST /api/sessions/{id}/control/grant',
    ]);
    for (const { method, path, op } of operations()) {
      if (!needKey.has(`${method} ${path}`)) continue;
      const refs = (op['parameters'] as Json[]).map((parameter) => parameter['$ref']);
      expect(refs, `${method} ${path}`).toContain('#/components/parameters/IdempotencyKey');
    }
  });

  it('accept only allows controlGranted: false in v1', () => {
    const schemas = (openapi['components'] as Json)['schemas'] as Record<string, Json>;
    const property = (schemas['AcceptRequest']?.['properties'] as Json)['controlGranted'] as Json;
    expect(property['const']).toBe(false);
  });
});

describe('asyncapi.yaml', () => {
  it('parses with no errors', async () => {
    const { document, diagnostics } = await new Parser().parse(readFileSync(ASYNCAPI_PATH, 'utf8'));
    expect(document).toBeDefined();
    const errors = diagnostics.filter(
      // 0 is DiagnosticSeverity.Error (the parser's enum type differs from the diagnostics').
      (diagnostic) => Number(diagnostic.severity) === 0,
    );
    expect(errors.map((diagnostic) => diagnostic.message)).toEqual([]);
  });

  it('documents every realtime event of the briefs', () => {
    const addresses = Object.values(asyncapi['channels'] as Record<string, Json>).map(
      (channel) => channel['address'] as string,
    );
    expect(addresses.sort()).toEqual([...EXPECTED_EVENTS].sort());
  });

  it('marks every operation with a status and a phase', () => {
    for (const [name, op] of Object.entries(asyncapi['operations'] as Record<string, Json>)) {
      expect(['implemented', 'planned'], name).toContain(op['x-status']);
      expect(Number.isInteger(op['x-phase']), name).toBe(true);
    }
  });

  it('authenticates with the ticket, never a URL token', () => {
    const description = JSON.stringify(asyncapi['info']);
    expect(description).toContain('auth: { ticket }');
    expect(description).toMatch(/Never put a token in the URL/);
  });
});
