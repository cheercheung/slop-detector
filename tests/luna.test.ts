import assert from 'node:assert/strict';
import { test } from 'vitest';
import { evaluatePost, safeError } from '../src/classifier';
import { directLuna } from '../src/luna';
import { DEFAULT_PROMPT, normalizeSettings, type Post, postContentKey } from '../src/shared';

const post: Post = {
  id: 'synthetic',
  text: 'Synthetic test content only.',
  hasMedia: false,
  truncated: false,
};
const settings = { provider: 'evolink' as const, prompt: DEFAULT_PROMPT };
const payload = {
  model: 'gpt-6-luna',
  answers: [{ type: 'predicate', name: 'aiGenerated', probability: 0.82 }],
  usage: { input_tokens: 20 },
};

test('Luna uses the official predicate wire format and preserves its probability', async () => {
  let calls = 0;
  const verdict = await evaluatePost(
    'offline-placeholder',
    post,
    undefined,
    async (url, init) => {
      calls++;
      assert.equal(url, 'https://direct.evolink.ai/v1/decisions');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer offline-placeholder');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: 'gpt-6-luna-decisions',
        input: post.text,
        questions: [{ type: 'predicate', name: 'aiGenerated', instructions: DEFAULT_PROMPT }],
      });
      return Response.json(payload);
    },
    settings,
  );
  assert.equal(verdict.probability, 0.82);
  assert.equal(calls, 1);
});

test('Luna rejects refusals, missing/duplicate/wrong names and invalid probabilities', async () => {
  for (const body of [
    {},
    { answers: [] },
    { answers: [payload.answers[0], payload.answers[0]] },
    { answers: [{ ...payload.answers[0], type: 'refusal' }] },
    { answers: [{ ...payload.answers[0], name: 'wrong' }] },
    { answers: [{ ...payload.answers[0], probability: -0.1 }] },
    { answers: [{ ...payload.answers[0], probability: 1.1 }] },
    { answers: [{ ...payload.answers[0], probability: '0.9' }] },
  ]) {
    await assert.rejects(
      evaluatePost('test', post, undefined, async () => Response.json(body), settings),
    );
  }
  await assert.rejects(
    evaluatePost('test', post, undefined, async () => new Response('private body'), settings),
  );
});

test('Luna requires a key, never retries rate limits, and exposes only safe errors', async () => {
  let calls = 0;
  assert.throws(
    () =>
      directLuna('', async () => {
        throw new Error('must not call');
      }),
    /KEY_REQUIRED/,
  );
  try {
    await evaluatePost(
      'test',
      post,
      undefined,
      async () => {
        calls++;
        return new Response('private provider text', { status: 429 });
      },
      settings,
    );
    assert.fail('Must fail');
  } catch (error) {
    assert.equal(safeError(error, 'evolink').code, 'rate_limit');
    assert.ok(!safeError(error, 'evolink').message.includes('private'));
  }
  assert.equal(calls, 1);
});

test('Luna cancellation reaches its HTTP request', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = evaluatePost(
    'test',
    post,
    controller.signal,
    async (_url, init) => {
      started();
      return new Promise((_, reject) =>
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }),
      );
    },
    settings,
  );
  await ready;
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(pending);
});

test('provider selection survives normalization and never reuses a Jev cache entry', () => {
  assert.equal(normalizeSettings({ provider: 'evolink' }).provider, 'evolink');
  assert.notEqual(
    postContentKey(post, settings),
    postContentKey(post, { ...settings, provider: 'jev' }),
  );
});
