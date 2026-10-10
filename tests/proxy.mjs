import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

const bundle = await build({
  entryPoints: ['proxy/worker.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['cloudflare:workers'],
});
const storage = await mkdtemp(path.join(tmpdir(), 'slop-proxy-'));
const id = 'a'.repeat(32);
let calls = 0,
  responseStatus = 200,
  hold;
const requests = [];
const bindings = {
  GPTZERO_API_KEY: 'server-only-test-secret',
  HASH_SECRET: 'test-hash-secret-that-is-at-least-32-characters',
  ALLOWED_EXTENSION_IDS: id,
  SPONSORED_ENABLED: 'true',
  INSTALL_WEEKLY_LIMIT: '2',
};
const options = {
  name: 'slop-proxy-test',
  modules: true,
  script: bundle.outputFiles[0].text,
  compatibilityDate: '2026-09-30',
  durableObjects: { QUOTAS: { className: 'Quotas', useSQLite: true } },
  durableObjectsPersist: storage,
  bindings,
  cf: false,
  outboundService: async (request) => {
    assert.equal(request.url, 'https://api.gptzero.me/v2/predict/text');
    assert.equal(request.headers.get('x-api-key'), bindings.GPTZERO_API_KEY);
    const body = await request.json();
    assert.deepEqual(Object.keys(body), ['document']);
    requests.push(body);
    calls++;
    if (hold) await hold;
    if (responseStatus !== 200)
      return Response.json(
        { secret: 'never send raw upstream errors' },
        { status: responseStatus, headers: { 'Retry-After': '120' } },
      );
    return Response.json({
      documents: [
        {
          predicted_class: 'mixed',
          class_probabilities: { human: 0.1, ai: 0.2, mixed: 0.7 },
          confidence_category: 'high',
          inputText: body.document,
        },
      ],
    });
  },
};
let mf = new Miniflare({
  ...convertV4MiniflareOptions(options),
  resourcePersistencePath: storage,
  isolatedResourcePersistencePath: storage,
});
const installation = crypto.randomUUID();
const request = (text, extra = {}) =>
  mf.dispatchFetch(`https://proxy.test${text === null ? '/v1/usage' : '/v1/check'}`, {
    method: 'POST',
    headers: {
      Origin: `chrome-extension://${id}`,
      'Content-Type': 'application/json',
      'X-Installation-Id': installation,
      'CF-Connecting-IP': '192.0.2.1',
      ...extra,
    },
    body: JSON.stringify(text === null ? {} : { text }),
  });
try {
  assert.equal((await request('forbidden', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('bad-id', { 'X-Installation-Id': 'a' })).status, 400);
  assert.equal((await request('x'.repeat(6001))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await (await request(null)).json()).usage.remaining, 2);
  let release;
  hold = new Promise((resolve) => {
    release = resolve;
  });
  const first = request('The first public post');
  for (let i = 0; i < 100 && calls === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 1);
  const duplicate = await (await request('The first public post')).json();
  assert.equal(duplicate.status, 'busy');
  assert.equal(calls, 1);
  release();
  hold = undefined;
  const firstData = await (await first).json();
  assert.equal(firstData.status, 'ok');
  assert.ok(Math.abs(firstData.verdict.probability - 0.9) < 0.00001);
  assert.equal(JSON.stringify(firstData).includes('public post'), false);
  assert.equal(JSON.stringify(firstData).includes('server-only'), false);
  assert.equal((await (await request('The first public post')).json()).cached, true);
  await request('The second public post');
  assert.equal((await (await request('The third public post')).json()).code, 'quota');
  assert.equal(calls, 2);
  await mf.dispose();
  mf = new Miniflare({
    ...convertV4MiniflareOptions(options),
    resourcePersistencePath: storage,
    isolatedResourcePersistencePath: storage,
  });
  assert.equal(
    (await (await request(null)).json()).usage.remaining,
    0,
    'Restart must preserve quotas',
  );
  assert.equal(
    (await (await request('The first public post')).json()).cached,
    true,
    'Restart must preserve score cache',
  );
  console.log(
    'PASS: real Worker + SQLite Durable Object: origin, body, concurrency, cache, quota, restart and sanitized output',
  );

  responseStatus = 429;
  const other = { 'X-Installation-Id': crypto.randomUUID() };
  const limited = await (await request('New content while provider throttles', other)).json();
  assert.equal(limited.code, 'rate_limit');
  assert.equal(limited.retryAfter, 120000);
  const before = calls;
  const cooldown = await (await request('Another post during cooldown', other)).json();
  assert.equal(cooldown.code, 'rate_limit');
  assert.equal(calls, before);
  await mf.setOptions(
    convertV4MiniflareOptions({
      ...options,
      bindings: { ...bindings, SPONSORED_ENABLED: 'false' },
    }),
  );
  assert.equal((await request('Disabled service')).status, 503);
  assert.equal(calls, before);
  console.log('PASS: provider Retry-After is enforced globally; kill switch sends no API requests');
} finally {
  await mf.dispose();
  await rm(storage, { recursive: true, force: true });
}
