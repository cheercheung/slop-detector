import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { launchTestBrowser } from './browser-lifecycle.mjs';
import { mockPermissionPrompts, providerOrigins } from './browser-permissions.mjs';

const temp = await mkdtemp(path.join(tmpdir(), 'slop-gptzero-e2e-'));
await mkdir('test-results', { recursive: true });
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    `${temp}/key.pem`,
    '-out',
    `${temp}/cert.pem`,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
  ],
  { stdio: 'ignore' },
);
let context, mf, server;
const calls = [],
  incoming = [],
  errors = [];
try {
  const bundle = await build({
    entryPoints: ['proxy/worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:workers'],
  });
  const options = {
    name: 'gptzero-browser-test',
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-09-30',
    cf: false,
    durableObjects: { QUOTAS: { className: 'Quotas', useSQLite: true } },
    bindings: {
      GPTZERO_API_KEY: 'server-only-e2e-key',
      HASH_SECRET: 'e2e-hash-secret-at-least-thirty-two-characters',
      ALLOWED_EXTENSION_IDS: '',
      SPONSORED_ENABLED: 'true',
      INSTALL_WEEKLY_LIMIT: '3',
    },
    outboundService: async (request) => {
      assert.equal(request.url, 'https://api.gptzero.me/v2/predict/text');
      assert.equal(request.headers.get('x-api-key'), 'server-only-e2e-key');
      const body = await request.json();
      assert.deepEqual(Object.keys(body), ['document']);
      calls.push(body.document);
      if (body.document.includes('Too short'))
        return Response.json({ error: 'input rejected' }, { status: 422 });
      const ai = body.document.includes('99%');
      return Response.json({
        documents: [
          {
            predicted_class: ai ? 'ai' : 'mixed',
            class_probabilities: { human: ai ? 0.03 : 0, ai: ai ? 0.9 : 0, mixed: ai ? 0.07 : 1 },
            confidence_category: 'high',
          },
        ],
      });
    },
  };
  mf = new Miniflare({
    ...convertV4MiniflareOptions(options),
    resourcePersistencePath: `${temp}/state`,
    isolatedResourcePersistencePath: `${temp}/state`,
  });
  server = createServer(
    { key: await readFile(`${temp}/key.pem`), cert: await readFile(`${temp}/cert.pem`) },
    async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        incoming.push({
          origin: req.headers.origin,
          path: req.url,
          installation: req.headers['x-installation-id'],
        });
        const response = await mf.dispatchFetch(`https://proxy.test${req.url}`, {
          method: req.method,
          headers: { ...req.headers, 'CF-Connecting-IP': '192.0.2.1' },
          body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        errors.push(String(error));
        res.writeHead(500);
        res.end();
      }
    },
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const proxyUrl = `https://127.0.0.1:${server.address().port}`;
  execFileSync(process.execPath, ['scripts/build.mts'], {
    env: { ...process.env, GPTZERO_PROXY_URL: proxyUrl, BUILD_DIR: 'dist-test' },
    stdio: 'pipe',
  });
  const extension = path.resolve('dist-test');
  ({ context } = await launchTestBrowser('slop-gptzero-browser-', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1000, height: 700 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--ignore-certificate-errors',
    ],
  }));
  context.setDefaultTimeout(15000);
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  options.bindings.ALLOWED_EXTENSION_IDS = id;
  await mf.setOptions({
    ...convertV4MiniflareOptions(options),
    resourcePersistencePath: `${temp}/state`,
    isolatedResourcePersistencePath: `${temp}/state`,
  });
  await mockPermissionPrompts(context, worker, id, [
    ...providerOrigins,
    'https://api.gptzero.me/*',
    `${proxyUrl}/*`,
  ]);
  const popup = await context.newPage();
  popup.on('pageerror', (e) => errors.push(e.message));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'saveSettings', settings: { detector: 'gptzero' } }),
  );
  await popup.waitForFunction(
    () => document.querySelector('#detector-gptzero').getAttribute('aria-pressed') === 'true',
  );
  assert.equal(await popup.locator('#provider-section').isVisible(), false);
  assert.equal(await popup.locator('#prompt-section').isVisible(), false);
  await popup.setViewportSize({ width: 360, height: 620 });
  await popup.locator('body').screenshot({ path: 'test-results/popup-gptzero-setup.png' });
  assert.equal(await popup.locator('#connect-gptzero, #gptzero-privacy').count(), 0);
  await popup.locator('#gptzero-access').waitFor({ state: 'visible' });
  await worker.evaluate(() => {
    globalThis.__denyNextPermission = true;
  });
  await popup.locator('#gptzero-access').click();
  await popup.waitForFunction(() =>
    document.querySelector('#message').textContent.includes('not granted'),
  );
  assert.equal(incoming.length, 0, 'Denied access must send no proxy request');
  assert.equal(await popup.locator('#detector-gptzero').getAttribute('aria-pressed'), 'true');
  await popup.locator('#enabled').click();
  await popup.locator('#gptzero-access').click();
  await popup.waitForFunction(
    () =>
      document.querySelector('#detector-gptzero').getAttribute('aria-pressed') === 'true' &&
      !document.querySelector('#detector-gptzero').disabled &&
      !document.querySelector('#gptzero-usage').hidden,
  );
  assert.equal(await popup.locator('#enabled').getAttribute('aria-checked'), 'true');
  assert.equal(await popup.locator('#gptzero-access').isVisible(), false);
  assert.equal(calls.length, 0, 'Enabling must not spend a GPTZero check');
  assert.equal(await popup.locator('#gptzero-usage').innerText(), '3 / 3 free checks left');
  assert.ok(
    incoming.some((r) => r.path === '/v1/usage' && r.origin === `chrome-extension://${id}`),
    'Actual browser fetch must send the extension Origin',
  );
  console.log(
    'PASS: GPTZero opt-in, permission denial, actual HTTPS/CORS and cost-free connection',
  );

  const feed = await context.newPage();
  feed.on('pageerror', (e) => errors.push(e.message));
  const article = (id, top, text) =>
    `<article data-testid="tweet" id="p${id}" style="position:absolute;top:${top}px;width:600px"><a href="/test/status/${id}"><time>Today</time></a><div data-testid="tweetText">${text}</div></article>`;
  await context.route('https://x.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><style>body{min-height:4000px;margin:0;font:16px Arial}article{padding:20px;border:1px solid #ddd}</style><body>${article(1, 20, 'The library closes at six this evening.')}${article(2, 270, '99% of people miss this incredible secret.')}${article(3, 1500, 'Too short to evaluate')}${article(4, 2800, 'Another post after the allowance is exhausted.')}</body></html>`,
    }),
  );
  await feed.goto('https://x.com/home');
  const badge = (n) => feed.locator(`#p${n} jev-slop-label .badge`);
  await feed
    .waitForFunction(() =>
      document
        .querySelector('#p2 jev-slop-label')
        ?.shadowRoot.querySelector('.badge')
        .textContent.includes('Slop'),
    )
    .catch(async (error) => {
      console.log('Diagnostic:', {
        calls,
        incoming,
        labels: await feed.locator('jev-slop-label .badge').allTextContents(),
        dashboard: await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'getDashboard' })),
      });
      throw error;
    });
  assert.match(await badge(1).innerText(), /Not slop.*100%/s);
  assert.match(await badge(2).innerText(), /Slop.*90%/s);
  assert.equal(
    await feed.locator('#p1').getAttribute('data-jev-collapsed'),
    null,
    'Mixed must not be hidden',
  );
  await popup.locator('#theme').selectOption('fade');
  await feed.waitForFunction(() => document.querySelector('#p2').hasAttribute('data-jev-dim'));
  assert.equal(await feed.locator('#p1').getAttribute('data-jev-dim'), null, 'Mixed must not fade');
  await popup.locator('#theme').selectOption('stamp');
  await feed.locator('#p2 jev-slop-stamp').waitFor();
  assert.equal(
    await feed.locator('#p1 jev-slop-stamp').count(),
    0,
    '100% Mixed/AI-polished must not be stamped',
  );
  assert.equal(await badge(1).getAttribute('title'), 'Open Slop Detector settings');
  assert.equal(calls.length, 2);
  assert.ok(!calls.some((text) => text.includes('Too short')));
  const saved = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(JSON.stringify(saved).includes('server-only-e2e-key'), false);
  assert.ok(saved.gptzeroInstallation);
  assert.equal(await popup.locator('#attribution').innerText(), 'Powered by GPTZero');
  await popup.waitForFunction(
    () => document.querySelector('#gptzero-usage').textContent === '1 / 3 free checks left',
  );
  await popup.locator('body').screenshot({ path: 'test-results/popup-gptzero-connected.png' });
  console.log(
    'PASS: viewport-only GPTZero scores, unchanged Slop labels, inverted Not slop score and persistent attribution',
  );

  await popup.locator('#clear-cache').click();
  await feed.bringToFront();
  await feed.waitForFunction(() =>
    document
      .querySelector('#p2 jev-slop-label')
      ?.shadowRoot.querySelector('.badge')
      .textContent.includes('Slop'),
  );
  await feed.waitForFunction(() =>
    document
      .querySelector('#p1 jev-slop-label')
      ?.shadowRoot.querySelector('.badge')
      .textContent.includes('Not slop'),
  );
  assert.equal(
    calls.length,
    2,
    `Proxy cache survives extension cache clearing: ${JSON.stringify(calls)}`,
  );
  assert.match(
    await badge(1).innerText(),
    /Not slop.*100%/s,
    'Legacy AI+Mixed proxy cache must be reinterpreted',
  );
  assert.equal(await feed.locator('#p1 jev-slop-stamp').count(), 0);
  await feed.evaluate(() => scrollTo(0, 1400));
  await feed.waitForFunction(
    () =>
      document.querySelector('#p3 jev-slop-label')?.shadowRoot.querySelector('.badge')
        .textContent === 'Unrated',
  );
  const count = calls.length;
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(calls.length, count, 'Unsupported text must not loop');
  await feed.evaluate(() => scrollTo(0, 2700));
  await feed.waitForFunction(
    () =>
      document.querySelector('#p4 jev-slop-label')?.shadowRoot.querySelector('.badge')
        .textContent === 'Free limit reached',
  );
  assert.equal(calls.length, 3);
  assert.equal(
    (await worker.evaluate(() => chrome.storage.local.get('gptzeroInstallation')))
      .gptzeroInstallation,
    saved.gptzeroInstallation,
  );
  await popup.waitForFunction(
    () => document.querySelector('#gptzero-usage').textContent === '0 / 3 free checks left',
  );
  await popup.locator('body').screenshot({ path: 'test-results/popup-gptzero-limit.png' });
  console.log(
    'PASS: cache clearing retains quota, unsupported text stays unrated, exhausted allowance stops paid calls',
  );

  await worker.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.__jevRequests = [];
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://direct.evolink.ai/')) return original(url, init);
      const body = JSON.parse(init.body);
      globalThis.__jevRequests.push(body);
      return Response.json({
        answers: [{ name: 'aiGenerated', type: 'predicate', probability: 0.12 }],
        usage: { inputTokens: 100, outputTokens: 0 },
      });
    };
  });
  await popup.locator('#detector-jev').click();
  await popup.locator('#api-key').fill('user-owned-jev-test-key');
  await popup.locator('#connect').click();
  await popup.waitForFunction(
    () => document.querySelector('#key-status').textContent === 'Connected',
  );
  await popup.locator('#prompt-section summary').click();
  await popup.locator('#prompt').fill('Is this a sales pitch?');
  await popup.locator('#save-prompt').click();
  await feed.bringToFront();
  await feed.waitForFunction(() =>
    document
      .querySelector('#p4 jev-slop-label')
      ?.shadowRoot.querySelector('.badge')
      .textContent.includes('Not slop'),
  );
  assert.equal(await popup.locator('#attribution').innerText(), 'Powered by EvoLink Luna Decision');
  assert.equal(await badge(4).getAttribute('title'), 'Open Slop Detector settings');
  assert.ok(
    (await worker.evaluate(() => globalThis.__jevRequests)).some((r) =>
      r.questions.some(
        (q) => q.name === 'aiGenerated' && q.instructions === 'Is this a sales pitch?',
      ),
    ),
  );
  await popup.locator('#detector-gptzero').click();
  await feed.bringToFront();
  await feed.waitForFunction(
    () =>
      document.querySelector('#p4 jev-slop-label')?.shadowRoot.querySelector('.badge')
        .textContent === 'Free limit reached',
  );
  await popup.locator('#detector-jev').click();
  assert.equal(await popup.locator('#prompt').inputValue(), 'Is this a sales pitch?');
  assert.equal(calls.length, 3);
  console.log(
    'PASS: explicit EvoLink switch works after GPTZero quota, retains custom prompt/key and keeps caches isolated',
  );

  await worker.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.__directCalls = [];
    globalThis.__directStatus = 200;
    globalThis.fetch = async (url, init) => {
      if (String(url) !== 'https://api.gptzero.me/v2/predict/text') return original(url, init);
      const headers = new Headers(init.headers);
      globalThis.__directCalls.push({
        body: JSON.parse(init.body),
        headers: Object.fromEntries(headers),
        credentials: init.credentials,
        redirect: init.redirect,
      });
      const status =
        headers.get('x-api-key') === 'bad-personal-key' ? 401 : globalThis.__directStatus;
      if (status !== 200)
        return new Response('Do not display this upstream error', {
          status,
          headers: { 'Retry-After': '120' },
        });
      return Response.json({
        documents: [
          {
            document_classification: 'MIXED',
            class_probabilities: { human: 0, mixed: 0.98, ai: 0.02 },
          },
        ],
      });
    };
  });
  await popup.locator('#detector-gptzero').click();
  await popup.locator('#gptzero-source').selectOption('personal');
  await popup.locator('#gptzero-key').fill('user-personal-gptzero-key');
  await worker.evaluate(() => {
    globalThis.__denyNextPermission = true;
  });
  await popup.locator('#gptzero-connect').click();
  await popup.waitForFunction(() =>
    document.querySelector('#message').textContent.includes('not granted'),
  );
  assert.equal(await worker.evaluate(() => globalThis.__directCalls.length), 0);
  const proxyCount = incoming.length;
  await popup.locator('#gptzero-connect').click();
  await popup.waitForFunction(
    () => document.querySelector('#gptzero-key-status').textContent === 'Connected',
  );
  await feed.bringToFront();
  await feed.waitForFunction(() =>
    document
      .querySelector('#p4 jev-slop-label')
      ?.shadowRoot.querySelector('.badge')
      .textContent.includes('98%'),
  );
  assert.equal(
    await feed.locator('#p4 jev-slop-stamp').count(),
    0,
    'Personal GPTZero mixed scores must not be stamped',
  );
  assert.equal(
    incoming.length,
    proxyCount,
    'Personal key validation and scoring must bypass the proxy',
  );
  const directCalls = await worker.evaluate(() => globalThis.__directCalls);
  assert.equal(
    directCalls.length,
    2,
    'One connection check and one formerly quota-blocked visible item',
  );
  for (const call of directCalls) {
    assert.deepEqual(Object.keys(call.body), ['document']);
    assert.deepEqual(Object.keys(call.headers).sort(), ['accept', 'content-type', 'x-api-key']);
    assert.equal(call.headers['x-api-key'], 'user-personal-gptzero-key');
    assert.equal(call.credentials, 'omit');
    assert.equal(call.redirect, 'error');
  }
  await popup.reload();
  await popup.waitForFunction(
    () => document.querySelector('#gptzero-key-status').textContent === 'Connected',
  );
  assert.equal(await popup.locator('#gptzero-source').inputValue(), 'personal');
  assert.equal(await popup.locator('#gptzero-plan').innerText(), 'Your key');
  assert.equal(await popup.locator('#gptzero-usage').isVisible(), false);
  assert.equal(await popup.locator('#gptzero-key').inputValue(), '');
  await popup.locator('#gptzero-connection summary').click();
  await popup.locator('#gptzero-key').fill('bad-personal-key');
  await popup.locator('#gptzero-connect').click();
  await popup.waitForFunction(
    () => document.querySelector('#message').textContent === 'Check your GPTZero API key.',
  );
  assert.equal(
    (await worker.evaluate(() => chrome.storage.local.get('keys'))).keys.gptzero,
    'user-personal-gptzero-key',
  );
  assert.equal(
    incoming.length,
    proxyCount,
    'Reopening the popup in personal mode must not contact the proxy',
  );
  await popup.locator('body').screenshot({ path: 'test-results/popup-gptzero-personal.png' });

  await worker.evaluate(() => {
    globalThis.__directStatus = 429;
  });
  await feed.evaluate(() => {
    document.querySelector('#p4 [data-testid="tweetText"]').textContent =
      'A new visible item to test the direct rate limit.';
  });
  await feed.waitForFunction(() =>
    document
      .querySelector('#p4 jev-slop-label')
      ?.shadowRoot.querySelector('.badge')
      .textContent.includes('Couldn’t rate'),
  );
  const rateLimitedCount = await worker.evaluate(() => globalThis.__directCalls.length);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(
    await worker.evaluate(() => globalThis.__directCalls.length),
    rateLimitedCount,
    'Retry-After must stop immediate retries',
  );
  await popup.locator('#gptzero-source').selectOption('free');
  await feed.bringToFront();
  await feed.waitForFunction(
    () =>
      document.querySelector('#p4 jev-slop-label')?.shadowRoot.querySelector('.badge')
        .textContent === 'Free limit reached',
  );
  assert.equal(
    await worker.evaluate(() => globalThis.__directCalls.length),
    rateLimitedCount,
    'Free mode never silently spends a saved personal key',
  );
  assert.equal(calls.length, 3, 'Personal scanning never resets the free allowance');
  console.log(
    'PASS: personal key resumes exhausted free scanning directly, persists safely, handles bad keys/rate limits, and never becomes an automatic paid fallback',
  );
  assert.deepEqual(errors, []);
} finally {
  await context?.close();
  if (server)
    await new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    });
  await mf?.dispose();
  await rm(temp, { recursive: true, force: true });
  await rm('dist-test', { recursive: true, force: true });
}
