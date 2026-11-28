#!/usr/bin/env node
// Creates a local development JWT signing key and stores it in .env.
//
//   node scripts/gen-jwt-key.mjs                  first-time setup: adds JWT_PRIVATE_KEYS / JWT_ACTIVE_KID
//   node scripts/gen-jwt-key.mjs --add --kid k2   rotation rehearsal: adds a key and makes it active
//   options: --kid <id> (default dev-1)   --env <file> (default .env)
//
// The private key is written to the file and NEVER printed. It must not be used outside local
// development: staging and production keys come from the secrets manager (see docs/RUNBOOKS.md).
// Node built-ins only, so there is nothing to install.

import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const KID = /^[A-Za-z0-9_-]{1,64}$/;

function fail(message) {
  process.stderr.write(`gen-jwt-key: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { kid: 'dev-1', env: '.env', add: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--add') options.add = true;
    else if (arg === '--kid' || arg === '--env') {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value`);
      options[arg.slice(2)] = value;
    } else fail(`unknown argument ${arg}`);
  }
  if (!KID.test(options.kid)) fail('--kid must be 1-64 characters of A-Z a-z 0-9 _ -');
  return options;
}

/** The value of `NAME=value` in a dotenv text, without surrounding single or double quotes. */
function readValue(text, name) {
  const match = new RegExp(`^${name}=(.*)$`, 'm').exec(text);
  if (match === null) return undefined;
  const raw = (match[1] ?? '').replace(/\r$/, '').trim();
  const quoted = /^'(.*)'$/.exec(raw) ?? /^"(.*)"$/.exec(raw);
  return quoted === null ? raw : quoted[1];
}

/** Sets `NAME=value`: replaces the existing line or appends one. Keeps the file's line endings. */
function setValue(text, name, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const line = [name, value].join('=');
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, () => line);
  const separator = text === '' || text.endsWith('\n') ? '' : eol;
  return `${text}${separator}${line}${eol}`;
}

const options = parseArgs(process.argv.slice(2));
let text = existsSync(options.env) ? readFileSync(options.env, 'utf8') : '';

let keys = {};
const existing = readValue(text, 'JWT_PRIVATE_KEYS');
if (existing !== undefined && existing !== '') {
  if (!options.add) {
    fail(
      `${options.env} already has JWT_PRIVATE_KEYS. Nothing was changed. ` +
        'Use --add --kid <new id> to add a key and make it active.',
    );
  }
  try {
    keys = JSON.parse(existing);
  } catch {
    fail(`JWT_PRIVATE_KEYS in ${options.env} is not valid JSON; fix or remove it first`);
  }
  if (Object.hasOwn(keys, options.kid)) fail(`key id "${options.kid}" already exists`);
} else if (options.add) {
  fail(`${options.env} has no JWT_PRIVATE_KEYS to add to; run without --add first`);
}

const { privateKey } = generateKeyPairSync('ed25519');
keys[options.kid] = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

// Single quotes keep dotenv from touching the \n escapes; JSON.parse turns them into newlines.
text = setValue(text, 'JWT_PRIVATE_KEYS', `'${JSON.stringify(keys)}'`);
text = setValue(text, 'JWT_ACTIVE_KID', options.kid);
writeFileSync(options.env, text, { mode: 0o600 });

process.stdout.write(
  `Wrote an Ed25519 key with id "${options.kid}" to ${options.env} and made it the active key.\n` +
    'The private key was not printed. Keys in this file are for local development only.\n',
);
