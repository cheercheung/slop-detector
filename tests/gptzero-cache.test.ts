import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DEFAULT_SETTINGS, postContentKey } from '../src/shared';
import { GPTZERO_API_ORIGIN } from '../src/gptzero-config';
import { mockPermissions } from './permissions-fixture';

test('background reuses old mixed and AI caches with corrected scores and no new paid calls', async t => {
  const settings = { ...DEFAULT_SETTINGS, gptzeroSource: 'personal' as const };
  const posts = ['Previously stamped polished text.', 'Previously scored AI text.'].map((text, i) => ({ id: String(i), text, hasMedia: false, truncated: false }));
  const legacy = [
    { probability: 1, evaluatedAt: Date.now(), latencyMs: 1, gptzero: { classification: 'mixed', probabilities: { human: 0, mixed: 1, ai: 0 } } },
    { probability: 0.97, evaluatedAt: Date.now(), latencyMs: 1, gptzero: { classification: 'ai', probabilities: { human: 0.03, mixed: 0.07, ai: 0.9 } } },
  ];
  const local = { settings, keys: { gptzero: 'personal-test-key' } };
  const session = { cache: posts.map((post, i) => [createHash('sha256').update(postContentKey(post, settings)).digest('hex'), legacy[i]]) };
  const area = (data: Record<string, unknown>) => ({ setAccessLevel: async () => {}, get: async () => ({ ...data }), set: async (values: object) => { Object.assign(data, values); }, remove: async (key: string) => { delete data[key]; } });
  let listener: (message: unknown, sender: chrome.runtime.MessageSender, respond: (result: any) => void) => boolean;
  globalThis.chrome = { permissions: mockPermissions([GPTZERO_API_ORIGIN]), storage: { local: area(local), session: area(session) }, tabs: { query: async () => [], sendMessage: async () => {} }, runtime: { id: 'test', getURL: (p: string) => `chrome-extension://test/${p}`, onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } } as unknown as typeof chrome;
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected API call'); };
  t.after(() => { globalThis.fetch = original; });
  await import('../src/background.ts');
  for (const [i, post] of posts.entries()) {
    const result = await new Promise<any>(resolve => listener({ type: 'classify', post }, { id: 'test', url: 'https://x.com/home', frameId: 0 }, resolve));
    assert.equal(result.status, 'ok');
    assert.equal(result.cached, true);
    assert.equal(result.verdict.probability, i === 0 ? 0 : 0.9);
    assert.equal(result.verdict.evaluatedAt, legacy[i].evaluatedAt);
  }
  assert.equal(requests, 0);
});
