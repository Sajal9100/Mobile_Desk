import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseYaml } from '@redocly/openapi-core';
import { describe, expect, it } from 'vitest';
import { SENSITIVE_KEYS } from '../../src/common/logger.js';

/**
 * Rule 8: the pino redact list is the single source of truth for what must never be logged.
 * pino redacts by exact key, so every secret-looking field that the contracts introduce has to be
 * in SENSITIVE_KEYS. This test fails the build when a contract adds one that is not.
 */

const CONTRACTS = resolve(import.meta.dirname, '../../contracts');
const SECRET_WORDS = new Set([
  'password',
  'token',
  'ticket',
  'secret',
  'credential',
  'sdp',
  'candidate',
  'pin',
]);

/** Look like secrets by name but are not (a media-section id, an index, a boolean flag). */
const NOT_SECRET = new Set(['sdpMid', 'sdpMLineIndex', 'requirePin']);

type Json = Record<string, unknown>;

function load(file: string): unknown {
  return parseYaml(readFileSync(resolve(CONTRACTS, file), 'utf8'));
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Visits every object and array in the document. */
function walk(node: unknown, visit: (object: Json) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
  } else if (isObject(node)) {
    visit(node);
    for (const value of Object.values(node)) walk(value, visit);
  }
}

/** Every property name declared under a `properties:` map. */
function propertyNames(doc: unknown): Set<string> {
  const names = new Set<string>();
  walk(doc, (object) => {
    const properties = object['properties'];
    if (isObject(properties)) {
      for (const name of Object.keys(properties)) names.add(name);
    }
  });
  return names;
}

/** "refreshToken" -> ["refresh", "token"]; "sdpMLineIndex" -> ["sdp", "m", "line", "index"]. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

function looksSecret(name: string): boolean {
  return !NOT_SECRET.has(name) && words(name).some((word) => SECRET_WORDS.has(word));
}

const documents = { 'openapi.yaml': load('openapi.yaml'), 'asyncapi.yaml': load('asyncapi.yaml') };
const redacted = new Set<string>(SENSITIVE_KEYS);

describe('contracts vs the logger redact list', () => {
  it('finds the fields it is meant to guard (the walk is not empty)', () => {
    const all = new Set(Object.values(documents).flatMap((doc) => [...propertyNames(doc)]));
    for (const expected of ['password', 'refreshToken', 'sdp', 'candidate', 'pin']) {
      expect(all.has(expected), `${expected} not found in the contracts`).toBe(true);
    }
  });

  it.each(Object.entries(documents))(
    '%s: every secret-looking property is in SENSITIVE_KEYS',
    (_file, doc) => {
      const missing = [...propertyNames(doc)].filter(
        (name) => looksSecret(name) && !redacted.has(name),
      );
      expect(missing, 'add these to SENSITIVE_KEYS in src/common/logger.ts').toEqual([]);
    },
  );

  it('no path or query parameter is named like a secret (never put secrets in a URL)', () => {
    const offenders: string[] = [];
    walk(documents['openapi.yaml'], (object) => {
      const location = object['in'];
      const name = object['name'];
      if ((location === 'path' || location === 'query') && typeof name === 'string') {
        if (looksSecret(name)) offenders.push(`${String(location)}:${name}`);
      }
    });
    expect(offenders).toEqual([]);
  });
});
