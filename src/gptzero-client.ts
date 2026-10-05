import { GPTZERO_PROXY_URL } from './gptzero-config';
import { normalizeGptzeroVerdict, validUsage } from './gptzero-schema';
import type { Classification, GptzeroUsage, GptzeroStatus } from './shared';

let installation = '';
let connectedUrl = '';
let usage: GptzeroUsage | null = null;
let lastRefresh = 0;
export async function loadGptzero() {
  const saved = await chrome.storage.local.get(['gptzeroInstallation', 'gptzeroConnection', 'gptzeroUsage']);
  if (typeof saved.gptzeroInstallation === 'string' && /^[a-f0-9-]{36}$/i.test(saved.gptzeroInstallation)) installation = saved.gptzeroInstallation;
  if (typeof saved.gptzeroConnection === 'string') connectedUrl = saved.gptzeroConnection;
  if (validUsage(saved.gptzeroUsage)) usage = saved.gptzeroUsage;
}
export function gptzeroStatus(permissionGranted: boolean): GptzeroStatus {
  return { available: !!GPTZERO_PROXY_URL, connected: !!installation && connectedUrl === GPTZERO_PROXY_URL && !!GPTZERO_PROXY_URL, permissionGranted, usage };
}
async function rememberUsage(value: unknown) {
  if (!validUsage(value)) return;
  // Concurrent responses can arrive out of order. Never show a lower count for
  // the same week. Clearing scores and switching detectors don't clear quota.
  if (usage && usage.resetsAt > value.resetsAt) return;
  const used = usage?.resetsAt === value.resetsAt ? Math.max(usage.used, value.used) : value.used;
  usage = { ...value, used, remaining: Math.max(0, value.limit - used) };
  await chrome.storage.local.set({ gptzeroUsage: usage });
}
async function request(path: string, body: unknown, signal: AbortSignal) {
  if (!GPTZERO_PROXY_URL || !installation) throw new Error('GPTZero is not configured');
  const response = await fetch(`${GPTZERO_PROXY_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Installation-Id': installation },
    body: JSON.stringify(body), signal, credentials: 'omit', redirect: 'error',
  });
  const data = await response.json();
  signal.throwIfAborted();
  await rememberUsage(data.usage);
  if (!response.ok && data.status !== 'error') throw new Error('GPTZero proxy is unavailable');
  return data;
}
export async function connectGptzero(signal: AbortSignal) {
  if (!installation) {
    installation = crypto.randomUUID();
    await chrome.storage.local.set({ gptzeroInstallation: installation });
  }
  const data = await request('/v1/usage', {}, signal);
  if (!validUsage(data.usage)) throw new Error('GPTZero unavailable.');
  signal.throwIfAborted();
  connectedUrl = GPTZERO_PROXY_URL;
  await chrome.storage.local.set({ gptzeroConnection: connectedUrl });
  lastRefresh = Date.now();
}
export async function refreshGptzeroUsage(signal: AbortSignal) {
  if (Date.now() - lastRefresh < 60000) return;
  lastRefresh = Date.now();
  await request('/v1/usage', {}, signal);
}
export async function evaluateGptzero(text: string, signal: AbortSignal): Promise<Classification> {
  const data = await request('/v1/check', { text }, signal);
  if (data.status === 'ok') {
    const verdict = normalizeGptzeroVerdict(data.verdict);
    return { status: 'ok', verdict: { ...verdict, evaluatedAt: Date.now() }, cached: data.cached === true };
  }
  if (data.status === 'busy' && Number.isFinite(data.retryAfter) && data.retryAfter > 0) return { status: 'busy', retryAfter: Math.min(60000, data.retryAfter) };
  if (data.status === 'unrated') return { status: 'unrated', message: 'Unable to rate this text.' };
  if (data.status === 'error' && ['quota', 'rate_limit', 'provider', 'timeout'].includes(data.code)) return {
    status: 'error', code: data.code,
    message: ({ quota: 'Free limit reached.', rate_limit: 'GPTZero rate limit reached.', timeout: 'GPTZero request timed out.', provider: 'GPTZero unavailable.' } as Record<string, string>)[data.code],
    retryAfter: Number.isFinite(data.retryAfter) && data.retryAfter > 0 ? Math.min(32 * 86400000, data.retryAfter) : 60000,
  };
  throw new Error('Invalid GPTZero response');
}
