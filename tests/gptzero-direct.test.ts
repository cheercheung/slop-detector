import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGptzeroDirect } from '../src/gptzero-direct';

const valid = { documents: [{ document_classification: 'MIXED', class_probabilities: { human: 0.1, mixed: 0.7, ai: 0.2 }, confidence_category: 'high', text: 'Do not return raw text' }] };
test('personal GPTZero keys go only to the direct endpoint and responses are sanitized', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.gptzero.me/v2/predict/text');
    assert.deepEqual(init!.headers, { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': 'personal-test-key' });
    assert.deepEqual(JSON.parse(init!.body as string), { document: 'A visible post' });
    assert.equal(init!.credentials, 'omit');
    assert.equal(init!.redirect, 'error');
    return Response.json(valid);
  };
  const result = await evaluateGptzeroDirect('personal-test-key', 'A visible post', new AbortController().signal);
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') assert.equal(result.verdict.probability, 0.2);
  assert.ok(!JSON.stringify(result).includes('raw text'));
});

test('direct GPTZero handles quota, auth, invalid text, rate limits and malformed responses without exposing upstream errors', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const [status, code] of [[401, 'auth'], [403, 'auth'], [402, 'credits'], [429, 'rate_limit'], [500, 'provider']] as const) {
    globalThis.fetch = async () => new Response('secret from upstream', { status, headers: { 'Retry-After': '120' } });
    const result = await evaluateGptzeroDirect('key', 'post', new AbortController().signal);
    assert.equal(result.status, 'error');
    if (result.status === 'error') { assert.equal(result.code, code); if (status === 429) assert.equal(result.retryAfter, 120000); }
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
  globalThis.fetch = async () => new Response('', { status: 422 });
  assert.equal((await evaluateGptzeroDirect('key', 'post', new AbortController().signal)).status, 'unrated');
  globalThis.fetch = async () => Response.json({ documents: [] });
  assert.deepEqual(await evaluateGptzeroDirect('key', 'post', new AbortController().signal), { status: 'error', code: 'invalid_response', message: 'Invalid GPTZero response.', retryAfter: 60000 });
});
