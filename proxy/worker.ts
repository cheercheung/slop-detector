import { DurableObject } from 'cloudflare:workers';
import { parseGptzeroResponse } from '../src/gptzero-schema';
import { type Classification, isRecord, MAX_TEXT } from '../src/shared';
import { type Limits, readLimits } from './limits';
import { QuotaStore } from './quota';

export interface Env {
  QUOTAS: DurableObjectNamespace<Quotas>;
  GPTZERO_API_KEY: string;
  HASH_SECRET: string;
  ALLOWED_EXTENSION_IDS: string;
  SPONSORED_ENABLED: string;
  INSTALL_WEEKLY_LIMIT?: string;
  INSTALL_MINUTE_LIMIT?: string;
  IP_DAILY_LIMIT?: string;
  GLOBAL_DAILY_LIMIT?: string;
  GLOBAL_MONTHLY_LIMIT?: string;
  GLOBAL_MONTHLY_CHARACTER_LIMIT?: string;
}
export class Quotas extends DurableObject<Env> {
  private store: QuotaStore;
  private lastCleanup = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new QuotaStore(ctx.storage.sql, (fn) => ctx.storage.transactionSync(fn));
  }
  usage(installation: string, limits: Limits) {
    return this.store.usage(installation, limits, Date.now());
  }
  reserve(installation: string, ip: string, hash: string, characters: number, limits: Limits) {
    const now = Date.now();
    if (now - this.lastCleanup > 60000) {
      this.store.cleanup(now);
      this.lastCleanup = now;
    }
    return this.store.reserve(installation, ip, hash, characters, limits, now);
  }
  finish(
    hash: string,
    ticket: string,
    result: Parameters<QuotaStore['finish']>[2],
    cooldown: number,
  ) {
    this.store.finish(hash, ticket, result, Date.now(), cooldown);
  }
}

async function digest(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
export function retryDelay(value: string | null, now = Date.now()): number {
  const seconds =
    value && /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value ?? '') - now;
  return Number.isFinite(seconds) ? Math.max(60000, Math.min(86400000, seconds)) : 60000;
}
async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new Error('Invalid body');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Empty body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 30000) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET')
      return Response.json({ service: 'Slop Detector GPTZero proxy', version: 1 });
    const origin = request.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_EXTENSION_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^[a-p]{32}$/.test(id));
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin' };
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
    // An origin allowlist is a browser boundary, NOT proof that a caller is the
    // extension. Installation/IP limits and global budgets contain arbitrary clients.
    if (!allowed.some((id) => origin === `chrome-extension://${id}`))
      return reply({ error: 'Origin not allowed.' }, 403);
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Installation-Id';
    headers['Access-Control-Max-Age'] = '86400';
    if (!['/v1/check', '/v1/usage'].includes(path)) return reply({ error: 'Not found.' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
    if (
      env.SPONSORED_ENABLED !== 'true' ||
      !env.GPTZERO_API_KEY ||
      (env.HASH_SECRET?.length ?? 0) < 32
    )
      return reply(
        {
          status: 'error',
          code: 'provider',
          message: 'Free GPTZero scanning is not enabled yet. You can use Jev with your own key.',
          retryAfter: 300000,
        },
        503,
      );
    const installation = request.headers.get('X-Installation-Id') ?? '';
    const ip = request.headers.get('CF-Connecting-IP');
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        installation,
      ) ||
      !ip
    )
      return reply({ error: 'Invalid installation.' }, 400);
    let body: unknown;
    try {
      body = await readBody(request);
    } catch {
      return reply({ error: 'Invalid request body.' }, 400);
    }
    if (!isRecord(body)) return reply({ error: 'Invalid request body.' }, 400);
    const text = body.text;
    if (
      path === '/v1/check' &&
      (typeof text !== 'string' ||
        !text.trim() ||
        text.length > MAX_TEXT ||
        Object.keys(body).some((key) => key !== 'text'))
    )
      return reply({ error: 'Send only text, up to 6,000 characters.' }, 400);
    let quotaStage = 'configuration';
    try {
      const limits = readLimits(env as unknown as Record<string, unknown>);
      quotaStage = 'identity';
      const userHash = await digest(env.HASH_SECRET, `installation:${installation}`);
      const quotas = env.QUOTAS.get(env.QUOTAS.idFromName('sponsored-v1'));
      if (path === '/v1/usage') {
        quotaStage = 'usage';
        return reply({ usage: await quotas.usage(userHash, limits) });
      }
      if (typeof text !== 'string') return reply({ error: 'Missing text.' }, 400);
      const [ipHash, textHash] = await Promise.all([
        digest(env.HASH_SECRET, `ip:${ip}`),
        digest(env.HASH_SECRET, `gptzero-v1:${text}`),
      ]);
      quotaStage = 'reserve';
      const reserved = await quotas.reserve(userHash, ipHash, textHash, text.length, limits);
      if (reserved.kind !== 'reserved')
        return reply({
          ...reserved.result,
          ...(reserved.kind === 'cached' && reserved.result.status === 'ok'
            ? { cached: true }
            : {}),
          usage: reserved.usage,
        });
      let result: Classification;
      let cooldown = 0;
      const started = Date.now();
      const signal = AbortSignal.timeout(15000);
      try {
        const response = await fetch('https://api.gptzero.me/v2/predict/text', {
          method: 'POST',
          headers: {
            'x-api-key': env.GPTZERO_API_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ document: text }),
          signal,
          redirect: 'manual',
        });
        if (response.ok) {
          const verdict = parseGptzeroResponse(await response.json(), started);
          // Keep the v1 wire format compatible with already-installed clients
          // and cached responses. Updated extensions derive AI-only scores from
          // the three-class breakdown, for both fresh and cached responses.
          verdict.probability = Math.min(
            1,
            verdict.gptzero!.probabilities.ai + verdict.gptzero!.probabilities.mixed,
          );
          result = { status: 'ok', verdict, cached: false };
        } else {
          await response.body?.cancel();
          if ([400, 422].includes(response.status))
            result = {
              status: 'unrated',
              message: 'GPTZero could not evaluate this text. It may be too short or unsupported.',
            };
          else {
            cooldown =
              response.status === 429
                ? retryDelay(response.headers.get('Retry-After'))
                : [401, 402, 403].includes(response.status)
                  ? 3600000
                  : 60000;
            result = {
              status: 'error',
              code: response.status === 429 ? 'rate_limit' : 'provider',
              message:
                'GPTZero is temporarily unavailable. Try later or switch to Jev with your own key.',
              retryAfter: cooldown,
            };
          }
        }
      } catch {
        cooldown = 60000;
        result = {
          status: 'error',
          code: signal.aborted ? 'timeout' : 'provider',
          message: 'GPTZero could not finish this check. Please try later.',
          retryAfter: cooldown,
        };
      }
      // No raw text, provider response or key is stored. Reservations count even
      // on uncertain failures; refunding could allow repeated unmetered API calls.
      quotaStage = 'finish';
      await quotas.finish(
        textHash,
        reserved.ticket,
        result.status === 'ok' || result.status === 'unrated' ? result : undefined,
        cooldown,
      );
      return reply({ ...result, usage: reserved.usage });
    } catch (error) {
      // Only infrastructure errors reach this catch; provider responses and
      // post text are never logged. Normal Worker log storage remains disabled.
      const failure = error as Error & { retryable?: boolean; overloaded?: boolean };
      console.error('Quota operation failed', {
        stage: quotaStage,
        name: failure?.name,
        message: failure?.message,
        retryable: failure?.retryable,
        overloaded: failure?.overloaded,
      });
      // A failed quota read/write must never fall through to the paid API.
      return reply(
        {
          status: 'error',
          code: 'provider',
          message: 'Free scanning is temporarily unavailable. Please try later.',
          retryAfter: 60000,
        },
        503,
      );
    }
  },
} satisfies ExportedHandler<Env>;
