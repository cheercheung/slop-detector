import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

// Managed Chromium only. No user profile, real credentials, remote pages or model requests.
const profile = await mkdtemp(path.join(tmpdir(), 'slop-customization-'));
const extensionPath = path.resolve('dist');
let context;
const pageErrors = [];
const remaining = () =>
  execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(`--user-data-dir=${profile}`));
const deadline = setTimeout(() => {
  void context?.close();
}, 50_000);
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
    timeout: 15_000,
    locale: 'en-US',
    viewport: { width: 360, height: 850 },
    args: [
      '--disable-background-networking',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  context.setDefaultTimeout(7000);
  await context.route('https://**/*', async (route) => {
    if (route.request().url() === 'https://x.com/home') {
      await route.fulfill({
        contentType: 'text/html',
        body: await readFile('tests/feed.html', 'utf8'),
      });
    } else await route.abort();
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => {
    globalThis.__customizationRequests = 0;
    globalThis.fetch = async () => {
      globalThis.__customizationRequests++;
      throw new Error('No model requests allowed in this test');
    };
  });
  const popup = await context.newPage();
  popup.on('pageerror', (error) => pageErrors.push(error.message));
  const url = `chrome-extension://${extensionId}/popup.html`;
  await popup.goto(url);
  await popup.waitForFunction(() => document.querySelector('#provider').value === 'evolink');
  assert.equal(await popup.locator('#detector-jev').getAttribute('aria-pressed'), 'true');
  assert.equal(await popup.locator('#threshold-number').inputValue(), '70');
  assert.equal(await popup.locator('#threshold').inputValue(), '70');
  const keyLink =
    'https://evolink.ai/dashboard/keys?utm_source=github&utm_medium=extension&utm_campaign=slop';
  assert.deepEqual(
    await popup
      .locator('#provider option')
      .evaluateAll((options) => options.map((option) => option.value)),
    ['evolink', 'openrouter', 'jev'],
  );
  assert.equal(
    await popup.locator('#source-repository').getAttribute('href'),
    'https://github.com/rbilgil/slop-detector',
  );
  assert.equal(await popup.locator('#source-repository').isVisible(), true);
  assert.equal(await popup.locator('#get-key').getAttribute('href'), keyLink);
  assert.equal(await popup.locator('#attribution').getAttribute('href'), keyLink);
  await popup.locator('#language').selectOption('zh-CN');
  await popup.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal(await popup.locator('#connect').innerText(), '连接');
  await popup.locator('#threshold-number').fill('71');
  await popup.locator('#threshold-number').press('Tab');
  await popup.waitForFunction(() => document.querySelector('#threshold').value === '71');
  await popup.reload();
  await popup.waitForFunction(() => document.querySelector('#threshold-number').value === '71');
  assert.equal(await popup.locator('#language').inputValue(), 'zh-CN');
  await popup.locator('#reset-threshold').click();
  await popup.waitForFunction(() => document.querySelector('#threshold-number').value === '70');
  await popup.locator('#connection').evaluate((el) => {
    el.open = true;
  });
  await popup.locator('#prompt-section').evaluate((el) => {
    el.open = true;
  });
  await mkdir('test-results', { recursive: true });
  await popup.locator('body').screenshot({ path: 'test-results/customization-zh.png' });
  assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await popup.locator('#language').selectOption('en');
  await popup.waitForFunction(() => document.documentElement.lang === 'en');
  assert.equal(await popup.locator('#connect').innerText(), 'Connect');
  await popup.locator('body').screenshot({ path: 'test-results/customization-en.png' });

  // Isolate content rendering with synthetic settings/verdicts, through the actual bundled script.
  const feed = await context.newPage();
  feed.on('pageerror', (error) => pageErrors.push(error.message));
  await feed.addInitScript(() => {
    const state = {
      language: 'zh-CN',
      detector: 'jev',
      provider: 'evolink',
      gptzeroSource: 'free',
      enabled: true,
      configured: true,
      threshold: 0.7,
      theme: 'fade',
      showNotSlop: true,
      showScore: true,
      cacheEpoch: 0,
      prompt: 'Synthetic test prompt',
    };
    globalThis.__fixtureSettings = state;
    globalThis.__fixtureClassifications = 0;
    const listeners = [];
    globalThis.__fixtureListeners = listeners;
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => listeners.push(fn), removeListener: () => {} },
        sendMessage: async (message) => {
          if (message.type === 'getSettings') return { ...state };
          if (message.type === 'classify') {
            globalThis.__fixtureClassifications++;
            return {
              status: 'ok',
              verdict: {
                probability: message.post.text.includes('99%') ? 0.7 : 0.699,
                evaluatedAt: Date.now(),
                latencyMs: 1,
              },
            };
          }
          return { ok: true };
        },
      },
    };
  });
  // Only popup.html is opened in the real extension; feed content is injected once with a mock runtime.
  // Block automatic extension content injection by using a local test origin outside its permissions.
  await context.route('https://fixture.test/', async (route) =>
    route.fulfill({ contentType: 'text/html', body: await readFile('tests/feed.html', 'utf8') }),
  );
  await feed.setViewportSize({ width: 1160, height: 960 });
  await feed.goto('https://fixture.test/');
  await feed.addScriptTag({ content: await readFile('dist/content.js', 'utf8') });
  const badge = (id) => feed.locator(`#${id} jev-slop-label .badge`);
  await feed.waitForFunction(
    () => document.querySelector('#two jev-slop-label')?.dataset.tone === 'slop',
  );
  assert.match(await badge('two').innerText(), /Slop（低质内容）/);
  assert.match(await badge('one').innerText(), /非 Slop/);
  const before = await feed.evaluate(() => globalThis.__fixtureClassifications);
  await feed.evaluate(() => {
    globalThis.__fixtureSettings.threshold = 0.71;
    for (const fn of globalThis.__fixtureListeners)
      fn({ type: 'settingsChanged', settings: { ...globalThis.__fixtureSettings } });
  });
  await feed.waitForFunction(
    () => document.querySelector('#two jev-slop-label')?.dataset.tone === 'clean',
  );
  assert.equal(await feed.evaluate(() => globalThis.__fixtureClassifications), before);
  await feed.evaluate(() => {
    globalThis.__fixtureSettings.language = 'en';
    for (const fn of globalThis.__fixtureListeners)
      fn({ type: 'settingsChanged', settings: { ...globalThis.__fixtureSettings } });
  });
  await feed.waitForFunction(() =>
    document.querySelector('#two jev-slop-label')?.shadowRoot.textContent.includes('Not slop'),
  );
  assert.equal(await feed.evaluate(() => globalThis.__fixtureClassifications), before);
  assert.equal(await worker.evaluate(() => globalThis.__customizationRequests), 0);
  assert.deepEqual(pageErrors, []);
  console.log(
    'PASS: Luna defaults, UTM links, bilingual popup, threshold persistence/reset, inclusive 70% boundary, cached relabeling without API calls.',
  );
} finally {
  clearTimeout(deadline);
  await context?.close();
  for (let attempt = 0; attempt < 20 && remaining().length; attempt++) await delay(100);
  const leftovers = remaining();
  for (const line of leftovers) {
    const pid = Number(line.trim().split(/\s/)[0]);
    if (Number.isInteger(pid) && pid > 0) process.kill(pid, 'SIGKILL');
  }
  await rm(profile, { recursive: true, force: true });
  assert.deepEqual(leftovers, [], 'Test browser must exit without residual processes');
  console.log('CLEANUP: test browser closed; no profile-matching processes remain.');
}
