import assert from 'node:assert/strict';
import { test } from 'vitest';
import { PROVIDER_ORIGINS } from '../src/shared';
import { mockPermissions } from './permissions-fixture';

test('migrates legacy keys, serializes settings and restricts credential access', async () => {
  const local: Record<string, unknown> = {
    apiKey: 'legacy-gateway-test-key',
    settings: { enabled: false, threshold: 0.8, dimSlop: true },
  };
  const session: Record<string, unknown> = {
    cache: [null, ['bad-key', {}], ['f'.repeat(64), { probability: 1.5, evaluatedAt: Date.now() }]],
  };
  const restrictions: string[] = [];
  const popupWindows: (number | undefined)[] = [];
  let popupUnavailable = false;
  let optionsOpened = 0;
  let listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (result: any) => void,
  ) => boolean;
  const area = (data: Record<string, unknown>, name: string) => ({
    setAccessLevel: async ({ accessLevel }: { accessLevel: string }) => {
      restrictions.push(`${name}:${accessLevel}`);
    },
    get: async () => ({ ...data }),
    set: async (values: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      Object.assign(data, values);
    },
    remove: async (key: string) => {
      delete data[key];
    },
  });
  globalThis.chrome = {
    action: {
      openPopup: async ({ windowId }: { windowId?: number }) => {
        popupWindows.push(windowId);
        if (popupUnavailable) throw new Error('Popup unavailable');
      },
    },
    permissions: mockPermissions(Object.values(PROVIDER_ORIGINS)),
    storage: { local: area(local, 'local'), session: area(session, 'session') },
    tabs: { query: async () => [], sendMessage: async () => {} },
    runtime: {
      id: 'test',
      getURL: (path: string) => `chrome-extension://test/${path}`,
      openOptionsPage: async () => {
        optionsOpened++;
      },
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
  } as unknown as typeof chrome;
  await import('../src/background.ts');
  const send = (message: unknown, content = false) =>
    new Promise<any>((resolve) =>
      listener(
        message,
        {
          id: 'test',
          url: content ? 'https://x.com/home' : 'chrome-extension://test/popup.html',
          frameId: 0,
          ...(content ? { tab: { id: 1, windowId: 42 } as chrome.tabs.Tab } : {}),
        },
        resolve,
      ),
    );
  const initial = await send({ type: 'getDashboard' });
  assert.deepEqual(restrictions, ['local:TRUSTED_CONTEXTS', 'session:TRUSTED_CONTEXTS']);
  assert.deepEqual(local.keys, { gateway: 'legacy-gateway-test-key' });
  assert.equal(local.apiKey, undefined);
  assert.equal(initial.settings.detector, 'jev');
  assert.equal(initial.settings.theme, 'fade');
  assert.equal(initial.settings.threshold, 0.8);
  assert.equal(initial.settings.configured, true);
  assert.equal(initial.cacheSize, 0);
  await Promise.all([
    send({ type: 'saveSettings', settings: { showScore: false } }),
    send({ type: 'saveSettings', settings: { prompt: 'Is this an advertisement?' } }),
  ]);
  const saved = await send({ type: 'getSettings' }, true);
  assert.equal(saved.showScore, false);
  assert.equal(saved.prompt, 'Is this an advertisement?');
  assert.equal(saved.keys, undefined);
  assert.equal(saved.apiKey, undefined);
  assert.deepEqual(await send({ type: 'openSettings' }, true), { ok: true });
  assert.deepEqual(popupWindows, [42]);
  assert.equal(optionsOpened, 0);
  popupUnavailable = true;
  assert.deepEqual(await send({ type: 'openSettings' }, true), { ok: true });
  assert.equal(optionsOpened, 1);
  const denied = await new Promise<any>((resolve) =>
    listener(
      { type: 'openSettings' },
      { id: 'test', url: 'https://example.com/', frameId: 0 },
      resolve,
    ),
  );
  assert.ok(denied.error);
  assert.equal(popupWindows.length, 2);
  assert.ok((await send({ type: 'saveSettings', settings: { provider: 'jev' } }, true)).error);
  assert.ok((await send({ type: 'getDashboard' }, true)).error);
  assert.ok((await send({ type: 'disconnect' }, true)).error);
  assert.ok((await send({ type: 'saveSettings', settings: { prompt: '' } })).error);
  assert.ok((await send({ type: 'saveSettings', settings: { prompt: 'x'.repeat(2001) } })).error);
  assert.equal((await send({ type: 'getSettings' })).prompt, saved.prompt);
  await send({ type: 'clearCache' });
  assert.ok((await send({ type: 'getSettings' })).cacheEpoch > saved.cacheEpoch);
  await send({ type: 'disconnect', provider: 'jev' });
  assert.deepEqual(local.keys, { gateway: 'legacy-gateway-test-key' });
});
