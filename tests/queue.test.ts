import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test, vi } from 'vitest';
import { PROVIDER_ORIGINS } from '../src/shared';
import { mockPermissions } from './permissions-fixture';

test('stalled feed evaluations release queue slots on timeout and pause, ignoring late results', {
  timeout: 10_000,
}, async (t) => {
  const local: Record<string, any> = {
    keys: { jev: 'queue-test-key' },
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
    tabs: { query: async () => [] },
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
  const stalled: Array<{ resolve: (value: Response) => void; signal: AbortSignal }> = [];
  const response = () => Response.json({ answers: { aiGenerated: { type: 'noul', noul: 0.1 } } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (!JSON.parse(String(init!.body)).state.startsWith('Stalled')) return response();
    // The transport deliberately ignores abort, as a stuck SDK/body read can.
    return new Promise<Response>((resolve) => stalled.push({ resolve, signal: init!.signal! }));
  };
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
  const dashboard = () => send({ type: 'getDashboard' });
  const rate = (text: string) =>
    send(
      {
        type: 'classify',
        post: { id: text.replaceAll(' ', '-'), text, hasMedia: false, truncated: false },
      },
      true,
    );
  const waitForStalled = async (count: number) => {
    for (let attempt = 0; attempt < 1000 && stalled.length < count; attempt++) await setImmediate();
    assert.equal(stalled.length, count);
  };
  await dashboard();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(1000);
  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const timedOut = [rate('Stalled first'), rate('Stalled second'), rate('Stalled third')];
  await waitForStalled(3);
  assert.equal((await dashboard()).active, 3);
  assert.equal((await rate('Waiting for capacity')).status, 'busy');
  vi.advanceTimersByTime(20_000);
  await setImmediate();
  assert.equal(
    (await dashboard()).active,
    0,
    'A stuck transport must not keep the queue occupied after its deadline',
  );
  for (const result of await Promise.all(timedOut)) assert.equal(result.code, 'timeout');
  assert.ok(stalled.every((request) => request.signal.aborted));
  assert.equal((await rate('Waiting for cooldown')).code, 'timeout');
  vi.advanceTimersByTime(15_000);
  assert.equal((await rate('A fresh visible post')).status, 'ok');
  stalled.forEach((request) => {
    request.resolve(response());
  });
  await setImmediate();
  assert.equal(
    (await dashboard()).stats.evaluated,
    1,
    'Late responses cannot record timed-out verdicts',
  );

  const cancelled = [
    rate('Stalled after pause one'),
    rate('Stalled after pause two'),
    rate('Stalled after pause three'),
  ];
  await waitForStalled(6);
  await send({ type: 'saveSettings', settings: { enabled: false } });
  assert.equal(
    (await dashboard()).active,
    0,
    'Pausing must free all slots even when transport ignores cancellation',
  );
  for (const result of await Promise.all(cancelled)) assert.equal(result.status, 'paused');
  await send({ type: 'saveSettings', settings: { enabled: true } });
  assert.equal((await rate('A visible reply after resuming')).status, 'ok');
  stalled.slice(3).forEach((request) => {
    request.resolve(response());
  });
  await setImmediate();
  const final = await dashboard();
  assert.equal(final.stats.evaluated, 2);
  assert.equal(final.active, 0);
});
