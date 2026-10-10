import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { mockPermissionPrompts } from './browser-permissions.mjs';

// Use the packaged extension and SDK, mocking provider transport and permission dialogs.
const profile = await mkdtemp(path.join(tmpdir(), 'jev-viewport-test-'));
const extension = path.resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1000, height: 600 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
context.setDefaultTimeout(8000);
const errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const xPost = (id, top, text) =>
  `<article id="p${id}" data-testid="tweet" style="position:absolute;top:${top}px;width:600px"><a href="/test/status/${id}"><time>Today</time></a><div data-testid="tweetText">${text}</div></article>`;
const liText = (text) => `<p><span data-testid="expandable-text-box">${text}</span></p>`;
const html = (body, scroll = 0) =>
  `<!doctype html><html><head><style>body{margin:0;min-height:5000px;font:16px sans-serif}p{margin:0;line-height:24px}article>a{display:none}</style></head><body>${body}<script>scrollTo(0,${scroll})</script></body></html>`;
try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  await mockPermissionPrompts(context, worker, extensionId);
  await worker.evaluate(() => {
    globalThis.__requests = [];
    globalThis.__held = [];
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://ai-gateway.vercel.sh/'))
        throw new Error('Unexpected network host');
      const data = JSON.parse(init.body);
      globalThis.__requests.push(data.state);
      if (data.state.startsWith('Held visible'))
        await new Promise((resolve) => globalThis.__held.push(resolve));
      return Response.json({
        answers: { aiGenerated: { type: 'boolean', probability: 0.12 } },
        usage: { inputTokens: 100, outputTokens: 0 },
      });
    };
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#detector-jev').click();
  await popup.waitForFunction(
    () => document.querySelector('#detector-jev').getAttribute('aria-pressed') === 'true',
  );
  await popup.waitForFunction(() => !document.querySelector('#connect').disabled);
  await popup.locator('#api-key').fill('viewport-test-key');
  await popup.locator('#connect').click();
  await popup.waitForFunction(
    () => document.querySelector('#key-status').textContent === 'Connected',
  );
  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'saveSettings', settings: { theme: 'stamp' } }),
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  let fixture = '';
  await context.route(/^https:\/\/(x\.com|www\.linkedin\.com)\//, (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
  const open = async (host, body, scroll = 0) => {
    fixture = html(body, scroll);
    await page.goto(`https://${host}/feed/viewport-test`);
    await page.locator('jev-slop-label').first().waitFor();
  };
  const requests = () => worker.evaluate(() => globalThis.__requests);
  const waitRequest = async (text) => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if ((await requests()).includes(text)) return;
      await sleep(50);
    }
    assert.fail(`No request for: ${text}`);
  };
  const notRequested = async (...texts) => {
    const sent = await requests();
    for (const text of texts) assert.ok(!sent.includes(text), `Offscreen item was sent: ${text}`);
  };

  await open(
    'x.com',
    xPost(1, 20, 'The visible X post.') + xPost(2, 720, 'The X post below the viewport.'),
  );
  await waitRequest('The visible X post.');
  await sleep(500);
  await notRequested('The X post below the viewport.');
  await page.evaluate(() => scrollTo(0, 650));
  await waitRequest('The X post below the viewport.');
  console.log('PASS: X posts inside the former 250px lookahead stay unrated until visible');

  // Both parent containers intersect the viewport, but only the reply's own text does.
  await open(
    'www.linkedin.com',
    `<div role="listitem" componentkey="update-card-focusViewport" style="height:2400px">
    ${liText('An offscreen LinkedIn parent post.')}
    <div class="comments-comment-item" style="position:relative;top:80px;height:1800px">
      ${liText('An offscreen LinkedIn parent comment.')}
      <div class="comments-comment-item" style="position:absolute;top:600px">${liText('The visible LinkedIn nested reply.')}</div>
    </div></div>`,
    650,
  );
  await waitRequest('The visible LinkedIn nested reply.');
  await sleep(500);
  await notRequested('An offscreen LinkedIn parent post.', 'An offscreen LinkedIn parent comment.');
  await page.evaluate(() => scrollTo(0, 0));
  await waitRequest('An offscreen LinkedIn parent post.');
  await waitRequest('An offscreen LinkedIn parent comment.');
  console.log(
    'PASS: LinkedIn parent posts and comments wait for their own text, independent of visible replies',
  );

  await open(
    'www.linkedin.com',
    `<div id="scroller" style="position:absolute;top:40px;height:160px;width:650px;overflow:auto">
    <div style="height:800px"><div role="listitem" componentkey="update-card-focusClipped" style="position:relative;top:250px">${liText('The clipped LinkedIn post.')}</div></div></div>`,
  );
  await sleep(700);
  await notRequested('The clipped LinkedIn post.');
  await page.evaluate(() => {
    document.querySelector('#scroller').scrollTop = 200;
  });
  await waitRequest('The clipped LinkedIn post.');
  console.log('PASS: nested scroll containers cannot trigger checks for clipped text');

  await open(
    'x.com',
    xPost(10, 20, 'Held visible first post.') +
      xPost(11, 120, 'Held visible second post.') +
      xPost(12, 220, 'Held visible third post.') +
      xPost(13, 320, 'Queued post scrolled out of view.') +
      xPost(14, 2420, 'The destination after scrolling.'),
  );
  await waitRequest('Held visible third post.');
  await notRequested('Queued post scrolled out of view.');
  await page.evaluate(() => scrollTo(0, 2350));
  await worker.evaluate(() =>
    globalThis.__held.splice(0).forEach((resolve) => {
      resolve();
    }),
  );
  await waitRequest('The destination after scrolling.');
  await sleep(500);
  await notRequested('Queued post scrolled out of view.');
  await page.evaluate(() => scrollTo(0, 0));
  await waitRequest('Queued post scrolled out of view.');
  console.log('PASS: releasing busy request slots skips queued items that have scrolled away');

  await open(
    'x.com',
    xPost(20, 20, 'A post passed too quickly to read.') +
      xPost(21, 2420, 'The post where scrolling stops.'),
  );
  await page.evaluate(() => scrollTo(0, 2350));
  await waitRequest('The post where scrolling stops.');
  await notRequested('A post passed too quickly to read.');
  await page.evaluate(() => scrollTo(0, 0));
  await waitRequest('A post passed too quickly to read.');
  console.log('PASS: posts scrolled past before the dwell delay are skipped and checked on return');

  // Force the isolated world's visibility flag: headless Chromium does not hide background tabs.
  const cdp = await context.newCDPSession(page);
  const worlds = [];
  cdp.on('Runtime.executionContextCreated', (event) => worlds.push(event.context));
  await cdp.send('Runtime.enable');
  const world = worlds.find(
    (value) => value.name === extensionId || value.origin === `chrome-extension://${extensionId}`,
  );
  assert.ok(world);
  const content = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      contextId: world.id,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await content(
    `Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));`,
  );
  await page.locator('#p20 [data-testid="tweetText"]').evaluate((node) => {
    node.textContent = 'An updated post in a background tab.';
  });
  await sleep(700);
  await notRequested('An updated post in a background tab.');
  await content(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));`);
  await waitRequest('An updated post in a background tab.');
  console.log('PASS: hidden tabs stay idle until visible again');

  // Exercise the busy/retry path without waiting for a provider's minute-long cooldown.
  await content(`globalThis.viewportSend = chrome.runtime.sendMessage.bind(chrome.runtime); globalThis.viewportAttempts = 0; chrome.runtime.sendMessage = message => {
    if (message.type === 'classify' && message.post.text === 'A deferred retry scrolled away.') {
      globalThis.viewportAttempts++;
      if (globalThis.viewportAttempts === 1) return Promise.resolve({ status: 'busy', retryAfter: 600 });
    }
    return globalThis.viewportSend(message);
  };`);
  await page.locator('#p20 [data-testid="tweetText"]').evaluate((node) => {
    node.textContent = 'A deferred retry scrolled away.';
  });
  for (let attempt = 0; attempt < 160 && !(await content('globalThis.viewportAttempts')); attempt++)
    await sleep(50);
  assert.equal(await content('globalThis.viewportAttempts'), 1);
  await page.evaluate(() => scrollTo(0, 2350));
  await sleep(1100);
  assert.equal(await content('globalThis.viewportAttempts'), 1);
  await notRequested('A deferred retry scrolled away.');
  await page.evaluate(() => scrollTo(0, 0));
  await waitRequest('A deferred retry scrolled away.');
  console.log('PASS: deferred retries also wait until the item is back in view');

  // Root overflow scrolls the viewport, not a second clipping box that moves
  // offscreen with the page. X uses a scrolling root around its virtual feed.
  await open(
    'x.com',
    `<style>html{overflow-y:scroll}</style>` +
      xPost(30, 820, 'A visible reply after scrolling the document.') +
      xPost(31, 20, 'A reply above the scrolled viewport.'),
    750,
  );
  await waitRequest('A visible reply after scrolling the document.');
  await notRequested('A reply above the scrolled viewport.');
  assert.match(await page.locator('#p30 jev-slop-label button.badge').innerText(), /Not slop/);
  console.log('PASS: a scrolling document root does not strand visible replies in the queue');

  await open(
    'x.com',
    `<style>body{height:0;min-height:0;overflow-y:scroll}</style>` +
      xPost(32, 820, 'A visible reply with viewport overflow on body.') +
      xPost(33, 1720, 'A reply below the body scrolling viewport.'),
    750,
  );
  await waitRequest('A visible reply with viewport overflow on body.');
  await notRequested('A reply below the body scrolling viewport.');
  console.log('PASS: body overflow propagated to the viewport does not clip visible replies');

  // Body can still be a real nested scroller when root overflow is explicit.
  await open(
    'x.com',
    `<style>html{overflow:hidden}body{position:relative;height:160px;min-height:0;overflow:auto}</style>` +
      xPost(34, 250, 'A reply clipped by an actual body scroll container.'),
  );
  await sleep(700);
  await notRequested('A reply clipped by an actual body scroll container.');
  await page.evaluate(() => {
    document.body.scrollTop = 200;
  });
  await waitRequest('A reply clipped by an actual body scroll container.');
  console.log('PASS: a body element acting as a real nested scroller still clips offscreen text');

  await open(
    'x.com',
    `<div style="display:contents;overflow:hidden">${xPost(35, 20, 'Visible text inside a wrapper without a layout box.')}</div>`,
  );
  await waitRequest('Visible text inside a wrapper without a layout box.');
  console.log('PASS: display:contents wrappers do not incorrectly block visible text');

  assert.deepEqual(errors, []);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
