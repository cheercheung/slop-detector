import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'vitest';
import { GPTZERO_API_ORIGIN } from '../src/gptzero-config';
import { mockPermissions } from './permissions-fixture';

test('personal GPTZero survives reload, gates credentials, cancels stale work and preserves keys on a failed replacement', async (t) => {
  const local: Record<string, any> = {
    keys: { gptzero: 'existing-personal-key' },
    settings: { detector: 'gptzero', gptzeroSource: 'personal' },
  };
  const session: Record<string, any> = {};
  const permissions = mockPermissions([]);
  let listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (result: any) => void,
  ) => boolean;
  const area = (data: Record<string, any>) => ({
    setAccessLevel: async () => {},
    get: async () => ({ ...data }),
    set: async (v: object) => {
      Object.assign(data, v);
    },
    remove: async (key: string) => {
      delete data[key];
    },
  });
  globalThis.chrome = {
    permissions,
    storage: { local: area(local), session: area(session) },
    tabs: { query: async () => [], sendMessage: async () => {} },
    runtime: {
      id: 'test',
      getURL: (p: string) => `chrome-extension://test/${p}`,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
  } as unknown as typeof chrome;
  const requests: Array<{
    resolve: (response: Response) => void;
    signal: AbortSignal;
    key: string;
  }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.gptzero.me/v2/predict/text');
    return new Promise<Response>((resolve) =>
      requests.push({
        resolve,
        signal: init!.signal!,
        key: (init!.headers as Record<string, string>)['x-api-key'],
      }),
    );
  };
  t.onTestFinished(() => {
    globalThis.fetch = original;
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
  const initial = await dashboard();
  assert.equal(initial.gptzero.personalKeySaved, true);
  assert.equal(initial.settings.configured, false);
  assert.equal(initial.settings.permissionRequired, true);
  assert.ok(!JSON.stringify(initial).includes('existing-personal-key'));
  assert.ok(
    (await send({ type: 'connect', provider: 'gptzero', apiKey: 'sneaked-in-key' }, true)).error,
  );
  assert.ok((await send({ type: 'getDashboard' }, true)).error);
  assert.equal(
    (await send({ type: 'connect', provider: 'gptzero', apiKey: 'no-permission-key' })).code,
    'permission',
  );
  assert.equal(requests.length, 0);
  permissions.grant(GPTZERO_API_ORIGIN);
  assert.equal(
    (await dashboard()).settings.configured,
    true,
    'Restoring permission uses the saved key without a proxy',
  );
  const connect = (key: string) => send({ type: 'connect', provider: 'gptzero', apiKey: key });
  const response = () =>
    Response.json({
      documents: [
        { predicted_class: 'human', class_probabilities: { human: 0.9, mixed: 0.05, ai: 0.05 } },
      ],
    });
  const failed = connect('rejected-replacement-key');
  await setImmediate();
  requests[0].resolve(new Response('', { status: 401 }));
  assert.equal((await failed).ok, false);
  assert.equal(local.keys.gptzero, 'existing-personal-key');

  const stale = connect('stale-replacement-key');
  await setImmediate();
  await send({ type: 'saveSettings', settings: { gptzeroSource: 'free' } });
  assert.match((await stale).message, /cancelled/);
  requests[1].resolve(response());
  await setImmediate();
  assert.equal(local.keys.gptzero, 'existing-personal-key');
  await send({ type: 'saveSettings', settings: { gptzeroSource: 'personal' } });
  const succeeds = connect('new-personal-key');
  await setImmediate();
  requests[2].resolve(response());
  assert.equal((await succeeds).ok, true);
  assert.equal(local.keys.gptzero, 'new-personal-key');
  assert.ok(
    !JSON.stringify(await send({ type: 'getSettings' }, true)).includes('new-personal-key'),
  );

  const post = { id: '1', text: 'A post in the viewport', hasMedia: false, truncated: false };
  const rating = send({ type: 'classify', post }, true);
  for (let i = 0; i < 100 && requests.length < 4; i++) await setImmediate();
  assert.equal(requests[3].key, 'new-personal-key');
  await permissions.remove({ origins: [GPTZERO_API_ORIGIN] });
  await dashboard();
  assert.ok(requests[3].signal.aborted);
  requests[3].resolve(response());
  assert.notEqual((await rating).status, 'ok');
  assert.equal((await dashboard()).cacheSize, 0, 'Revoked requests cannot populate the cache');

  permissions.grant(GPTZERO_API_ORIGIN);
  const removed = connect('late-key-after-removal');
  await setImmediate();
  await send({ type: 'disconnect', provider: 'gptzero' });
  assert.match((await removed).message, /cancelled/);
  requests[4].resolve(response());
  await setImmediate();
  assert.equal(local.keys.gptzero, undefined);
  assert.equal(permissions.granted.has(GPTZERO_API_ORIGIN), false);
  assert.equal((await dashboard()).settings.configured, false);
});
