import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { afterEach, test, vi } from 'vitest';
import type { PopupRequest } from '../src/messages';
import type { GptzeroUsage } from '../src/shared';
import { DEFAULT_SETTINGS, EMPTY_STATS, EVOLINK_KEY_URL, type Settings } from '../src/shared';

vi.mock('../src/gptzero-config', () => ({
  GPTZERO_PROXY_ORIGIN: 'https://proxy.example.test/*',
  GPTZERO_API_ORIGIN: 'https://api.gptzero.me/*',
}));
const proxy = 'https://proxy.example.test';
const html = await readFile(new URL('../public/popup.html', import.meta.url), 'utf8');
const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const settle = async () => {
  await setImmediate();
  await setImmediate();
};
async function popup(
  patch: Partial<Settings> = {},
  initial = { permissionGranted: false, connected: false, available: true },
) {
  vi.resetModules();
  const dom = new JSDOM(html);
  windows.push(dom);
  const control = (id: string) => {
    const element = dom.window.document.getElementById(id) as HTMLButtonElement &
      HTMLDetailsElement;
    assert.ok(element, `Missing popup control: ${id}`);
    return element;
  };
  vi.stubGlobal('document', dom.window.document);
  const state = {
    settings: { ...DEFAULT_SETTINGS, ...patch },
    zero: {
      ...initial,
      personalKeySaved: false,
      personalPermissionGranted: false,
      usage: null as GptzeroUsage | null,
    },
    grant: true,
    connectionError: '',
    connections: 0,
    inGesture: false,
    requests: [] as string[][],
  };
  const publicSettings = () => ({
    ...state.settings,
    cacheEpoch: 0,
    configured:
      state.settings.detector === 'gptzero' &&
      state.settings.gptzeroSource === 'free' &&
      state.zero.connected &&
      state.zero.permissionGranted,
  });
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.stubGlobal('chrome', {
    permissions: {
      request: ({ origins }: { origins: string[] }) => {
        assert.equal(state.inGesture, true, 'Permission prompt needs the original click gesture');
        state.requests.push([...origins]);
        if (state.grant) state.zero.permissionGranted = true;
        return Promise.resolve(state.grant);
      },
    },
    runtime: {
      sendMessage: async (message: PopupRequest) => {
        switch (message.type) {
          case 'getDashboard':
            return structuredClone({
              settings: publicSettings(),
              gptzero: state.zero,
              stats: EMPTY_STATS,
              keyStatus: {},
              permissionStatus: {},
              connectionCheck: null,
              connectionResult: null,
              gptzeroConnecting: false,
            });
          case 'refreshGptzeroUsage':
            return {};
          case 'connectGptzero':
            assert.equal(
              state.zero.permissionGranted,
              true,
              'Never contact the proxy before permission',
            );
            state.connections++;
            if (state.connectionError) return { error: state.connectionError };
            state.zero.connected = true;
            state.zero.usage = {
              used: 0,
              remaining: 1000,
              limit: 1000,
              resetsAt: Date.now() + 86400000,
            };
            return { ok: true };
          case 'saveSettings':
            Object.assign(state.settings, message.settings);
            return { settings: structuredClone(publicSettings()) };
          default:
            throw new Error(`Unexpected popup message: ${message.type}`);
        }
      },
    },
  });
  await import('../src/popup');
  await settle();
  return {
    state,
    control,
    async click(id: string) {
      const element = control(id);
      assert.equal(element.hidden || element.disabled, false, `${id} must be actionable`);
      state.inGesture = true;
      element.dispatchEvent(new dom.window.Event('click'));
      state.inGesture = false;
      await settle();
    },
    async change(id: string, value: string) {
      const element = control(id);
      element.value = value;
      element.dispatchEvent(new dom.window.Event('change'));
      await settle();
    },
    async refresh() {
      vi.advanceTimersByTime(2000);
      await settle();
    },
  };
}

test('GPTZero tab can grant access without changing detector tabs', async () => {
  const p = await popup({ detector: 'gptzero' });
  assert.equal(p.control('detector-gptzero').getAttribute('aria-pressed'), 'true');
  assert.equal(p.control('gptzero-access').textContent, 'Allow GPTZero access');
  assert.equal(
    p.state.requests.length,
    0,
    'Opening settings must not request permission without a click',
  );
  assert.equal(p.state.connections, 0);
  assert.equal(p.control('appearance-section').inert, true);
  await p.click('gptzero-access');
  assert.equal(p.control('appearance-section').inert, false);
  assert.deepEqual(p.state.requests, [[`${proxy}/*`]], 'Only request the selected free service');
  assert.equal(p.state.connections, 1);
  assert.equal(p.control('gptzero-access').hidden, true);
  assert.equal(p.state.settings.enabled, true);
  assert.equal(p.control('gptzero-usage').hidden, false);
  await p.refresh();
  assert.equal(p.state.connections, 1, 'Dashboard refresh must not reconnect');
});

test('denied permission and failed setup remain retryable on the selected GPTZero tab', async () => {
  const p = await popup({ detector: 'gptzero' });
  p.state.grant = false;
  await p.click('gptzero-access');
  assert.equal(p.state.connections, 0);
  assert.match(p.control('message').textContent, /not granted/);
  assert.equal(p.control('gptzero-access').hidden, false);
  p.state.grant = true;
  p.state.connectionError = 'GPTZero unavailable.';
  await p.click('gptzero-access');
  assert.equal(p.control('gptzero-access').textContent, 'Connect GPTZero');
  assert.equal(p.control('gptzero-access').disabled, false);
  p.state.connectionError = '';
  await p.click('gptzero-access');
  assert.equal(p.control('gptzero-access').hidden, true);
  assert.equal(p.control('message').hidden, true);
});

test('revoked free access can be restored without re-registering the installation', async () => {
  const p = await popup(
    { detector: 'gptzero' },
    { permissionGranted: true, connected: true, available: true },
  );
  assert.equal(p.control('gptzero-access').hidden, true);
  p.state.zero.permissionGranted = false;
  await p.refresh();
  assert.equal(p.control('gptzero-access').hidden, false);
  await p.click('gptzero-access');
  assert.equal(p.state.requests.length, 1);
  assert.equal(p.state.connections, 0);
  assert.equal(p.control('gptzero-access').hidden, true);
});

test('enabling GPTZero requests access; pausing and Jev do not', async () => {
  const p = await popup({ enabled: false, detector: 'gptzero' });
  p.state.grant = false;
  await p.click('enabled');
  assert.equal(p.state.settings.enabled, false, 'Denied access must not turn scanning on');
  p.state.grant = true;
  await p.click('enabled');
  assert.equal(p.state.settings.enabled, true);
  assert.equal(p.control('gptzero-access').hidden, true);
  await p.click('enabled');
  assert.equal(p.state.settings.enabled, false);
  assert.equal(p.state.requests.length, 2, 'Pausing must not ask for permission');
  await p.click('detector-jev');
  await p.click('enabled');
  assert.equal(p.state.requests.length, 2, 'Jev must not request GPTZero access');
});

test('GPTZero tab still connects directly, and personal-key mode has no free access button', async () => {
  const p = await popup({ detector: 'jev' });
  await p.click('detector-gptzero');
  assert.equal(p.state.settings.detector, 'gptzero');
  assert.equal(p.state.connections, 1);
  assert.equal(p.control('gptzero-access').hidden, true);
  const personal = await popup({ detector: 'gptzero', gptzeroSource: 'personal' });
  assert.equal(personal.control('gptzero-access').hidden, true);
  assert.equal(personal.control('gptzero-connection').open, true);
  const unavailable = await popup(
    { detector: 'gptzero' },
    { permissionGranted: false, connected: false, available: false },
  );
  assert.equal(unavailable.control('gptzero-access').hidden, true);
});

test('Luna selection identifies its own provider without making a connection request', async () => {
  const { control, state } = await popup({ detector: 'jev', provider: 'evolink' });
  assert.equal(control('attribution').textContent, 'Powered by EvoLink Luna Decision');
  assert.equal(control('attribution').getAttribute('href'), EVOLINK_KEY_URL);
  assert.equal(control('get-key').getAttribute('href'), EVOLINK_KEY_URL);
  assert.match(control('key-label').textContent ?? '', /EvoLink Luna Decision/);
  assert.equal(state.connections, 0);
  assert.deepEqual(state.requests, []);
});

test('custom threshold and language persist, preserve key drafts, and never connect a provider', async () => {
  const p = await popup({ detector: 'jev' });
  assert.equal(p.state.settings.provider, 'evolink');
  p.control('api-key').value = 'local-draft-placeholder';
  await p.change('language', 'zh-CN');
  assert.equal(p.state.settings.language, 'zh-CN');
  assert.equal(p.control('detector-jev').textContent, '决策模型');
  assert.equal(p.control('connect').textContent, '连接');
  assert.equal(p.control('api-key').value, 'local-draft-placeholder');
  await p.change('threshold-number', '31');
  assert.equal(p.state.settings.threshold, 0.31);
  assert.equal(p.control('threshold').value, '31');
  assert.match(p.control('threshold-rule').textContent ?? '', /≥ 31%/);
  await p.refresh();
  assert.equal(p.control('threshold-number').value, '31');
  for (const invalid of ['', '-1', '101', '3.5']) {
    await p.change('threshold-number', invalid);
    assert.equal(p.state.settings.threshold, 0.31);
    assert.match(p.control('message').textContent ?? '', /0 到 100/);
  }
  await p.change('threshold', '0');
  assert.equal(p.state.settings.threshold, 0);
  await p.change('threshold-number', '100');
  assert.equal(p.state.settings.threshold, 1);
  await p.click('reset-threshold');
  assert.equal(p.state.settings.threshold, 0.7);
  assert.equal(p.control('threshold-number').value, '70');
  await p.change('language', 'en');
  assert.equal(p.control('detector-jev').textContent, 'Decision model');
  assert.equal(p.control('connect').textContent, 'Connect');
  assert.equal(p.control('api-key').value, 'local-draft-placeholder');
  assert.equal(p.state.connections, 0);
  assert.deepEqual(p.state.requests, []);
});
