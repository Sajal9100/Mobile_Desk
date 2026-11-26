import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Docker Compose reads `KEY=   # comment` (empty value + inline comment) as the VALUE "# comment",
// which crash-looped every container with an invalid CORS_ORIGINS. Comments get their own line.
describe('.env.example', () => {
  const lines = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8').split(/\r?\n/);

  it('has no inline comment after an empty value', () => {
    const offenders = lines.filter((line) => /^[A-Z][A-Z0-9_]*=\s+#/.test(line));
    expect(offenders).toEqual([]);
  });

  it('contains names and placeholders only (no real secrets)', () => {
    const secretish = lines.filter((line) =>
      /^(.*(PASSWORD|SECRET|KEY|TOKEN).*)=(?!CHANGE_ME|\s*$|\s*#)/.test(line),
    );
    expect(secretish).toEqual([]);
  });
});
