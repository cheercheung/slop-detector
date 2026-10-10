import { parseGptzeroResponse } from './gptzero-schema';
import type { Classification } from './shared';

export async function evaluateGptzeroDirect(
  apiKey: string,
  text: string,
  signal: AbortSignal,
): Promise<Classification> {
  const started = Date.now();
  const response = await fetch('https://api.gptzero.me/v2/predict/text', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ document: text }),
    signal,
    credentials: 'omit',
    redirect: 'error',
  });
  signal.throwIfAborted();
  if (response.status === 401 || response.status === 403)
    return {
      status: 'error',
      code: 'auth',
      message: 'Check your GPTZero API key.',
      retryAfter: 300000,
    };
  if (response.status === 402)
    return {
      status: 'error',
      code: 'credits',
      message: 'Your GPTZero credits have run out.',
      retryAfter: 300000,
    };
  if (response.status === 429) {
    const retry = response.headers.get('Retry-After');
    const wait = retry
      ? /^\d+(\.\d+)?$/.test(retry)
        ? Number(retry) * 1000
        : Date.parse(retry) - Date.now()
      : NaN;
    return {
      status: 'error',
      code: 'rate_limit',
      message: 'GPTZero rate limit reached.',
      retryAfter: Number.isFinite(wait) ? Math.max(1000, Math.min(32 * 86400000, wait)) : 60000,
    };
  }
  if ([400, 413, 422].includes(response.status))
    return { status: 'unrated', message: 'Unable to rate this text.' };
  if (!response.ok)
    return {
      status: 'error',
      code: 'provider',
      message: 'GPTZero unavailable.',
      retryAfter: 60000,
    };
  try {
    const data: unknown = await response.json();
    signal.throwIfAborted();
    return { status: 'ok', verdict: parseGptzeroResponse(data, started), cached: false };
  } catch {
    signal.throwIfAborted();
    return {
      status: 'error',
      code: 'invalid_response',
      message: 'Invalid GPTZero response.',
      retryAfter: 60000,
    };
  }
}
