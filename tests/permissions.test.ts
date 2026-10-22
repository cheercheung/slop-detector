import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'vitest';
import { PROVIDER_ORIGINS } from '../src/shared';
import { mockPermissions } from './permissions-fixture';

test('provider permissions migrate, gate requests, handle revocation and preserve saved keys', async (t) => {
  const local: Record<string, any> = { keys: { evolink: 'saved-evolink-test-key' } };
  const session: Record<string, any> = {};
  const permissions = mockPermissions(Object.values(PROVIDER_ORIGINS));
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
    permissions,
    storage: { local: area(local), session: area(session) },
    tabs: { query: async () => [], sendMessage: async () => {} },
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
  const requests: Array<{ resolve: (response: Response) => void; signal: AbortSignal }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((resolve) => {
      requests.push({ resolve, signal: init!.signal! });
    });
  t.onTestFinished(() => {
    globalThis.fetch = originalFetch;
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
  assert.deepEqual(
    [...permissions.granted],
    [PROVIDER_ORIGINS.evolink],
    'Upgrade removes unused providers, preserving the connected provider',
  );
  assert.deepEqual(initial.permissionStatus, {
    evolink: true,
    openrouter: false,
    jev: false,
  });
  assert.equal(initial.settings.configured, true);
  assert.equal(
    (await send({ type: 'connect', provider: 'jev', apiKey: 'not-authorized-key' })).code,
    'permission',
  );
  assert.equal(requests.length, 0, 'No key check can reach a provider without its permission');

  const post = {
    id: '1',
    text: 'A visible post being checked.',
    hasMedia: false,
    truncated: false,
  };
  const rating = send({ type: 'classify', post }, true);
  for (let attempt = 0; attempt < 100 && !requests.length; attempt++) await setImmediate();
  assert.equal(requests.length, 1);
  await permissions.remove({ origins: [PROVIDER_ORIGINS.evolink] });
  const revoked = await dashboard();
  assert.equal(revoked.settings.configured, false);
  assert.equal(revoked.settings.permissionRequired, true);
  assert.equal(revoked.keyStatus.evolink, true);
  assert.ok(requests[0].signal.aborted, 'Revoking access aborts existing provider work');
  requests[0].resolve(
    Response.json({ answers: [{ name: 'aiGenerated', type: 'predicate', probability: 0.12 }] }),
  );
  assert.notEqual((await rating).status, 'ok', 'Late results after revocation must not be saved');
  assert.equal((await send({ type: 'classify', post }, true)).status, 'setup');
  assert.equal(requests.length, 1);
  assert.equal(local.keys.evolink, 'saved-evolink-test-key');

  permissions.grant(PROVIDER_ORIGINS.evolink);
  assert.equal(
    (await dashboard()).settings.configured,
    true,
    'Restoring permission recovers the saved connection',
  );
  assert.equal(requests.length, 1, 'Restoring access needs no paid key check');
  permissions.grant(PROVIDER_ORIGINS.jev);
  const candidate = send({ type: 'connect', provider: 'jev', apiKey: 'candidate-revoked-key' });
  await setImmediate();
  assert.equal(requests.length, 2);
  await permissions.remove({ origins: [PROVIDER_ORIGINS.jev] });
  await dashboard();
  assert.match((await candidate).message, /cancelled/);
  requests[1].resolve(Response.json({ answers: { aiGenerated: { type: 'noul', noul: 0.12 } } }));
  await setImmediate();
  assert.equal(local.keys.jev, undefined);
  assert.equal(
    (await dashboard()).settings.configured,
    true,
    'Removing another provider does not disable the active connection',
  );

  await send({ type: 'disconnect', provider: 'evolink' });
  assert.equal(local.keys.evolink, undefined);
  assert.equal(
    permissions.granted.has(PROVIDER_ORIGINS.evolink),
    false,
    'Removing a saved key also releases its permission',
  );
});
