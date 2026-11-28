import { configSchema, type AppConfig } from './config.schema.js';

export type ConfigIssue = {
  /** Environment variable name. Never its value. */
  variable: string;
  /** "missing" or a zod issue code such as "invalid_format". Never the offending value. */
  problem: string;
};

export type ParseConfigResult =
  { ok: true; config: AppConfig } | { ok: false; issues: ConfigIssue[] };

export function parseConfig(env: NodeJS.ProcessEnv = process.env): ParseConfigResult {
  const parsed = configSchema.safeParse(env);
  if (parsed.success) {
    return { ok: true, config: parsed.data };
  }
  const issues = parsed.error.issues.map((issue): ConfigIssue => {
    const variable = typeof issue.path[0] === 'string' ? issue.path[0] : '(config)';
    // Zod reports an unset enum as invalid_value and an unset string as invalid_type; to the operator
    // both are simply "missing" (an empty value counts as unset: Compose passes those through).
    // A `custom` issue carries a fixed message written in config.schema.ts (never a value), which
    // says more than the bare code; every other issue is reported by its code only.
    const unset = env[variable] === undefined || env[variable] === '';
    const problem = unset ? 'missing' : issue.code === 'custom' ? issue.message : issue.code;
    return { variable, problem };
  });
  return { ok: false, issues };
}

export type ExitIo = {
  write: (text: string) => void;
  exit: (code: number) => never;
};

const processIo: ExitIo = {
  write: (text) => void process.stderr.write(text),
  exit: (code) => process.exit(code),
};

/**
 * Validate the environment or end the process with a non-zero exit code.
 * The message names variables and problem codes only: values are never printed.
 */
export function loadConfigOrExit(
  env: NodeJS.ProcessEnv = process.env,
  io: ExitIo = processIo,
): AppConfig {
  const result = parseConfig(env);
  if (result.ok) {
    return result.config;
  }
  const lines = result.issues.map((issue) => `  - ${issue.variable}: ${issue.problem}`);
  io.write(
    `Invalid configuration, refusing to start:\n${lines.join('\n')}\n(values are never printed)\n`,
  );
  return io.exit(1);
}

/**
 * Local development convenience: load ./.env if it exists. Never in production, where the
 * environment is injected by the secrets manager. Variables already set win over the file.
 */
export function loadDotEnvIfPresent(path = '.env'): void {
  if (process.env['NODE_ENV'] === 'production') {
    return;
  }
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
