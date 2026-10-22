import { GPTZERO_API_ORIGIN, GPTZERO_PROXY_ORIGIN } from './gptzero-config';
import { localizePopup, resolveLanguage, translate } from './i18n';
import type { PopupRequest, PopupResponses } from './messages';
import {
  type ConnectionCheckStatus,
  DEFAULT_PROMPT,
  DEFAULT_SETTINGS,
  EVOLINK_KEY_URL,
  type GptzeroStatus,
  type KeyStatus,
  type Language,
  MAX_PROMPT,
  PROVIDER_NAMES,
  PROVIDER_ORIGINS,
  PROVIDERS,
  type Provider,
  type PublicSettings,
  type Settings,
} from './shared';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const keyUrls: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/settings/keys',
  jev: 'https://console.typesafe.ai/',
  evolink: EVOLINK_KEY_URL,
};
let settings: PublicSettings = { ...DEFAULT_SETTINGS, configured: false, cacheEpoch: 0 };
const t = (text: string, values?: Record<string, string | number>) =>
  translate(settings.language, text, values);
let keyStatus: KeyStatus = { openrouter: false, jev: false, evolink: false };
let permissionStatus: KeyStatus = { openrouter: false, jev: false, evolink: false };
let gptzero: GptzeroStatus = {
  available: !!GPTZERO_PROXY_ORIGIN,
  connected: false,
  permissionGranted: false,
  usage: null,
};
let enablingGptzero = false;
let gptzeroConnecting = false;
let initialized = false;
let promptDirty = false;
let connecting = false;
let requestingAccess = false;
let connectionCheck: ConnectionCheckStatus | null = null;
let observedResultId = 0;
let pending: Partial<Settings> = {};
let saveTask: Promise<void> | undefined;
const toggle = $<HTMLButtonElement>('enabled');
const threshold = $<HTMLInputElement>('threshold');
const thresholdNumber = $<HTMLInputElement>('threshold-number');
const provider = $<HTMLSelectElement>('provider');
const prompt = $<HTMLTextAreaElement>('prompt');
const key = $<HTMLInputElement>('api-key');
const connect = $<HTMLButtonElement>('connect');
const cancelConnection = $<HTMLButtonElement>('cancel-connection');
const connection = $<HTMLDetailsElement>('connection');
const fillThreshold = () =>
  threshold.style.setProperty(
    '--fill',
    `${((Number(threshold.value) - Number(threshold.min)) / (Number(threshold.max) - Number(threshold.min))) * 100}%`,
  );
const zeroKey = $<HTMLInputElement>('gptzero-key');
const zeroConnection = $<HTMLDetailsElement>('gptzero-connection');
const zeroSource = $<HTMLSelectElement>('gptzero-source');
const zeroAccess = $<HTMLButtonElement>('gptzero-access');

async function send<M extends PopupRequest>(message: M): Promise<PopupResponses[M['type']]> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.error)
    throw new Error(response?.error || 'Extension unavailable. Reload it.');
  return response;
}
function message(text: string, error = false) {
  const el = $('message');
  el.dataset.sourceMessage = text;
  el.textContent = t(text);
  el.hidden = !text;
  el.classList.toggle('error', error);
}
function renderConnection() {
  const busy = connecting || !!connectionCheck;
  connect.disabled = busy;
  provider.disabled = busy;
  key.disabled = busy;
  $<HTMLButtonElement>('disconnect').disabled = busy;
  const needsAccess = keyStatus[settings.provider] && !permissionStatus[settings.provider];
  key.required = !needsAccess;
  connect.textContent = t(
    requestingAccess
      ? 'Allowing…'
      : connectionCheck?.phase === 'saving'
        ? 'Saving…'
        : busy
          ? 'Checking…'
          : needsAccess && !key.value.trim()
            ? 'Allow access'
            : 'Connect',
  );
  cancelConnection.hidden = !connectionCheck || connectionCheck.provider === 'gptzero';
  cancelConnection.disabled = connectionCheck?.phase === 'saving';
  const zeroNeedsAccess = gptzero.personalKeySaved && !gptzero.personalPermissionGranted;
  zeroKey.required = !zeroNeedsAccess;
  zeroKey.disabled = busy;
  zeroSource.disabled = busy || enablingGptzero || gptzeroConnecting;
  $<HTMLButtonElement>('gptzero-connect').disabled = busy;
  $('gptzero-connect').textContent = t(
    requestingAccess
      ? 'Allowing…'
      : connectionCheck?.phase === 'saving'
        ? 'Saving…'
        : busy
          ? 'Checking…'
          : zeroNeedsAccess && !zeroKey.value.trim()
            ? 'Allow access'
            : 'Connect',
  );
  $('gptzero-cancel').hidden = connectionCheck?.provider !== 'gptzero';
  $<HTMLButtonElement>('gptzero-cancel').disabled = connectionCheck?.phase === 'saving';
  $<HTMLButtonElement>('gptzero-disconnect').disabled = busy;
}
function render() {
  localizePopup(settings.language);
  $<HTMLSelectElement>('language').value = settings.language;
  $('message').textContent = t($('message').dataset.sourceMessage ?? '');
  for (const [buttonId, input, name] of [
    ['show-key', key, 'API key'],
    ['gptzero-show-key', zeroKey, 'GPTZero API key'],
  ] as const) {
    $(buttonId).textContent = t(input.type === 'password' ? 'Show' : 'Hide');
    $(buttonId).setAttribute(
      'aria-label',
      t(`${input.type === 'password' ? 'Show' : 'Hide'} ${name}`),
    );
  }
  const zero = settings.detector === 'gptzero';
  $('gptzero-section').hidden = !zero;
  $('provider-section').hidden = zero;
  $('prompt-section').hidden = zero;
  const setupPending = zero && !settings.configured;
  for (const id of ['appearance-section', 'popup-footer']) {
    $(id).dataset.setupPending = String(setupPending);
    $(id).inert = setupPending;
  }
  $('detector-gptzero').setAttribute('aria-pressed', String(zero));
  $('detector-jev').setAttribute('aria-pressed', String(!zero));
  const attribution = $<HTMLAnchorElement>('attribution');
  attribution.textContent = t(
    zero
      ? 'Powered by GPTZero'
      : settings.provider === 'evolink'
        ? 'Powered by EvoLink Luna Decision'
        : 'Powered by Jev',
  );
  attribution.href = zero
    ? 'https://gptzero.me/'
    : settings.provider === 'evolink'
      ? EVOLINK_KEY_URL
      : 'https://typesafe.ai/';
  const personal = settings.gptzeroSource === 'personal';
  const busy = enablingGptzero || gptzeroConnecting;
  zeroAccess.hidden =
    personal || !gptzero.available || (gptzero.permissionGranted && gptzero.connected);
  zeroAccess.disabled = busy || connecting || !!connectionCheck;
  zeroAccess.textContent = t(
    busy ? 'Connecting…' : gptzero.permissionGranted ? 'Connect GPTZero' : 'Allow GPTZero access',
  );
  toggle.disabled = busy || connecting || !!connectionCheck;
  $<HTMLButtonElement>('detector-gptzero').disabled = busy || connecting || !!connectionCheck;
  $<HTMLButtonElement>('detector-jev').disabled = busy || connecting || !!connectionCheck;
  $('detector-gptzero').setAttribute('aria-busy', String(busy));
  const status =
    !personal && !gptzero.available
      ? 'Free scanning unavailable'
      : busy
        ? 'Connecting…'
        : !settings.enabled
          ? 'Paused'
          : '';
  $('gptzero-status').textContent = t(status);
  $('gptzero-status').hidden = !status;
  const usage = gptzero.usage;
  const currentUsage = !personal && usage && usage.resetsAt > Date.now();
  $('gptzero-section').hidden = !zero;
  $('gptzero-plan').textContent = t(personal ? 'Your key' : 'Free');
  zeroSource.value = settings.gptzeroSource;
  zeroConnection.hidden = !personal;
  if (personal && (!gptzero.personalKeySaved || !gptzero.personalPermissionGranted))
    zeroConnection.open = true;
  $('gptzero-key-status').textContent = t(
    gptzero.personalKeySaved
      ? gptzero.personalPermissionGranted
        ? 'Connected'
        : 'Allow access'
      : 'Add key',
  );
  $('gptzero-key-status').dataset.state =
    gptzero.personalKeySaved && gptzero.personalPermissionGranted ? 'ok' : '';
  $('gptzero-disconnect').hidden = !gptzero.personalKeySaved;
  zeroKey.placeholder = t(
    gptzero.personalKeySaved ? 'Paste a replacement key' : 'Paste your GPTZero API key',
  );
  $('gptzero-usage').hidden = !currentUsage;
  $('gptzero-reset').hidden = !currentUsage;
  $('gptzero-meter').hidden = !currentUsage;
  if (currentUsage) {
    const left = usage.limit ? Math.min(1, usage.remaining / usage.limit) : 0;
    $('gptzero-meter').dataset.low = String(left <= 0.1);
    ($('gptzero-meter').firstElementChild as HTMLElement).style.width = `${left * 100}%`;
    $('gptzero-usage').textContent = t('{remaining} / {limit} free checks left', {
      remaining: usage.remaining.toLocaleString(),
      limit: usage.limit.toLocaleString(),
    });
    $('gptzero-reset').textContent = t('Resets {time}', {
      time: new Date(usage.resetsAt).toLocaleString(resolveLanguage(settings.language), {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }),
    });
  }
  const hasKey = !!keyStatus[settings.provider];
  const configured = hasKey && permissionStatus[settings.provider];
  toggle.setAttribute('aria-checked', String(settings.enabled));
  threshold.value = String(Math.round(settings.threshold * 100));
  if (document.activeElement !== thresholdNumber) thresholdNumber.value = threshold.value;
  renderThresholdRule();
  $('threshold-value').textContent = `${Math.round(settings.threshold * 100)}%`;
  fillThreshold();
  $<HTMLSelectElement>('theme').value = settings.theme;
  $<HTMLInputElement>('show-not-slop').checked = settings.showNotSlop;
  $<HTMLInputElement>('show-score').checked = settings.showScore;
  if (!promptDirty) prompt.value = settings.prompt;
  $('prompt-status').textContent = t(
    promptDirty ? 'Unsaved' : settings.prompt === DEFAULT_PROMPT ? 'Default' : 'Custom',
  );
  $('status-title').textContent = t(settings.enabled ? '' : 'Paused');
  $('status-title').hidden = settings.enabled;
  $('provider-section').dataset.configured = String(configured);
  if (!configured) connection.open = true;
  for (const name of PROVIDERS)
    provider.querySelector(`option[value="${name}"]`)!.textContent =
      `${PROVIDER_NAMES[name]}${keyStatus[name] ? t(' · Saved') : ''}`;
  provider.value = settings.provider;
  $('key-status').textContent = t(configured ? 'Connected' : hasKey ? 'Allow access' : 'Add key');
  $('key-status').dataset.state = configured ? 'ok' : '';
  $('key-label').textContent = t(`${PROVIDER_NAMES[settings.provider]} API key`);
  $<HTMLAnchorElement>('get-key').href = keyUrls[settings.provider];
  $('disconnect').hidden = !keyStatus[settings.provider];
  key.placeholder = t(
    keyStatus[settings.provider] ? 'Paste a replacement key' : 'Paste your API key',
  );
  renderConnection();
}
async function refresh() {
  try {
    const data = await send({ type: 'getDashboard' });
    gptzero = data.gptzero;
    gptzeroConnecting = data.gptzeroConnecting;
    connectionCheck = data.connectionCheck;
    keyStatus = data.keyStatus;
    permissionStatus = data.permissionStatus;
    if (!saveTask && !Object.keys(pending).length) {
      settings = data.settings;
      render();
    }
    if (!initialized) {
      connection.open = !settings.configured;
      initialized = true;
    }
    if (connectionCheck)
      (connectionCheck.provider === 'gptzero' ? zeroConnection : connection).open = true;
    if (
      data.connectionResult &&
      data.connectionResult.id > observedResultId &&
      (!connectionCheck || data.connectionResult.id >= connectionCheck.id)
    ) {
      observedResultId = data.connectionResult.id;
      if (!data.connectionResult.ok) message(data.connectionResult.message, true);
      if (
        data.connectionResult.ok &&
        settings.configured &&
        data.connectionResult.provider === settings.provider
      )
        connection.open = false;
      if (data.connectionResult.ok && data.connectionResult.provider === 'gptzero')
        zeroConnection.open = false;
    }
    renderConnection();
    $('session-count').hidden = !data.stats.evaluated;
    $('session-count').textContent = t('{count} checked this session', {
      count: data.stats.evaluated.toLocaleString(),
    });
    if (data.stats.lastError && settings.enabled && settings.configured) {
      const status = $(settings.detector === 'gptzero' ? 'gptzero-status' : 'status-title');
      status.textContent = t(data.stats.lastError);
      status.hidden = false;
      if (settings.detector === 'gptzero') $('gptzero-section').hidden = false;
    }
  } catch (e) {
    message((e as Error).message, true);
  }
}
function save(patch: Partial<Settings>): Promise<void> {
  Object.assign(settings, patch);
  Object.assign(pending, patch);
  render();
  if (!saveTask) {
    saveTask = (async () => {
      while (Object.keys(pending).length) {
        const patch = pending;
        pending = {};
        const result = await send({ type: 'saveSettings', settings: patch });
        settings = { ...result.settings, ...pending };
      }
    })().finally(() => {
      saveTask = undefined;
      void refresh();
    });
  }
  return saveTask;
}
function renderThresholdRule() {
  $('threshold-rule').textContent = t(
    'Slop probability ≥ {threshold}% is Slop. Changes save automatically.',
    { threshold: threshold.value },
  );
}
$<HTMLSelectElement>('language').addEventListener('change', (event) => {
  saveControl({ language: (event.target as HTMLSelectElement).value as Language });
});
function saveControl(patch: Partial<Settings>) {
  $('message').hidden = true;
  void save(patch).catch((e) => message(e.message, true));
}
$('detector-jev').addEventListener('click', () => {
  saveControl({ detector: 'jev' });
});
$('detector-gptzero').addEventListener('click', () => {
  void activateGptzero(settings.gptzeroSource);
});
zeroAccess.addEventListener('click', () => {
  void activateGptzero('free');
});
zeroSource.addEventListener('change', () => {
  void activateGptzero(zeroSource.value as Settings['gptzeroSource']);
});
async function activateGptzero(source: Settings['gptzeroSource']) {
  if (enablingGptzero || gptzeroConnecting) return;
  enablingGptzero = true;
  render();
  try {
    const origin =
      source === 'personal'
        ? gptzero.personalKeySaved
          ? GPTZERO_API_ORIGIN
          : ''
        : GPTZERO_PROXY_ORIGIN;
    if (origin && !(await chrome.permissions.request({ origins: [origin] })))
      throw new Error('Access was not granted.');
    await saveTask;
    if (source === 'free' && origin && !gptzero.connected) await send({ type: 'connectGptzero' });
    await save({ detector: 'gptzero', gptzeroSource: source, enabled: true });
    $('message').hidden = true;
  } catch (e) {
    message((e as Error).message, true);
  } finally {
    enablingGptzero = false;
    await refresh();
  }
}
toggle.addEventListener('click', () => {
  if (!settings.enabled && settings.detector === 'gptzero') {
    void activateGptzero(settings.gptzeroSource);
  } else {
    saveControl({ enabled: !settings.enabled });
  }
});
threshold.addEventListener('input', () => {
  $('threshold-value').textContent = `${threshold.value}%`;
  thresholdNumber.value = threshold.value;
  renderThresholdRule();
  fillThreshold();
});
threshold.addEventListener('change', () =>
  saveControl({ threshold: Number(threshold.value) / 100 }),
);
thresholdNumber.addEventListener('change', () => {
  const value = thresholdNumber.valueAsNumber;
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    thresholdNumber.value = String(Math.round(settings.threshold * 100));
    message('Threshold must be a whole number from 0 to 100.', true);
    return;
  }
  saveControl({ threshold: value / 100 });
});
$('reset-threshold').addEventListener('click', () => {
  thresholdNumber.value = '70';
  saveControl({ threshold: DEFAULT_SETTINGS.threshold });
});
$('theme').addEventListener('change', () =>
  saveControl({ theme: $<HTMLSelectElement>('theme').value as Settings['theme'] }),
);
$('show-not-slop').addEventListener('change', () =>
  saveControl({ showNotSlop: $<HTMLInputElement>('show-not-slop').checked }),
);
$('show-score').addEventListener('change', () =>
  saveControl({ showScore: $<HTMLInputElement>('show-score').checked }),
);
provider.addEventListener('change', async () => {
  const selected = provider.value as Provider;
  key.value = '';
  key.type = 'password';
  $('show-key').textContent = t('Show');
  $('show-key').setAttribute('aria-label', t('Show API key'));
  if (!keyStatus[selected]) {
    saveControl({ provider: selected });
    return;
  }
  connecting = true;
  requestingAccess = true;
  renderConnection();
  try {
    const granted = await chrome.permissions.request({ origins: [PROVIDER_ORIGINS[selected]] });
    if (!granted) throw new Error(`Access to ${PROVIDER_NAMES[selected]} was not granted.`);
    permissionStatus[selected] = true;
    await save({ provider: selected });
    $('message').hidden = true;
  } catch (e) {
    render();
    message((e as Error).message, true);
  } finally {
    connecting = false;
    requestingAccess = false;
    await refresh();
    renderConnection();
  }
});
key.addEventListener('input', renderConnection);
zeroKey.addEventListener('input', renderConnection);
prompt.addEventListener('input', () => {
  promptDirty = true;
  $('prompt-status').textContent = t('Unsaved');
});
$('prompt-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!prompt.value.trim() || prompt.value.length > MAX_PROMPT) {
    message(`Prompt must be 1–${MAX_PROMPT} characters.`, true);
    return;
  }
  const draft = prompt.value;
  try {
    await save({ prompt: draft.trim() });
    if (prompt.value === draft) promptDirty = false;
    render();
    message('');
  } catch (e) {
    message((e as Error).message, true);
  }
});
$('reset-prompt').addEventListener('click', async () => {
  try {
    await save({ prompt: DEFAULT_PROMPT });
    promptDirty = false;
    render();
    message('');
  } catch (e) {
    message((e as Error).message, true);
  }
});
$('show-key').addEventListener('click', () => {
  key.type = key.type === 'password' ? 'text' : 'password';
  $('show-key').textContent = t(key.type === 'password' ? 'Show' : 'Hide');
  $('show-key').setAttribute(
    'aria-label',
    t(key.type === 'password' ? 'Show API key' : 'Hide API key'),
  );
});
$('key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (connecting || connectionCheck) return;
  const selected = settings.provider;
  const candidate = key.value.trim();
  connecting = true;
  requestingAccess = true;
  renderConnection();
  message('');
  try {
    const granted = await chrome.permissions.request({ origins: [PROVIDER_ORIGINS[selected]] });
    if (!granted) throw new Error(`Access to ${PROVIDER_NAMES[selected]} was not granted.`);
    permissionStatus[selected] = true;
    requestingAccess = false;
    renderConnection();
    await saveTask;
    if (candidate) {
      const request = send({ type: 'connect', provider: selected, apiKey: candidate });
      void refresh();
      const result = await request;
      if (!result.ok) throw new Error(result.message);
      settings = result.settings;
      keyStatus = result.keyStatus;
    }
    await refresh();
    key.value = '';
    key.type = 'password';
    $('show-key').textContent = t('Show');
    $('show-key').setAttribute('aria-label', t('Show API key'));
    render();
    connection.open = false;
    message('');
  } catch (e) {
    message((e as Error).message, true);
  } finally {
    connecting = false;
    requestingAccess = false;
    await refresh();
    renderConnection();
  }
});
cancelConnection.addEventListener('click', async () => {
  try {
    await send({ type: 'cancelConnection' });
    await refresh();
  } catch (e) {
    message((e as Error).message, true);
  }
});
$('gptzero-show-key').addEventListener('click', () => {
  zeroKey.type = zeroKey.type === 'password' ? 'text' : 'password';
  $('gptzero-show-key').textContent = t(zeroKey.type === 'password' ? 'Show' : 'Hide');
  $('gptzero-show-key').setAttribute(
    'aria-label',
    t(zeroKey.type === 'password' ? 'Show GPTZero API key' : 'Hide GPTZero API key'),
  );
});
$('gptzero-key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (connecting || connectionCheck) return;
  const candidate = zeroKey.value.trim();
  connecting = true;
  requestingAccess = true;
  render();
  message('');
  try {
    if (!(await chrome.permissions.request({ origins: [GPTZERO_API_ORIGIN] })))
      throw new Error('Access was not granted.');
    requestingAccess = false;
    renderConnection();
    await saveTask;
    if (candidate) {
      const request = send({ type: 'connect', provider: 'gptzero', apiKey: candidate });
      void refresh();
      const result = await request;
      if (!result.ok) throw new Error(result.message);
    }
    zeroKey.value = '';
    zeroKey.type = 'password';
    $('gptzero-show-key').textContent = t('Show');
    $('gptzero-show-key').setAttribute('aria-label', t('Show GPTZero API key'));
    await refresh();
    zeroConnection.open = false;
  } catch (e) {
    message((e as Error).message, true);
  } finally {
    connecting = false;
    requestingAccess = false;
    await refresh();
  }
});
$('gptzero-cancel').addEventListener('click', async () => {
  try {
    await send({ type: 'cancelConnection' });
    await refresh();
  } catch (e) {
    message((e as Error).message, true);
  }
});
$('gptzero-disconnect').addEventListener('click', async () => {
  try {
    await saveTask;
    await send({ type: 'disconnect', provider: 'gptzero' });
    zeroKey.value = '';
    message('');
    await refresh();
  } catch (e) {
    message((e as Error).message, true);
  }
});
$('disconnect').addEventListener('click', async () => {
  try {
    await saveTask;
    const result = await send({ type: 'disconnect', provider: settings.provider });
    settings = result.settings;
    keyStatus = result.keyStatus;
    key.value = '';
    render();
    message('');
  } catch (e) {
    message((e as Error).message, true);
  }
});
$('clear-cache').addEventListener('click', async () => {
  try {
    await send({ type: 'clearCache' });
    message('');
    await refresh();
  } catch (e) {
    message((e as Error).message, true);
  }
});
render();
void refresh()
  .then(async () => {
    await send({ type: 'refreshGptzeroUsage' });
    await refresh();
  })
  .catch(() => {});
setInterval(() => {
  if (document.activeElement !== threshold && document.activeElement !== thresholdNumber)
    void refresh();
}, 2000);
