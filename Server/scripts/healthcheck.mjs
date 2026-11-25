// Container HEALTHCHECK: GET /health on this process's own port, exit 0 if it answers 200.
// Slim images have no curl, so this uses Node's built-in fetch.
const port = process.env.HEALTHCHECK_PORT ?? process.env.PORT_API;

if (!port) {
  process.stderr.write('healthcheck: HEALTHCHECK_PORT or PORT_API must be set\n');
  process.exit(1);
}

try {
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(2000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
