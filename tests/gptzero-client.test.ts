import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('../src/gptzero-config', () => ({ GPTZERO_PROXY_URL: 'https://proxy.example.test' }));
let saved: Record<string, unknown>;
let client: typeof import('../src/gptzero-client');
const usage = { limit: 100, used: 5, remaining: 95, resetsAt: Date.now() + 86400000 };
const signal = () => new AbortController().signal;

beforeEach(async () => {
  vi.resetModules();
  saved = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async () => ({ ...saved }),
        set: async (value: Record<string, unknown>) => {
          Object.assign(saved, value);
        },
      },
    },
  });
  client = await import('../src/gptzero-client');
});

async function connect() {
  const transport = vi.fn(async () => Response.json({ usage }));
  vi.stubGlobal('fetch', transport);
  await client.loadGptzero();
  await client.connectGptzero(signal());
  return transport;
}

test('connecting checks allowance only, persists an anonymous ID, and never sends a key', async () => {
  const transport = await connect();
  const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://proxy.example.test/v1/usage');
  expect(init.body).toBe('{}');
  expect(new Headers(init.headers).get('X-Installation-Id')).toBe(saved.gptzeroInstallation);
  expect(init.credentials).toBe('omit');
  expect(client.gptzeroStatus(true).connected).toBe(true);
  vi.resetModules();
  const reloaded = await import('../src/gptzero-client');
  await reloaded.loadGptzero();
  expect(reloaded.gptzeroStatus(true)).toMatchObject({ connected: true, usage });
});

test('out-of-order allowances never lower this week’s usage', async () => {
  await connect();
  vi.stubGlobal('fetch', async () =>
    Response.json({ status: 'unrated', usage: { ...usage, used: 9, remaining: 91 } }),
  );
  await client.evaluateGptzero('Visible text', signal());
  vi.stubGlobal('fetch', async () => Response.json({ status: 'unrated', usage }));
  await client.evaluateGptzero('Visible text', signal());
  expect(client.gptzeroStatus(true).usage?.used).toBe(9);
});

test('rejects malformed proxy JSON rather than treating it as Not slop', async () => {
  await connect();
  for (const data of [
    null,
    [],
    'ok',
    { status: 'ok', verdict: {} },
    { status: 'busy', retryAfter: '1000' },
    { status: 'error', code: 'unknown' },
  ]) {
    vi.stubGlobal('fetch', async () => Response.json(data));
    await expect(client.evaluateGptzero('Visible text', signal())).rejects.toThrow();
  }
});

test('sanitizes errors, bounds retry delays, and derives AI-only probability from legacy results', async () => {
  await connect();
  vi.stubGlobal('fetch', async () =>
    Response.json(
      { status: 'error', code: 'provider', message: 'upstream secret', retryAfter: 1e15 },
      { status: 503 },
    ),
  );
  expect(await client.evaluateGptzero('Visible text', signal())).toEqual({
    status: 'error',
    code: 'provider',
    message: 'GPTZero unavailable.',
    retryAfter: 32 * 86400000,
  });
  vi.stubGlobal('fetch', async () =>
    Response.json({
      status: 'ok',
      cached: true,
      verdict: {
        probability: 0.9,
        evaluatedAt: 1,
        latencyMs: 1,
        gptzero: { classification: 'mixed', probabilities: { human: 0.1, mixed: 0.7, ai: 0.2 } },
      },
    }),
  );
  expect(await client.evaluateGptzero('Visible text', signal())).toMatchObject({
    status: 'ok',
    cached: true,
    verdict: { probability: 0.2 },
  });
});

test('failed registration remains disconnected, and aborted responses cannot complete registration', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ usage: { ...usage, remaining: 500 } }));
  await expect(client.connectGptzero(signal())).rejects.toThrow();
  expect(client.gptzeroStatus(true).connected).toBe(false);
  const controller = new AbortController();
  vi.stubGlobal('fetch', async () => {
    controller.abort();
    return Response.json({ usage });
  });
  await expect(client.connectGptzero(controller.signal)).rejects.toThrow();
  expect(saved.gptzeroConnection).toBeUndefined();
});
