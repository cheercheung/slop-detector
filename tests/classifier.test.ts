import assert from 'node:assert/strict';
import { test } from 'vitest';
import { evaluatePost, safeError } from '../src/classifier.ts';
import {
  cleanText,
  DEFAULT_PROMPT,
  DEFAULT_SETTINGS,
  detectionChanged,
  hasReadableText,
  isProvider,
  isSlopVerdict,
  isSupportedUrl,
  normalizeSettings,
  type Post,
  PROVIDERS,
  parsePost,
  postContentKey,
  verdictLabel,
} from '../src/shared.ts';

const post: Post = {
  id: '123',
  text: 'I measured query latency: 42 ms before, 18 ms with the new index.',
  hasMedia: false,
  truncated: false,
};
const response = (probability = 0.18) => ({
  answers: [{ name: 'aiGenerated', type: 'predicate', probability }],
  usage: { inputTokens: 500, outputTokens: 0 },
});

test('uses the real AI SDK evaluation transport with the expected model, questions, and auth', async () => {
  let calls = 0;
  const transport: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://direct.evolink.ai/v1/decisions');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-evolink-key');
    assert.equal(headers.get('ai-model-id'), null);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.input, post.text);
    assert.equal(body.model, 'gpt-6-luna-decisions');
    assert.deepEqual(body.questions, [
      { name: 'aiGenerated', type: 'predicate', instructions: DEFAULT_PROMPT },
    ]);
    return Response.json(response());
  };
  const result = await evaluatePost('test-evolink-key', post, undefined, transport, {
    provider: 'evolink',
    prompt: DEFAULT_PROMPT,
  });
  assert.equal(result.probability, 0.18);
  assert.equal(calls, 1);
});

test('malformed or out-of-range scores never become labels', async () => {
  for (const data of [
    response(1.2),
    response(-0.2),
    { answers: {} },
    { answers: { aiGenerated: { type: 'boolean', probability: 'high' } } },
  ]) {
    await assert.rejects(
      evaluatePost('test-key', post, undefined, async () => Response.json(data)),
    );
  }
});

test('a rate-limit response is not retried invisibly by the SDK', async () => {
  let calls = 0;
  try {
    await evaluatePost('test-key', post, undefined, async () => {
      calls++;
      return Response.json({ error: { message: 'slow down' } }, { status: 429 });
    });
    assert.fail('Expected rate-limit error');
  } catch (error) {
    assert.equal(safeError(error).code, 'rate_limit');
  }
  assert.equal(calls, 1);
});

test('errors are mapped to safe user messages, never raw provider bodies or keys', () => {
  assert.equal(safeError({ statusCode: 401, message: 'secret-key-and-raw-post' }).code, 'auth');
  assert.equal(safeError({ statusCode: 402 }).code, 'credits');
  assert.equal(safeError(new DOMException('expired', 'TimeoutError')).code, 'timeout');
  assert.equal(safeError(new TypeError('Failed to fetch')).code, 'network');
  assert.ok(!safeError({ message: 'secret-key-and-raw-post' }).message.includes('secret'));
});

test('validates and limits content messages and accepts multilingual short posts', () => {
  assert.deepEqual(parsePost(post), post);
  assert.equal(parsePost({ ...post, text: 'x'.repeat(6001) }), null);
  assert.equal(parsePost({ ...post, id: 'https://evil.example' }), null);
  assert.equal(parsePost({ ...post, text: 4 }), null);
  assert.equal(hasReadableText({ ...post, text: 'https://t.co/abc' }), false);
  assert.equal(hasReadableText({ ...post, text: '谢谢' }), true);
  assert.equal(hasReadableText({ ...post, text: '' }), false);
  assert.equal(cleanText('  a\n  b  '), 'a b');
});

test('limits origins, normalizes settings, and changes cached identity when content changes', () => {
  assert.equal(isSupportedUrl('https://x.com/home'), true);
  assert.equal(isSupportedUrl('https://www.linkedin.com/feed/'), true);
  assert.equal(
    parsePost({ ...post, id: 'li:update-card-focusTest_1' })?.id,
    'li:update-card-focusTest_1',
  );
  for (const url of [
    'http://x.com/home',
    'https://x.com.evil.example/',
    'https://example.com',
    'https://www.linkedin.com.evil.example/feed/',
    undefined,
  ])
    assert.equal(isSupportedUrl(url), false);
  assert.equal(normalizeSettings({ threshold: Infinity }).threshold, 0.7);
  assert.equal(normalizeSettings({ threshold: 12 }).threshold, 1);
  assert.equal(normalizeSettings({ enabled: 'yes' }).enabled, true);
  assert.notEqual(postContentKey(post), postContentKey({ ...post, text: 'Changed post' }));
  assert.equal(postContentKey(post), postContentKey({ ...post, id: '456' }));
  assert.equal(verdictLabel(0.65, 0.65), 'Slop');
  assert.equal(verdictLabel(0.64, 0.65), 'Not slop');
});

for (const provider of ['openrouter', 'jev'] as const) {
  test(`${provider} uses the documented endpoint, auth and single custom question through the AI SDK`, async () => {
    const prompt = 'Does this read like generic engagement bait?';
    const result = await evaluatePost(
      'provider-test-key',
      post,
      undefined,
      async (input, init) => {
        assert.equal(
          String(input),
          provider === 'openrouter'
            ? 'https://openrouter.ai/api/alpha/decisions'
            : 'https://api.typesafe.ai/v1/systemone',
        );
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer provider-test-key');
        assert.equal(init?.credentials, 'omit');
        assert.equal(init?.redirect, 'error');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, provider === 'openrouter' ? 'typesafe/jev-1.13' : 'jev-latest');
        assert.equal(body.state, post.text);
        assert.deepEqual(body.questions, { aiGenerated: { type: 'noul', instructions: prompt } });
        return Response.json({
          model: body.model,
          answers: { aiGenerated: { type: 'noul', noul: 0.82 } },
          usage: { input_tokens: 200, output_tokens: 0 },
        });
      },
      { provider, prompt },
    );
    assert.equal(result.probability, 0.82);
  });
  test(`${provider} rejects invalid responses and does not retry or leak provider errors`, async () => {
    for (const answer of [
      undefined,
      { type: 'noul', noul: '0.8' },
      { type: 'noul', noul: 1.3 },
      { type: 'boolean', probability: 0.8 },
    ]) {
      await assert.rejects(
        evaluatePost(
          'test-key',
          post,
          undefined,
          async () =>
            Response.json({
              model: 'jev-latest',
              answers: { aiGenerated: answer },
              usage: { input_tokens: 100, output_tokens: 0 },
            }),
          {
            provider,
            prompt:
              'Is this an automated, AI-generated or otherwise low-effort post that offers little value?',
          },
        ),
      );
    }
    let calls = 0;
    await assert.rejects(
      evaluatePost(
        'test-key',
        post,
        undefined,
        async () => {
          calls++;
          return Response.json({ error: { message: 'SECRET TOKEN' } }, { status: 401 });
        },
        {
          provider,
          prompt:
            'Is this an automated, AI-generated or otherwise low-effort post that offers little value?',
        },
      ),
      (error) => {
        assert.equal(safeError(error, provider).code, 'auth');
        assert.ok(!safeError(error, provider).message.includes('SECRET'));
        return true;
      },
    );
    assert.equal(calls, 1);
  });
}

test('settings migrate dimming and keep provider, prompt and display cache semantics separate', () => {
  const defaults = normalizeSettings({ detector: 'jev' });
  assert.equal(defaults.threshold, 0.7);
  assert.equal(defaults.theme, 'hide');
  assert.equal(
    defaults.prompt,
    'Is this an automated, AI-generated or otherwise low-effort post that offers little value?',
  );
  assert.equal(normalizeSettings({ dimSlop: true }).theme, 'fade');
  assert.equal(normalizeSettings({ dimSlop: true, theme: 'hide' }).theme, 'hide');
  assert.equal(normalizeSettings({ provider: 'evil' }).provider, 'evolink');
  assert.equal(normalizeSettings({ prompt: '  ' }).prompt, defaults.prompt);
  assert.equal(normalizeSettings({ prompt: 'x'.repeat(3000) }).prompt.length, 2000);
  assert.notEqual(
    postContentKey(post, defaults),
    postContentKey(post, { ...defaults, prompt: 'Is this advertising?' }),
  );
  assert.notEqual(
    postContentKey(post, defaults),
    postContentKey(post, { ...defaults, provider: 'openrouter' }),
  );
  assert.equal(
    postContentKey(post, defaults),
    postContentKey(
      post,
      normalizeSettings({
        ...defaults,
        theme: 'hide',
        threshold: 0.9,
        showScore: false,
        showNotSlop: false,
      }),
    ),
  );
});

test('Luna defaults use an inclusive 70% threshold; custom thresholds do not invalidate scores', () => {
  assert.equal(DEFAULT_SETTINGS.detector, 'jev');
  assert.equal(DEFAULT_SETTINGS.provider, 'evolink');
  const verdict = (probability: number) => ({ probability, evaluatedAt: 1, latencyMs: 1 });
  assert.equal(isSlopVerdict(verdict(0.6999), 0.7), false);
  assert.equal(isSlopVerdict(verdict(0.7), 0.7), true);
  assert.equal(isSlopVerdict(verdict(0.8), 0.7), true);
  assert.equal(isSlopVerdict(verdict(0.6), 0.6), true);
  assert.equal(isSlopVerdict(verdict(0), 0), true);
  assert.equal(isSlopVerdict(verdict(0.9999), 1), false);
  assert.equal(isSlopVerdict(verdict(1), 1), true);
  for (const threshold of [0, 0.01, 0.3, 0.71, 0.99, 1]) {
    const next = normalizeSettings({ ...DEFAULT_SETTINGS, threshold, language: 'zh-CN' });
    assert.equal(next.threshold, threshold);
    assert.equal(detectionChanged(DEFAULT_SETTINGS, next), false);
    assert.equal(postContentKey(post, DEFAULT_SETTINGS), postContentKey(post, next));
  }
  assert.equal(normalizeSettings({ threshold: -1 }).threshold, 0);
  assert.equal(normalizeSettings({ threshold: NaN }).threshold, 0.7);
  assert.equal(normalizeSettings({ language: 'invalid' }).language, 'auto');
  const saved = normalizeSettings({
    provider: 'openrouter',
    detector: 'gptzero',
    threshold: 0.65,
    language: 'en',
  });
  assert.equal(saved.provider, 'openrouter');
  assert.equal(saved.detector, 'gptzero');
  assert.equal(saved.threshold, 0.65);
  assert.equal(saved.language, 'en');
});

test('only the three supported providers are accepted; retired Gateway settings reset to EvoLink', () => {
  assert.deepEqual(PROVIDERS, ['evolink', 'openrouter', 'jev']);
  assert.equal(isProvider('gateway'), false);
  assert.equal(normalizeSettings({ provider: 'gateway' }).provider, 'evolink');
});
