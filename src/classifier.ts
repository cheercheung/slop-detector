import { createGateway } from '@ai-sdk/gateway';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { type Experimental_EvaluationModel, experimental_evaluate as evaluate } from 'ai';
import { directLuna } from './luna';
import {
  type Classification,
  DEFAULT_PROMPT,
  DEFAULT_SETTINGS,
  type Post,
  PROVIDER_MODELS,
  PROVIDER_NAMES,
  type Provider,
  type Settings,
  type Verdict,
} from './shared';

export const AI_INSTRUCTIONS = DEFAULT_PROMPT;
type EvaluationSettings = Pick<Settings, 'prompt' | 'provider'>;

function directJev(
  apiKey: string,
  transport: typeof fetch,
): Exclude<Experimental_EvaluationModel, string> {
  return {
    specificationVersion: 'v4',
    provider: 'typesafe',
    modelId: PROVIDER_MODELS.jev,
    supportedQuestionTypes: ['boolean'],
    async doEvaluate({ state, questions, abortSignal }) {
      const mapped = Object.fromEntries(
        Object.entries(questions).map(([id, question]) => [
          id,
          { type: 'noul', instructions: question.instructions },
        ]),
      );
      const response = await transport('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: PROVIDER_MODELS.jev, state, questions: mapped }),
        signal: abortSignal,
        credentials: 'omit',
        redirect: 'error',
      });
      if (!response.ok)
        throw Object.assign(new Error('Provider request failed'), { statusCode: response.status });
      const data = (await response.json()) as {
        answers?: Record<string, { type?: string; noul?: unknown }>;
      };
      const answers = Object.fromEntries(
        Object.keys(questions).map((id) => {
          const answer = data?.answers?.[id];
          if (
            answer?.type !== 'noul' ||
            typeof answer.noul !== 'number' ||
            !Number.isFinite(answer.noul) ||
            answer.noul < 0 ||
            answer.noul > 1
          )
            throw new Error('INVALID_MODEL_RESPONSE');
          return [id, { type: 'boolean' as const, probability: answer.noul }];
        }),
      );
      return { answers, warnings: [] };
    },
  };
}

export async function evaluatePost(
  apiKey: string,
  post: Post,
  signal?: AbortSignal,
  customFetch?: typeof fetch,
  settings: EvaluationSettings = DEFAULT_SETTINGS,
): Promise<Verdict> {
  const transport: typeof fetch = (input, init) =>
    (customFetch ?? fetch)(input, { ...init, credentials: 'omit', redirect: 'error' });
  const model =
    settings.provider === 'gateway'
      ? createGateway({ apiKey, fetch: transport }).evaluationModel(PROVIDER_MODELS.gateway)
      : settings.provider === 'openrouter'
        ? createOpenRouter({ apiKey, fetch: transport }).evaluationModel(PROVIDER_MODELS.openrouter)
        : settings.provider === 'evolink'
          ? directLuna(apiKey, transport)
          : directJev(apiKey, transport);
  const started = Date.now();
  const result = await evaluate({
    model,
    state: post.text,
    questions: { aiGenerated: { type: 'boolean', instructions: settings.prompt } },
    ...(settings.provider === 'gateway'
      ? { providerOptions: { gateway: { zeroDataRetention: true } } }
      : {}),
    maxRetries: 0,
    abortSignal: signal ?? AbortSignal.timeout(20_000),
  });
  const probability = result.answers.aiGenerated.probability;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1)
    throw new Error('INVALID_MODEL_RESPONSE');
  return { probability, evaluatedAt: Date.now(), latencyMs: Date.now() - started };
}

export function safeError(
  error: unknown,
  provider: Provider = 'gateway',
): Extract<Classification, { status: 'error' }> {
  const e = error as { statusCode?: number; name?: string; message?: string };
  const status = e?.statusCode;
  const name = PROVIDER_NAMES[provider];
  if (status === 401 || status === 403)
    return { status: 'error', code: 'auth', message: `Check your ${name} key.` };
  if (status === 402)
    return { status: 'error', code: 'credits', message: `${name} credits exhausted.` };
  if (status === 429)
    return {
      status: 'error',
      code: 'rate_limit',
      message: `${name} rate limit reached.`,
      retryAfter: 60_000,
    };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError')
    return { status: 'error', code: 'timeout', message: 'Request timed out.', retryAfter: 15_000 };
  if (
    e?.message === 'INVALID_MODEL_RESPONSE' ||
    e?.name?.includes('Validation') ||
    e?.name?.includes('Parse')
  )
    return {
      status: 'error',
      code: 'invalid_response',
      message: `Invalid ${name} result.`,
      retryAfter: 60_000,
    };
  if (e?.name === 'TypeError' || e?.message?.includes('fetch'))
    return {
      status: 'error',
      code: 'network',
      message: `Cannot reach ${name}.`,
      retryAfter: 15_000,
    };
  return { status: 'error', code: 'provider', message: `${name} unavailable.`, retryAfter: 30_000 };
}
