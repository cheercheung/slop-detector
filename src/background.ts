import { evaluatePost, safeError } from './classifier';
import {
  connectGptzero,
  evaluateGptzero,
  gptzeroStatus,
  loadGptzero,
  refreshGptzeroUsage,
} from './gptzero-client';
import { GPTZERO_API_ORIGIN, GPTZERO_PROXY_ORIGIN } from './gptzero-config';
import { evaluateGptzeroDirect } from './gptzero-direct';
import { normalizeGptzeroVerdict } from './gptzero-schema';
import {
  type Classification,
  type ConnectionCheckResult,
  type ConnectionCheckStatus,
  DEFAULT_SETTINGS,
  detectionChanged,
  EMPTY_STATS,
  hasReadableText,
  isProvider,
  isSupportedUrl,
  type KeyProvider,
  type KeyStatus,
  MAX_PROMPT,
  normalizeSettings,
  type Post,
  PROVIDER_NAMES,
  PROVIDER_ORIGINS,
  PROVIDERS,
  type PublicSettings,
  parsePost,
  postContentKey,
  type Settings,
  SITE_PATTERNS,
  type Stats,
  type Verdict,
} from './shared';

const CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_CACHE = 800;
let settings: Settings = { ...DEFAULT_SETTINGS };
const KEY_PROVIDERS = [...PROVIDERS, 'gptzero'] as const;
const KEY_ORIGINS = { ...PROVIDER_ORIGINS, gptzero: GPTZERO_API_ORIGIN };
const KEY_NAMES = { ...PROVIDER_NAMES, gptzero: 'GPTZero' };
let keys: Partial<Record<KeyProvider, string>> = {};
let permissionStatus: KeyStatus = { gateway: false, openrouter: false, jev: false, evolink: false };
let gptzeroPermission = false;
let gptzeroDirectPermission = false;
function keyPermission(provider: KeyProvider) {
  return provider === 'gptzero' ? gptzeroDirectPermission : permissionStatus[provider];
}
function activeKeyProvider(): KeyProvider {
  return settings.detector === 'gptzero' ? 'gptzero' : settings.provider;
}
function zeroStatus() {
  return {
    ...gptzeroStatus(gptzeroPermission),
    personalKeySaved: !!keys.gptzero,
    personalPermissionGranted: gptzeroDirectPermission,
  };
}
let nextGptzeroStart = 0;
let gptzeroConnecting = false;
let permissionTask: Promise<void> = Promise.resolve();
function refreshProviderAccess(): Promise<void> {
  const task = permissionTask.then(async () => {
    const granted = await Promise.all(
      PROVIDERS.map((provider) =>
        chrome.permissions.contains({ origins: [PROVIDER_ORIGINS[provider]] }),
      ),
    );
    const previous = permissionStatus;
    const previousGptzero = gptzeroPermission;
    const previousDirect = gptzeroDirectPermission;
    gptzeroPermission =
      !!GPTZERO_PROXY_ORIGIN &&
      (await chrome.permissions.contains({ origins: [GPTZERO_PROXY_ORIGIN] }));
    gptzeroDirectPermission = await chrome.permissions.contains({ origins: [GPTZERO_API_ORIGIN] });
    permissionStatus = Object.fromEntries(
      PROVIDERS.map((provider, index) => [provider, granted[index]]),
    ) as KeyStatus;
    if (
      (settings.detector === 'jev' &&
        previous[settings.provider] &&
        !permissionStatus[settings.provider]) ||
      (settings.detector === 'gptzero' &&
        (settings.gptzeroSource === 'personal'
          ? previousDirect && !gptzeroDirectPermission
          : previousGptzero && !gptzeroPermission))
    ) {
      cancelRequests();
      stats.lastError = '';
    }
    if (connectionCheck && !keyPermission(connectionCheck.provider)) cancelConnectionCheck();
    if (
      previousDirect !== gptzeroDirectPermission ||
      previousGptzero !== gptzeroPermission ||
      PROVIDERS.some((provider) => previous[provider] !== permissionStatus[provider])
    )
      broadcast();
  });
  permissionTask = task.catch(() => {});
  return task;
}
let cacheEpoch = 0;
let mutationQueue: Promise<unknown> = Promise.resolve();
function mutate<T>(action: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(action);
  mutationQueue = next.catch(() => {});
  return next;
}
function activeKey() {
  return keys[activeKeyProvider()] ?? '';
}
function keyStatus() {
  return Object.fromEntries(PROVIDERS.map((provider) => [provider, Boolean(keys[provider])]));
}
let stats: Stats = { ...EMPTY_STATS };
const cache = new Map<string, Verdict>();
const pending = new Map<string, Promise<Classification>>();
const controllers = new Set<AbortController>();
let generation = 0;
let active = 0;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let blocked: Extract<Classification, { status: 'error' }> | undefined;
let blockedUntil = 0;
const CONNECTION_TIMEOUT = 20_000;
let nextCheckId = 0;
let connectionCheck: (ConnectionCheckStatus & { controller: AbortController }) | undefined;
let connectionResult: ConnectionCheckResult | null = null;

function abortable<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void;
  return new Promise<T>((resolve, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return action();
      })
      .then(resolve, reject);
  }).finally(() => signal.removeEventListener('abort', onAbort));
}
function cancelConnectionCheck(reason = new DOMException('Key check cancelled.', 'AbortError')) {
  if (!connectionCheck || connectionCheck.phase === 'saving') return;
  const check = connectionCheck;
  connectionCheck = undefined;
  check.controller.abort(reason);
}
function expireConnectionCheck() {
  if (
    connectionCheck?.phase === 'checking' &&
    Date.now() - connectionCheck.startedAt >= CONNECTION_TIMEOUT
  ) {
    cancelConnectionCheck(new DOMException('Key check timed out.', 'TimeoutError'));
  }
}

const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const [local, session] = await Promise.all([
    chrome.storage.local.get(['settings', 'apiKey', 'keys', 'optionalProvidersMigrated']),
    chrome.storage.session.get(['cache', 'stats']),
  ]);

  settings = normalizeSettings(local.settings);
  if (
    !(local.settings as Partial<Settings> | undefined)?.detector &&
    (local.settings || local.keys || local.apiKey)
  )
    settings.detector = 'jev';
  await loadGptzero();
  const savedKeys = local.keys as Partial<Record<KeyProvider, unknown>> | undefined;
  for (const provider of KEY_PROVIDERS)
    if (typeof savedKeys?.[provider] === 'string') keys[provider] = savedKeys[provider] as string;
  if (!keys.gateway && typeof local.apiKey === 'string') keys.gateway = local.apiKey;
  // Preserve legacy Gateway connections that predate explicit provider settings.
  if (!(local.settings as Partial<Settings> | undefined)?.provider && keys.gateway)
    settings.provider = 'gateway';

  await chrome.storage.local.set({ keys, settings });
  await chrome.storage.local.remove('apiKey');

  if (!local.optionalProvidersMigrated) {
    const unused = PROVIDERS.filter((provider) => !keys[provider]).map(
      (provider) => PROVIDER_ORIGINS[provider],
    );
    if (unused.length) await chrome.permissions.remove({ origins: unused });
    await chrome.storage.local.set({ optionalProvidersMigrated: true });
  }
  await refreshProviderAccess();
  stats = { ...EMPTY_STATS, ...(session.stats as Partial<Stats> | undefined) };
  if (Array.isArray(session.cache))
    for (const item of session.cache.slice(-MAX_CACHE)) {
      if (!Array.isArray(item) || item.length !== 2) continue;
      const [key, v] = item;
      if (
        typeof key === 'string' &&
        /^[a-f0-9]{64}$/.test(key) &&
        v &&
        typeof v.probability === 'number' &&
        Number.isFinite(v.probability) &&
        v.probability >= 0 &&
        v.probability <= 1 &&
        typeof v.evaluatedAt === 'number' &&
        v.evaluatedAt <= Date.now() &&
        Date.now() - v.evaluatedAt < CACHE_TTL
      ) {
        try {
          cache.set(key, v.gptzero === undefined ? v : normalizeGptzeroVerdict(v));
        } catch {}
      }
    }
})();

function publicSettings(): PublicSettings {
  const zero = gptzeroStatus(gptzeroPermission);
  const free = settings.detector === 'gptzero' && settings.gptzeroSource === 'free';
  return {
    ...settings,
    configured: free
      ? zero.connected && zero.permissionGranted
      : Boolean(activeKey()) && keyPermission(activeKeyProvider()),
    permissionRequired: free
      ? zero.available && !zero.permissionGranted
      : Boolean(activeKey()) && !keyPermission(activeKeyProvider()),
    cacheEpoch,
  };
}
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    void chrome.storage.session.set({ cache: [...cache], stats }).catch(() => {});
  }, 200);
}
function broadcast() {
  void chrome.tabs
    .query({ url: SITE_PATTERNS })
    .then((tabs) =>
      Promise.allSettled(
        tabs
          .filter((tab) => tab.id !== undefined)
          .map((tab) =>
            chrome.tabs.sendMessage(tab.id!, {
              type: 'settingsChanged',
              settings: publicSettings(),
            }),
          ),
      ),
    )
    .catch(() => {});
}
function cancelRequests() {
  generation++;
  for (const controller of controllers) controller.abort();
  pending.clear();
  blocked = undefined;
  blockedUntil = 0;
}
async function contentHash(post: Post, snapshot: Settings) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(postContentKey(post, snapshot)),
  );
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function classify(post: Post): Promise<Classification> {
  if (!settings.enabled) return { status: 'paused' };
  if (!publicSettings().configured) return { status: 'setup' };
  if (!hasReadableText(post)) return { status: 'empty' };
  const requestGeneration = generation;
  const snapshot = { ...settings };
  const credential = activeKey();
  const key = await contentHash(post, snapshot);
  if (requestGeneration !== generation) return { status: 'busy', retryAfter: 100 };

  if (!settings.enabled) return { status: 'paused' };
  if (!publicSettings().configured) return { status: 'setup' };
  const cached = cache.get(key);
  if (cached && Date.now() - cached.evaluatedAt < CACHE_TTL) {
    stats.cacheHits++;
    persist();
    return { status: 'ok', verdict: cached, cached: true };
  }
  if (blocked && Date.now() < blockedUntil)
    return {
      ...blocked,
      ...(blocked.retryAfter ? { retryAfter: Math.max(1000, blockedUntil - Date.now()) } : {}),
    };
  const existing = pending.get(key);
  if (existing) return existing;
  if (active >= (snapshot.detector === 'gptzero' ? 1 : 3))
    return { status: 'busy', retryAfter: 900 };
  if (snapshot.detector === 'gptzero' && Date.now() < nextGptzeroStart)
    return { status: 'busy', retryAfter: nextGptzeroStart - Date.now() };
  if (snapshot.detector === 'gptzero') nextGptzeroStart = Date.now() + 3100;
  const controller = new AbortController();
  controllers.add(controller);
  active++;
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
    20_000,
  );
  const task = (async (): Promise<Classification> => {
    try {
      const result: Classification = await abortable(
        async () =>
          snapshot.detector === 'gptzero'
            ? snapshot.gptzeroSource === 'personal'
              ? evaluateGptzeroDirect(credential, post.text, controller.signal)
              : evaluateGptzero(post.text, controller.signal)
            : {
                status: 'ok',
                verdict: await evaluatePost(
                  credential,
                  post,
                  controller.signal,
                  undefined,
                  snapshot,
                ),
                cached: false,
              },
        controller.signal,
      );
      if (requestGeneration !== generation)
        return { status: settings.enabled ? 'busy' : 'paused', retryAfter: 1000 } as Classification;
      if (result.status !== 'ok') {
        if (result.status === 'error') {
          blocked = result;
          blockedUntil = Date.now() + (result.retryAfter ?? 60000);
          stats.errors++;
          stats.lastError = result.message;
          persist();
        }
        return result;
      }
      const verdict = result.verdict;
      cache.delete(key);
      cache.set(key, verdict);
      while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
      stats.evaluated++;
      stats.latencyMs = verdict.latencyMs;
      stats.lastError = '';
      persist();
      return { status: 'ok', verdict, cached: result.cached };
    } catch (error) {
      if (requestGeneration !== generation)
        return settings.enabled ? { status: 'busy', retryAfter: 1000 } : { status: 'paused' };
      const result: Extract<Classification, { status: 'error' }> =
        snapshot.detector === 'gptzero'
          ? {
              status: 'error',
              code: controller.signal.aborted ? 'timeout' : 'network',
              message: 'Cannot reach GPTZero.',
              retryAfter: 60000,
            }
          : safeError(
              controller.signal.aborted ? controller.signal.reason : error,
              snapshot.provider,
            );
      stats.errors++;
      stats.lastError = result.message;
      blocked = result;
      blockedUntil = Date.now() + (result.retryAfter ?? 5 * 60_000);
      persist();
      return result;
    } finally {
      clearTimeout(timeout);
      active--;
      controllers.delete(controller);
      if (requestGeneration === generation) pending.delete(key);
    }
  })();
  pending.set(key, task);
  return task;
}

function isPopup(sender: chrome.runtime.MessageSender) {
  return sender.url === chrome.runtime.getURL('popup.html');
}

function gptzeroKeyError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';

  return [
    'Check your GPTZero API key.',
    'Your GPTZero credits have run out.',
    'GPTZero rate limit reached.',
    'Unable to rate this text.',
    'Invalid GPTZero response.',
    'GPTZero unavailable.',
  ].includes(message)
    ? message
    : 'Cannot reach GPTZero.';
}

async function handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ready;
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object')
    return { error: 'Unsupported request.' };
  const m = message as Record<string, unknown>;
  const popup = isPopup(sender);
  const content = sender.frameId === 0 && isSupportedUrl(sender.url);
  if (!popup && !content) return { error: 'Unsupported sender.' };
  if (m.type === 'openSettings') {
    try {
      await chrome.action.openPopup(sender.tab ? { windowId: sender.tab.windowId } : {});
    } catch {
      await chrome.runtime.openOptionsPage();
    }
    return { ok: true };
  }
  await refreshProviderAccess();
  if (m.type === 'getSettings') return publicSettings();
  if (m.type === 'classify' && content) {
    const post = parsePost(m.post);
    return post ? classify(post) : { status: 'empty' };
  }
  if (!popup) return { error: 'Unsupported request.' };
  switch (m.type) {
    case 'getDashboard': {
      expireConnectionCheck();
      const check = connectionCheck;
      return {
        settings: publicSettings(),
        stats,
        cacheSize: cache.size,
        active,
        keyStatus: keyStatus(),
        permissionStatus,
        gptzero: zeroStatus(),
        gptzeroConnecting,
        connectionCheck: check
          ? {
              id: check.id,
              provider: check.provider,
              startedAt: check.startedAt,
              phase: check.phase,
            }
          : null,
        connectionResult,
      };
    }
    case 'saveSettings':
      return mutate(async () => {
        const input = m.settings as Partial<Settings> | undefined;
        if (
          input?.prompt !== undefined &&
          (typeof input.prompt !== 'string' ||
            !input.prompt.trim() ||
            input.prompt.length > MAX_PROMPT)
        )
          return { error: `Prompt must be 1–${MAX_PROMPT} characters.` };
        const next = normalizeSettings({ ...settings, ...input });
        if (
          connectionCheck?.provider === 'gptzero' &&
          (next.detector !== settings.detector || next.gptzeroSource !== settings.gptzeroSource)
        )
          cancelConnectionCheck();
        await chrome.storage.local.set({ settings: next });
        if (next.enabled !== settings.enabled || detectionChanged(settings, next)) cancelRequests();
        if (detectionChanged(settings, next)) stats.lastError = '';
        settings = next;
        broadcast();
        return { ok: true, settings: publicSettings() };
      });
    case 'connectGptzero': {
      if (!GPTZERO_PROXY_ORIGIN || !gptzeroPermission) return { error: 'GPTZero access required.' };
      if (gptzeroConnecting) return { error: 'GPTZero is connecting.' };
      gptzeroConnecting = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        await abortable(() => connectGptzero(controller.signal), controller.signal);
        await refreshProviderAccess();
        cancelRequests();
        stats.lastError = '';
        broadcast();
        return { ok: true, gptzero: zeroStatus(), settings: publicSettings() };
      } catch {
        return { error: 'GPTZero unavailable.' };
      } finally {
        clearTimeout(timeout);
        gptzeroConnecting = false;
      }
    }
    case 'refreshGptzeroUsage': {
      if (
        settings.detector === 'gptzero' &&
        settings.gptzeroSource === 'free' &&
        publicSettings().configured
      ) {
        const signal = AbortSignal.timeout(10000);
        try {
          await abortable(() => refreshGptzeroUsage(signal), signal);
        } catch {}
      }
      return { gptzero: zeroStatus() };
    }
    case 'connect': {
      expireConnectionCheck();
      if (connectionCheck) return { ok: false, code: 'busy', message: 'Key check in progress.' };
      const provider = m.provider ?? settings.provider;
      if (provider !== 'gptzero' && !isProvider(provider))
        return { ok: false, message: 'Choose a supported provider.' };
      if (!keyPermission(provider))
        return {
          ok: false,
          code: 'permission',
          message: `${KEY_NAMES[provider]} access required.`,
        };
      if (
        typeof m.apiKey !== 'string' ||
        m.apiKey.trim().length < 10 ||
        m.apiKey.length > 1000 ||
        /\s/.test(m.apiKey.trim())
      )
        return { ok: false, message: 'Invalid API key.' };
      const candidate = m.apiKey.trim();
      const check: ConnectionCheckStatus & { controller: AbortController } = {
        id: ++nextCheckId,
        provider,
        startedAt: Date.now(),
        phase: 'checking',
        controller: new AbortController(),
      };
      connectionCheck = check;
      const timeout = setTimeout(() => {
        if (connectionCheck === check)
          cancelConnectionCheck(new DOMException('Key check timed out.', 'TimeoutError'));
      }, CONNECTION_TIMEOUT);
      try {
        const sample = {
          id: '0',
          text: 'The library closes at 6 pm today; its opening hours are posted on the front door.',
          hasMedia: false,
          truncated: false,
        };
        const result = await abortable(async () => {
          if (provider !== 'gptzero')
            return evaluatePost(candidate, sample, check.controller.signal, undefined, {
              ...settings,
              provider,
            });
          const rated = await evaluateGptzeroDirect(
            candidate,
            sample.text,
            check.controller.signal,
          );
          if (rated.status !== 'ok')
            throw new Error('message' in rated ? rated.message : 'GPTZero unavailable.');
          return rated.verdict;
        }, check.controller.signal);
        return await mutate(async () => {
          await refreshProviderAccess();
          check.controller.signal.throwIfAborted();
          if (connectionCheck !== check)
            throw new DOMException('Key check cancelled.', 'AbortError');
          connectionCheck.phase = 'saving';
          clearTimeout(timeout);
          const nextKeys = { ...keys, [provider]: candidate };
          await chrome.storage.local.set({ keys: nextKeys });
          keys = nextKeys;
          if (provider === activeKeyProvider()) {
            cancelRequests();
            stats.lastError = '';
          }
          persist();
          broadcast();
          connectionResult = { id: check.id, provider, ok: true, message: 'Connected.' };
          return {
            ok: true,
            latencyMs: result.latencyMs,
            settings: publicSettings(),
            keyStatus: keyStatus(),
          };
        });
      } catch (error) {
        const reason = check.controller.signal.aborted ? check.controller.signal.reason : error;
        const message =
          reason?.name === 'TimeoutError'
            ? 'Key check timed out after 20 seconds.'
            : reason?.name === 'AbortError'
              ? 'Key check cancelled.'
              : provider === 'gptzero'
                ? gptzeroKeyError(reason)
                : safeError(reason, provider).message;
        if (check.id === nextCheckId)
          connectionResult = { id: check.id, provider, ok: false, message };
        return { ok: false, message };
      } finally {
        clearTimeout(timeout);
        if (connectionCheck === check) connectionCheck = undefined;
      }
    }
    case 'cancelConnection':
      if (connectionCheck?.phase === 'saving') return { error: 'Saving key…' };
      cancelConnectionCheck();
      return { ok: true };
    case 'disconnect':
      return mutate(async () => {
        const provider = m.provider ?? settings.provider;
        if (provider !== 'gptzero' && !isProvider(provider))
          return { error: 'Choose a supported provider.' };

        if (connectionCheck?.provider === provider) cancelConnectionCheck();
        const nextKeys = { ...keys };
        delete nextKeys[provider];
        await chrome.storage.local.set({ keys: nextKeys });
        keys = nextKeys;
        if (provider === activeKeyProvider()) {
          cancelRequests();
          stats.lastError = '';
          persist();
        }
        await chrome.permissions.remove({ origins: [KEY_ORIGINS[provider]] });
        await refreshProviderAccess();
        broadcast();
        return { ok: true, settings: publicSettings(), keyStatus: keyStatus() };
      });
    case 'clearCache':
      return mutate(async () => {
        cancelRequests();
        cacheEpoch++;
        cache.clear();
        stats = { ...EMPTY_STATS };
        persist();
        broadcast();
        return { ok: true };
      });
    default:
      return { error: 'Unsupported request.' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handle(message, sender)
    .then(sendResponse)
    .catch(() => sendResponse({ error: 'Request failed. Reload the extension.' }));
  return true;
});

for (const event of [chrome.permissions.onAdded, chrome.permissions.onRemoved]) {
  event.addListener(() => {
    void ready.then(refreshProviderAccess).catch(() => {});
  });
}
