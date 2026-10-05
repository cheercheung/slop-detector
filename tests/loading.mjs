import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mockPermissionPrompts } from './browser-permissions.mjs';

const profile = await mkdtemp(path.join(tmpdir(), 'jev-loading-test-'));
const extension = path.resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 900, height: 800 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
context.setDefaultTimeout(8000);
await mkdir('test-results', { recursive: true });
const geometry = () => Object.fromEntries(['one', 'two', 'actions-one', 'actions-two', 'after'].map(id => {
  const box = document.getElementById(id).getBoundingClientRect();
  return [id, { y: box.y, height: box.height }];
}));
const sameGeometry = (actual, expected, message) => {
  for (const id of Object.keys(expected)) for (const property of ['y', 'height']) {
    assert.ok(Math.abs(actual[id][property] - expected[id][property]) < 0.1, `${message}: ${id}.${property} changed from ${expected[id][property]} to ${actual[id][property]}`);
  }
};
const fixture = (site, layout, key) => {
  const item = (id, text) => site === 'x'
    ? `<article id="${id}" data-testid="tweet"><div class="column"><div class="author">Jamie Brooks <span>@jamie · 2h</span><a href="/jamie/status/${id === 'one' ? 1 : 2}"><time>Today</time></a></div><div class="text" data-testid="tweetText">${text}</div><div class="actions" id="actions-${id}">Reply &nbsp; · &nbsp; Repost &nbsp; · &nbsp; Like</div></div></article>`
    : `<div id="${id}" class="${id === 'one' ? 'feed-shared-update-v2' : 'comments-comment-item'}" data-urn="urn:li:${id === 'one' ? 'activity:100' : 'comment:(activity:100,101)'}"><div class="column"><div class="author">Jamie Brooks <span>· Engineer</span></div><p class="text"><span data-testid="expandable-text-box">${text}</span></p><div class="actions" id="actions-${id}">Like &nbsp; · &nbsp; Reply</div></div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;color:#252525;background:#fafafa;font:15px/1.5 sans-serif}main{width:560px;margin:32px auto}article,.feed-shared-update-v2,.comments-comment-item{background:white;border:1px solid #eee;margin:0 0 16px;padding:20px 0}.author,.actions{padding:0 24px}.author{font-weight:600}.author span{font-weight:400;color:#888}.author a{display:none}.text{padding:0 24px;margin:10px 0 12px}.actions{font-size:12px;color:#888;margin-top:16px}.column{${layout === 'flex' ? 'display:flex;flex-direction:column;gap:12px' : ''}}#two{margin-left:24px}#after{padding:16px 24px;color:#999}#offscreen{margin-top:1200px}
    ${layout === 'positioned' ? '.column{position:relative;transform:translate3d(5px,3px,0)}.text{overflow:hidden}' : ''}
    </style></head><body><main><div id="inserted" style="height:0"></div>${item('one', `I measured query latency: 42 ms before, 18 ms with the new index. ${key}`)}${item('two', `Did you also compare the query plan? ${key}`)}<div id="after">The next post stays in place.</div><div id="offscreen">${item('offscreen-post', `A post waiting below the screen. ${key}`)}</div></main><script>window.beforeLabels = (${geometry.toString()})()</script></body></html>`;
};
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  await mockPermissionPrompts(context, worker, extensionId);
  await worker.evaluate(() => {
    globalThis.__held = [];
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://ai-gateway.vercel.sh/')) throw new Error('Unexpected provider host');
      const { state } = JSON.parse(init.body);
      if (!state.startsWith('The library closes')) await new Promise(resolve => globalThis.__held.push(resolve));
      return Response.json({ answers: { aiGenerated: { type: 'boolean', probability: 0.12 } }, usage: { inputTokens: 100, outputTokens: 0 } });
    };
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#detector-jev').click();
  await popup.waitForFunction(() => document.querySelector('#detector-jev').getAttribute('aria-pressed') === 'true');
  await popup.waitForFunction(() => !document.querySelector('#connect').disabled);
  await popup.locator('#api-key').fill('loading-test-key');
  await popup.locator('#connect').click();
  await popup.waitForFunction(() => document.querySelector('#key-status').textContent === 'Connected');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let body = '';
  await context.route(/^https:\/\/(x\.com|www\.linkedin\.com)\//, route => route.fulfill({ contentType: 'text/html', body }));
  for (const site of ['x', 'linkedin']) for (const layout of ['block', 'flex', 'positioned']) for (const showNotSlop of [false, true]) {
    await popup.evaluate(showNotSlop => chrome.runtime.sendMessage({ type: 'saveSettings', settings: { showNotSlop, theme: 'stamp' } }), showNotSlop);
    const key = `${site}-${layout}-${showNotSlop}`;
    body = fixture(site, layout, key);
    await page.goto(`https://${site === 'x' ? 'x.com' : 'www.linkedin.com'}/feed/loading-test`);
    await page.waitForFunction(() => ['one', 'two'].every(id => document.querySelector(`#${id} jev-slop-label`)?.hasAttribute('data-scanning')));
    await page.evaluate(() => document.fonts.ready);
    const pending = await page.evaluate(geometry);
    const baseline = await page.evaluate(() => window.beforeLabels);
    if (!showNotSlop) sameGeometry(pending, baseline, `${key} adding radar`);
    const state = await page.locator('#one jev-slop-label').evaluate(host => {
      const button = host.shadowRoot.querySelector('.badge');
      const radar = host.shadowRoot.querySelector('.radar');
      const title = host.shadowRoot.querySelector('.label-text');
      return {
        animation: getComputedStyle(radar.querySelector('.radar-sweep')).animationName,
        color: getComputedStyle(button).color, border: getComputedStyle(button).borderTopWidth,
        titleWidth: title.getBoundingClientRect().width, label: button.getAttribute('aria-label'),
        position: getComputedStyle(host).position, height: host.getBoundingClientRect().height,
        radarBox: radar.getBoundingClientRect().toJSON(), textBox: document.querySelector('#one .text').getBoundingClientRect().toJSON(),
      };
    });
    assert.equal(state.animation, 'radar-sweep');
    assert.equal(state.border, '0px');
    assert.equal(state.titleWidth, 1, 'Loading copy is accessible without appearing in the feed');
    assert.equal(state.label, 'Checking with Jev');
    assert.equal(state.position, showNotSlop ? 'relative' : 'absolute');
    assert.equal(state.height, showNotSlop ? 24 : 0);
    assert.ok(state.radarBox.x >= state.textBox.x && state.radarBox.right <= state.textBox.right);
    if (!showNotSlop) {
      assert.ok(Math.abs(state.radarBox.x - state.textBox.x - 26) < 0.1, 'Floating radar aligns with the start of the padded text column');
      assert.ok(Math.abs(state.radarBox.y - state.textBox.bottom - 3) < 0.1, `Floating radar sits immediately below the text: gap ${state.radarBox.y - state.textBox.bottom}`);
    }
    // A banner, image or preceding post can change height without resizing this
    // post or firing a scroll event. The radar must move with its own text.
    const radarOffset = () => ['one', 'two'].map(id => {
      const text = document.querySelector(`#${id} .text`).getBoundingClientRect();
      const radar = document.querySelector(`#${id} jev-slop-label`).shadowRoot.querySelector('.radar').getBoundingClientRect();
      return { x: radar.x - text.x, y: radar.y - text.bottom };
    });
    const beforeMoving = await page.evaluate(radarOffset);
    await page.evaluate(async () => {
      document.querySelector('#inserted').style.height = '96px';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const afterMoving = await page.evaluate(radarOffset);
    afterMoving.forEach((offset, index) => {
      assert.ok(Math.abs(offset.x - beforeMoving[index].x) < 0.1, 'Radar must stay horizontally attached to its text');
      assert.ok(Math.abs(offset.y - beforeMoving[index].y) < 0.1, 'Radar must follow its text when the feed moves without scrolling');
    });
    await page.evaluate(() => { document.querySelector('#inserted').style.height = '0'; });
    const queuedAnimation = await page.locator('#offscreen-post jev-slop-label .radar-sweep').evaluate(node => getComputedStyle(node).animationName);
    assert.equal(queuedAnimation, 'none', 'Queued posts should not animate');
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    assert.equal(await page.locator('#one jev-slop-label .radar-sweep').evaluate(node => getComputedStyle(node).animationName), 'none');
    const darkColor = await page.locator('#one jev-slop-label .badge').evaluate(node => getComputedStyle(node).color);
    assert.notEqual(darkColor, state.color);
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
    if (layout === 'block') await page.screenshot({ path: `test-results/loading-${site}-${showNotSlop ? 'row' : 'floating'}.png` });
    await worker.evaluate(() => globalThis.__held.splice(0).forEach(resolve => resolve()));
    await page.waitForFunction(() => ['one', 'two'].every(id => document.querySelector(`#${id} jev-slop-label`)?.dataset.tone === 'clean'));
    sameGeometry(await page.evaluate(geometry), pending, `${key} replacing radar with result`);
    assert.equal(await page.locator('#one jev-slop-label').evaluate(host => host.hidden), !showNotSlop);
    assert.equal(await page.locator('#one [data-jev-radar-anchor], #two [data-jev-radar-anchor]').count(), 0, 'Finished checks release their temporary positioning anchors');
    console.log(`PASS: ${key} radar → Not slop causes no height or position changes`);
  }
  assert.deepEqual(errors, []);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
