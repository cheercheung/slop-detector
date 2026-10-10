import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { afterEach, test, vi } from 'vitest';
import type { PopupRequest } from '../src/messages';
import type { GptzeroUsage } from '../src/shared';
import { DEFAULT_SETTINGS, EMPTY_STATS, type Settings } from '../src/shared';

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
    async refresh() {
      vi.advanceTimersByTime(2000);
      await settle();
    },
  };
}

test('fresh install can grant GPTZero access without changing detector tabs', async () => {
  const p = await popup();
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
  const p = await popup();
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
  const p = await popup({}, { permissionGranted: true, connected: true, available: true });
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
  const p = await popup({ enabled: false });
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
  const personal = await popup({ gptzeroSource: 'personal' });
  assert.equal(personal.control('gptzero-access').hidden, true);
  assert.equal(personal.control('gptzero-connection').open, true);
  const unavailable = await popup(
    {},
    { permissionGranted: false, connected: false, available: false },
  );
  assert.equal(unavailable.control('gptzero-access').hidden, true);
});
