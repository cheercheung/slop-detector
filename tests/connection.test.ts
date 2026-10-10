import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test, vi } from 'vitest';
import { PROVIDER_ORIGINS } from '../src/shared';
import { mockPermissions } from './permissions-fixture';

test('key checks time out, cancel and retry without stale writes or waiting for tabs', {
  timeout: 10_000,
}, async (t) => {
  const local: Record<string, any> = {
    keys: { jev: 'existing-typesafe-key' },
    settings: { provider: 'jev' },
  };
  const session: Record<string, any> = {};
  let listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (result: any) => void,
  ) => boolean;
  const area = (data: Record<string, any>) => ({
    setAccessLevel: async () => {},
    get: async () => ({ ...data }),
    set: async (value: Record<string, any>) => {
      Object.assign(data, value);
    },
    remove: async (key: string) => {
      delete data[key];
    },
  });
  globalThis.chrome = {
    permissions: mockPermissions([PROVIDER_ORIGINS.jev]),
    storage: { local: area(local), session: area(session) },

    tabs: { query: async () => [{ id: 99 }], sendMessage: () => new Promise(() => {}) },
    runtime: {
      id: 'test',
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
  } as unknown as typeof chrome;
  const requests: Array<{ resolve: (value: Response) => void; signal: AbortSignal }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((resolve) => {
      requests.push({ resolve, signal: init!.signal! });
    });
  t.onTestFinished(() => {
    globalThis.fetch = realFetch;
  });
  await import('../src/background.ts');
  const send = (message: unknown, content = false) =>
    new Promise<any>((resolve) =>
      listener(
        message,
        {
          id: 'test',
          url: content ? 'https://x.com/home' : 'chrome-extension://test/popup.html',
          frameId: 0,
        },
        resolve,
      ),
    );
  await send({ type: 'getDashboard' });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(1000);
  t.onTestFinished(() => {
    vi.useRealTimers();
  });
  const connect = (apiKey: string) => send({ type: 'connect', provider: 'jev', apiKey });
  const response = () => Response.json({ answers: { aiGenerated: { type: 'noul', noul: 0.1 } } });

  const timedOut = connect('timeout-candidate-key');
  await setImmediate();
  assert.equal(requests.length, 1);
  const checking = await send({ type: 'getDashboard' });
  assert.equal(checking.connectionCheck.phase, 'checking');
  assert.equal(checking.connectionCheck.provider, 'jev');
  assert.equal(checking.connectionCheck.controller, undefined);
  assert.equal((await connect('duplicate-candidate-key')).code, 'busy');
  vi.advanceTimersByTime(20_000);
  assert.match((await timedOut).message, /timed out after 20 seconds/);
  assert.ok(requests[0].signal.aborted);
  assert.equal((await send({ type: 'getDashboard' })).connectionCheck, null);
  assert.equal(local.keys.jev, 'existing-typesafe-key');

  const cancelled = connect('cancelled-candidate-key');
  await setImmediate();
  assert.ok((await send({ type: 'cancelConnection' }, true)).error);
  assert.ok((await send({ type: 'getDashboard' })).connectionCheck);
  await send({ type: 'cancelConnection' });
  assert.match((await cancelled).message, /cancelled/);
  assert.ok(requests[1].signal.aborted);

  const retry = connect('successful-retry-key');
  await setImmediate();
  const retryId = (await send({ type: 'getDashboard' })).connectionCheck.id;
  requests[0].resolve(response());
  requests[1].resolve(response());
  await setImmediate();
  assert.equal((await send({ type: 'getDashboard' })).connectionCheck.id, retryId);
  assert.equal(
    local.keys.jev,
    'existing-typesafe-key',
    'Late checks must not save their candidates',
  );
  requests[2].resolve(response());
  assert.equal(
    (await retry).ok,
    true,
    'An unresponsive tab must not block a successful connection',
  );
  assert.equal(local.keys.jev, 'successful-retry-key');
  assert.equal((await send({ type: 'getDashboard' })).connectionResult.ok, true);

  const removed = connect('candidate-after-removal');
  await setImmediate();
  assert.equal((await send({ type: 'disconnect', provider: 'jev' })).ok, true);
  assert.match((await removed).message, /cancelled/);
  requests[3].resolve(response());
  await setImmediate();
  assert.equal(local.keys.jev, undefined, 'A removed key cannot be restored by a late check');
  assert.equal((await send({ type: 'getDashboard' })).connectionCheck, null);
  assert.equal((await send({ type: 'saveSettings', settings: { showScore: false } })).ok, true);
});
