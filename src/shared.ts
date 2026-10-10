export const MODEL = 'typesafe-ai/jev';
export const RUBRIC_VERSION = '4-custom-prompts';
export const DEFAULT_PROMPT =
  'Is this an automated, AI-generated or otherwise low-effort post that offers little value?';
export const MAX_PROMPT = 2000;
export const PROVIDERS = ['gateway', 'openrouter', 'jev'] as const;
export type Provider = (typeof PROVIDERS)[number];
export type KeyProvider = Provider | 'gptzero';
export const PROVIDER_NAMES: Record<Provider, string> = {
  gateway: 'AI Gateway',
  openrouter: 'OpenRouter',
  jev: 'Jev (TypeSafe)',
};
export const PROVIDER_ORIGINS: Record<Provider, string> = {
  gateway: 'https://ai-gateway.vercel.sh/*',
  openrouter: 'https://openrouter.ai/*',
  jev: 'https://api.typesafe.ai/*',
};
export const PROVIDER_MODELS: Record<Provider, string> = {
  gateway: MODEL,
  openrouter: 'typesafe/jev-1.13',
  jev: 'jev-latest',
};
export type Theme = 'stamp' | 'fade' | 'hide';
export const SITE_PATTERNS = [
  'https://x.com/*',
  'https://www.x.com/*',
  'https://www.linkedin.com/*',
  'https://linkedin.com/*',
];
export const MAX_TEXT = 6000;
export type Detector = 'gptzero' | 'jev';
export type Settings = {
  detector: Detector;
  gptzeroSource: 'free' | 'personal';
  enabled: boolean;
  threshold: number;
  prompt: string;
  provider: Provider;
  showNotSlop: boolean;
  showScore: boolean;
  theme: Theme;
};
export const DEFAULT_SETTINGS: Settings = {
  detector: 'gptzero',
  gptzeroSource: 'free',
  enabled: true,
  threshold: 0.7,
  prompt: DEFAULT_PROMPT,
  provider: 'gateway',
  showNotSlop: true,
  showScore: true,
  theme: 'hide',
};
export type PublicSettings = Settings & {
  configured: boolean;
  permissionRequired?: boolean;
  cacheEpoch: number;
};
export type KeyStatus = Record<Provider, boolean>;
export type ConnectionCheckStatus = {
  id: number;
  provider: KeyProvider;
  startedAt: number;
  phase: 'checking' | 'saving';
};
export type ConnectionCheckResult = {
  id: number;
  provider: KeyProvider;
  ok: boolean;
  message: string;
};
export function isProvider(value: unknown): value is Provider {
  return PROVIDERS.includes(value as Provider);
}
export type Post = { id: string; text: string; hasMedia: boolean; truncated: boolean };
export type GptzeroResult = {
  classification: 'human' | 'mixed' | 'ai';
  probabilities: { human: number; mixed: number; ai: number };
  confidence?: 'high' | 'medium' | 'low';
};
export type Verdict = {
  probability: number;
  evaluatedAt: number;
  latencyMs: number;
  gptzero?: GptzeroResult;
};
export type GptzeroUsage = { limit: number; used: number; remaining: number; resetsAt: number };
export type GptzeroStatus = {
  available: boolean;
  connected: boolean;
  permissionGranted: boolean;
  personalKeySaved?: boolean;
  personalPermissionGranted?: boolean;
  usage: GptzeroUsage | null;
};
export type ErrorCode =
  | 'auth'
  | 'credits'
  | 'rate_limit'
  | 'quota'
  | 'network'
  | 'timeout'
  | 'provider'
  | 'invalid_response';
export type Classification =
  | { status: 'ok'; verdict: Verdict; cached: boolean }
  | { status: 'setup' | 'paused' | 'empty' }
  | { status: 'unrated'; message: string }
  | { status: 'busy'; retryAfter: number }
  | { status: 'error'; code: ErrorCode; message: string; retryAfter?: number };
export type Stats = {
  evaluated: number;
  cacheHits: number;
  errors: number;
  latencyMs: number;
  lastError: string;
};
export const EMPTY_STATS: Stats = {
  evaluated: 0,
  cacheHits: 0,
  errors: 0,
  latencyMs: 0,
  lastError: '',
};

export function cleanText(value: string, max = MAX_TEXT): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}
export function parsePost(value: unknown): Post | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (
    typeof p.id !== 'string' ||
    !/^[a-zA-Z0-9:_-]{1,240}$/.test(p.id) ||
    typeof p.text !== 'string' ||
    typeof p.hasMedia !== 'boolean' ||
    typeof p.truncated !== 'boolean'
  )
    return null;
  if (p.text.length > MAX_TEXT) return null;
  return { id: p.id, text: cleanText(p.text), hasMedia: p.hasMedia, truncated: p.truncated };
}
export function hasReadableText(post: Post): boolean {
  return /[\p{L}\p{N}]/u.test(post.text.replace(/https?:\/\/\S+/g, ''));
}
export function normalizeSettings(value: unknown): Settings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Settings> & {
    dimSlop?: boolean;
  };
  return {
    detector:
      v.detector === 'jev' || v.detector === 'gptzero' ? v.detector : DEFAULT_SETTINGS.detector,
    gptzeroSource: v.gptzeroSource === 'personal' ? 'personal' : 'free',
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_SETTINGS.enabled,
    threshold:
      typeof v.threshold === 'number' && Number.isFinite(v.threshold)
        ? Math.min(0.9, Math.max(0.35, v.threshold))
        : DEFAULT_SETTINGS.threshold,
    prompt:
      typeof v.prompt === 'string' && v.prompt.trim()
        ? v.prompt.trim().slice(0, MAX_PROMPT)
        : DEFAULT_PROMPT,
    provider: isProvider(v.provider) ? v.provider : DEFAULT_SETTINGS.provider,
    showNotSlop: typeof v.showNotSlop === 'boolean' ? v.showNotSlop : DEFAULT_SETTINGS.showNotSlop,
    showScore: typeof v.showScore === 'boolean' ? v.showScore : DEFAULT_SETTINGS.showScore,
    theme: ['stamp', 'fade', 'hide'].includes(v.theme ?? '')
      ? v.theme!
      : v.dimSlop
        ? 'fade'
        : DEFAULT_SETTINGS.theme,
  };
}
export function isSupportedUrl(url: string | undefined): boolean {
  try {
    const u = new URL(url ?? '');
    return (
      u.protocol === 'https:' &&
      ['x.com', 'www.x.com', 'linkedin.com', 'www.linkedin.com'].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
export function postContentKey(
  post: Post,
  settings: Pick<Settings, 'prompt' | 'provider'> &
    Partial<Pick<Settings, 'detector'>> = DEFAULT_SETTINGS,
): string {
  if (settings.detector === 'gptzero') return JSON.stringify(['gptzero-v1', post.text]);
  return JSON.stringify([
    RUBRIC_VERSION,
    settings.provider,
    PROVIDER_MODELS[settings.provider],
    settings.prompt,
    post.text,
  ]);
}
export function detectionChanged(before: Settings, after: Settings): boolean {
  return (
    before.detector !== after.detector ||
    (after.detector === 'gptzero'
      ? before.gptzeroSource !== after.gptzeroSource
      : before.provider !== after.provider || before.prompt !== after.prompt)
  );
}
export function verdictLabel(probability: number, threshold: number): string {
  return probability >= threshold ? 'Slop' : 'Not slop';
}
export function isSlopVerdict(verdict: Verdict, threshold: number): boolean {
  // Even with a low user threshold, a Mixed/Human classification is not Slop.
  if (verdict.gptzero)
    return verdict.gptzero.classification === 'ai' && verdict.gptzero.probabilities.ai >= threshold;
  return verdict.probability >= threshold;
}

// Treat external JSON and messages as unknown until their fields are checked.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
