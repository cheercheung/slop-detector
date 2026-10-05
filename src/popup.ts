import { GPTZERO_API_ORIGIN, GPTZERO_PROXY_ORIGIN } from './gptzero-config';
import { DEFAULT_PROMPT, DEFAULT_SETTINGS, MAX_PROMPT, PROVIDERS, PROVIDER_NAMES, PROVIDER_ORIGINS, type GptzeroStatus, type ConnectionCheckStatus, type ConnectionCheckResult, type KeyStatus, type Provider, type PublicSettings, type Settings, type Stats } from './shared';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const keyUrls: Record<Provider, string> = { gateway: 'https://vercel.com/d/ai-gateway', openrouter: 'https://openrouter.ai/settings/keys', jev: 'https://console.typesafe.ai/' };
let settings: PublicSettings = { ...DEFAULT_SETTINGS, configured: false, cacheEpoch: 0 };
let keyStatus: KeyStatus = { gateway: false, openrouter: false, jev: false };
let permissionStatus: KeyStatus = { gateway: false, openrouter: false, jev: false };
let gptzero: GptzeroStatus = { available: !!GPTZERO_PROXY_ORIGIN, connected: false, permissionGranted: false, usage: null };
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
const provider = $<HTMLSelectElement>('provider');
const prompt = $<HTMLTextAreaElement>('prompt');
const key = $<HTMLInputElement>('api-key');
const connect = $<HTMLButtonElement>('connect');
const cancelConnection = $<HTMLButtonElement>('cancel-connection');
const connection = $<HTMLDetailsElement>('connection');
const fillThreshold = () => threshold.style.setProperty('--fill', `${(Number(threshold.value) - Number(threshold.min)) / (Number(threshold.max) - Number(threshold.min)) * 100}%`);
const zeroKey = $<HTMLInputElement>('gptzero-key');
const zeroConnection = $<HTMLDetailsElement>('gptzero-connection');
const zeroSource = $<HTMLSelectElement>('gptzero-source');

async function send<T = any>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.error) throw new Error(response?.error || 'Extension unavailable. Reload it.');
  return response;
}
function message(text: string, error = false) { const el = $('message'); el.textContent = text; el.hidden = !text; el.classList.toggle('error', error); }
function renderConnection() {
  const busy = connecting || !!connectionCheck;
  connect.disabled = busy;
  provider.disabled = busy;
  key.disabled = busy;
  $<HTMLButtonElement>('disconnect').disabled = busy;
  const needsAccess = keyStatus[settings.provider] && !permissionStatus[settings.provider];
  key.required = !needsAccess;
  connect.textContent = requestingAccess ? 'Allowing…' : connectionCheck?.phase === 'saving' ? 'Saving…' : busy ? 'Checking…' : needsAccess && !key.value.trim() ? 'Allow access' : 'Connect';
  cancelConnection.hidden = !connectionCheck || connectionCheck.provider === 'gptzero';
  cancelConnection.disabled = connectionCheck?.phase === 'saving';
  const zeroNeedsAccess = gptzero.personalKeySaved && !gptzero.personalPermissionGranted;
  zeroKey.required = !zeroNeedsAccess;
  zeroKey.disabled = busy;
  zeroSource.disabled = busy || enablingGptzero || gptzeroConnecting;
  $<HTMLButtonElement>('gptzero-connect').disabled = busy;
  $('gptzero-connect').textContent = requestingAccess ? 'Allowing…' : connectionCheck?.phase === 'saving' ? 'Saving…' : busy ? 'Checking…' : zeroNeedsAccess && !zeroKey.value.trim() ? 'Allow access' : 'Connect';
  $('gptzero-cancel').hidden = connectionCheck?.provider !== 'gptzero';
  $<HTMLButtonElement>('gptzero-cancel').disabled = connectionCheck?.phase === 'saving';
  $<HTMLButtonElement>('gptzero-disconnect').disabled = busy;
}
function render() {
  const zero = settings.detector === 'gptzero';
  $('gptzero-section').hidden = !zero;
  $('provider-section').hidden = zero;
  $('prompt-section').hidden = zero;
  $('detector-gptzero').setAttribute('aria-pressed', String(zero));
  $('detector-jev').setAttribute('aria-pressed', String(!zero));
  const attribution = $<HTMLAnchorElement>('attribution');
  attribution.textContent = zero ? 'Powered by GPTZero' : 'Powered by Jev';
  attribution.href = zero ? 'https://gptzero.me/' : 'https://typesafe.ai/';
  const personal = settings.gptzeroSource === 'personal';
  const busy = enablingGptzero || gptzeroConnecting;
  $<HTMLButtonElement>('detector-gptzero').disabled = busy || connecting || !!connectionCheck;
  $<HTMLButtonElement>('detector-jev').disabled = busy || connecting || !!connectionCheck;
  $('detector-gptzero').setAttribute('aria-busy', String(busy));
  const status = !personal && !gptzero.available ? 'Free scanning unavailable' : busy ? 'Connecting…' : !settings.enabled ? 'Paused' : '';
  $('gptzero-status').textContent = status;
  $('gptzero-status').hidden = !status;
  const usage = gptzero.usage;
  const currentUsage = !personal && usage && usage.resetsAt > Date.now();
  $('gptzero-section').hidden = !zero;
  $('gptzero-plan').textContent = personal ? 'Your key' : 'Free';
  zeroSource.value = settings.gptzeroSource;
  zeroConnection.hidden = !personal;
  if (personal && (!gptzero.personalKeySaved || !gptzero.personalPermissionGranted)) zeroConnection.open = true;
  $('gptzero-key-status').textContent = gptzero.personalKeySaved ? gptzero.personalPermissionGranted ? 'Connected' : 'Allow access' : 'Add key';
  $('gptzero-key-status').dataset.state = gptzero.personalKeySaved && gptzero.personalPermissionGranted ? 'ok' : '';
  $('gptzero-disconnect').hidden = !gptzero.personalKeySaved;
  zeroKey.placeholder = gptzero.personalKeySaved ? 'Paste a replacement key' : 'Paste your GPTZero API key';
  $('gptzero-usage').hidden = !currentUsage;
  $('gptzero-reset').hidden = !currentUsage;
  $('gptzero-meter').hidden = !currentUsage;
  if (currentUsage) {
    const left = usage.limit ? Math.min(1, usage.remaining / usage.limit) : 0;
    $('gptzero-meter').dataset.low = String(left <= .1);
    ($('gptzero-meter').firstElementChild as HTMLElement).style.width = `${left * 100}%`;
    $('gptzero-usage').textContent = `${usage.remaining.toLocaleString()} / ${usage.limit.toLocaleString()} free checks left`;
    $('gptzero-reset').textContent = `Resets ${new Date(usage.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
  }
  const hasKey = !!keyStatus[settings.provider];
  const configured = hasKey && permissionStatus[settings.provider];
  toggle.setAttribute('aria-checked', String(settings.enabled));
  threshold.value = String(Math.round(settings.threshold * 100));
  $('threshold-value').textContent = `${Math.round(settings.threshold * 100)}%`;
  fillThreshold();
  $<HTMLSelectElement>('theme').value = settings.theme;
  $<HTMLInputElement>('show-not-slop').checked = settings.showNotSlop;
  $<HTMLInputElement>('show-score').checked = settings.showScore;
  if (!promptDirty) prompt.value = settings.prompt;
  $('prompt-status').textContent = promptDirty ? 'Unsaved' : settings.prompt === DEFAULT_PROMPT ? 'Default' : 'Custom';
  $('status-title').textContent = settings.enabled ? '' : 'Paused';
  $('status-title').hidden = settings.enabled;
  $('provider-section').dataset.configured = String(configured);
  if (!configured) connection.open = true;
  for (const name of PROVIDERS) provider.querySelector(`option[value="${name}"]`)!.textContent = `${PROVIDER_NAMES[name]}${keyStatus[name] ? ' · Saved' : ''}`;
  provider.value = settings.provider;
  $('key-status').textContent = configured ? 'Connected' : hasKey ? 'Allow access' : 'Add key';
  $('key-status').dataset.state = configured ? 'ok' : '';
  $('key-label').textContent = `${PROVIDER_NAMES[settings.provider]} API key`;
  $<HTMLAnchorElement>('get-key').href = keyUrls[settings.provider];
  $('disconnect').hidden = !keyStatus[settings.provider];
  key.placeholder = keyStatus[settings.provider] ? 'Paste a replacement key' : 'Paste your API key';
  renderConnection();
}
async function refresh() {
  try {
    const data = await send<{ settings: PublicSettings; stats: Stats; keyStatus: KeyStatus; permissionStatus: KeyStatus; connectionCheck: ConnectionCheckStatus | null; connectionResult: ConnectionCheckResult | null; gptzero: GptzeroStatus; gptzeroConnecting: boolean }>({ type: 'getDashboard' });
    gptzero = data.gptzero;
    gptzeroConnecting = data.gptzeroConnecting;
    connectionCheck = data.connectionCheck;
    keyStatus = data.keyStatus;
    permissionStatus = data.permissionStatus;
    if (!saveTask && !Object.keys(pending).length) { settings = data.settings; render(); }
    if (!initialized) { connection.open = !settings.configured; initialized = true; }
    if (connectionCheck) (connectionCheck.provider === 'gptzero' ? zeroConnection : connection).open = true;
    if (data.connectionResult && data.connectionResult.id > observedResultId && (!connectionCheck || data.connectionResult.id >= connectionCheck.id)) {
      observedResultId = data.connectionResult.id;
      if (!data.connectionResult.ok) message(data.connectionResult.message, true);
      if (data.connectionResult.ok && settings.configured && data.connectionResult.provider === settings.provider) connection.open = false;
      if (data.connectionResult.ok && data.connectionResult.provider === 'gptzero') zeroConnection.open = false;
    }
    renderConnection();
    $('session-count').hidden = !data.stats.evaluated;
    $('session-count').textContent = `${data.stats.evaluated.toLocaleString()} checked this session`;
    if (data.stats.lastError && settings.enabled && settings.configured) {
      const status = $(settings.detector === 'gptzero' ? 'gptzero-status' : 'status-title');
      status.textContent = data.stats.lastError; status.hidden = false;
      if (settings.detector === 'gptzero') $('gptzero-section').hidden = false;
    }
  } catch (e) { message((e as Error).message, true); }
}
function save(patch: Partial<Settings>): Promise<void> {
  Object.assign(settings, patch);
  Object.assign(pending, patch);
  render();
  if (!saveTask) {
    saveTask = (async () => {
      while (Object.keys(pending).length) {
        const patch = pending; pending = {};
        const result = await send({ type: 'saveSettings', settings: patch });
        settings = { ...result.settings, ...pending };
      }
    })().finally(() => { saveTask = undefined; void refresh(); });
  }
  return saveTask;
}
function saveControl(patch: Partial<Settings>) { $('message').hidden = true; void save(patch).catch(e => message(e.message, true)); }
$('detector-jev').addEventListener('click', () => { saveControl({ detector: 'jev' }); });
$('detector-gptzero').addEventListener('click', () => { void activateGptzero(settings.gptzeroSource); });
zeroSource.addEventListener('change', () => { void activateGptzero(zeroSource.value as Settings['gptzeroSource']); });
async function activateGptzero(source: Settings['gptzeroSource']) {
  if (enablingGptzero || gptzeroConnecting) return;
  enablingGptzero = true; render();
  try {
    // Keep the permission request inside the tab click's user gesture.
    const origin = source === 'personal' ? gptzero.personalKeySaved ? GPTZERO_API_ORIGIN : '' : GPTZERO_PROXY_ORIGIN;
    if (origin && !await chrome.permissions.request({ origins: [origin] })) throw new Error('Access was not granted.');
    await saveTask;
    if (source === 'free' && origin && !gptzero.connected) await send({ type: 'connectGptzero' });
    await save({ detector: 'gptzero', gptzeroSource: source, enabled: true });
    $('message').hidden = true;
  } catch (e) { message((e as Error).message, true); }
  finally { enablingGptzero = false; await refresh(); }
}
toggle.addEventListener('click', () => saveControl({ enabled: !settings.enabled }));
threshold.addEventListener('input', () => { $('threshold-value').textContent = `${threshold.value}%`; fillThreshold(); });
threshold.addEventListener('change', () => saveControl({ threshold: Number(threshold.value) / 100 }));
$('theme').addEventListener('change', () => saveControl({ theme: $<HTMLSelectElement>('theme').value as Settings['theme'] }));
$('show-not-slop').addEventListener('change', () => saveControl({ showNotSlop: $<HTMLInputElement>('show-not-slop').checked }));
$('show-score').addEventListener('change', () => saveControl({ showScore: $<HTMLInputElement>('show-score').checked }));
provider.addEventListener('change', async () => {
  const selected = provider.value as Provider;
  key.value = ''; key.type = 'password'; $('show-key').textContent = 'Show'; $('show-key').setAttribute('aria-label', 'Show API key');
  if (!keyStatus[selected]) { saveControl({ provider: selected }); return; }
  connecting = true; requestingAccess = true; renderConnection();
  try {
    // Request directly in this user gesture, before awaiting saved settings.
    const granted = await chrome.permissions.request({ origins: [PROVIDER_ORIGINS[selected]] });
    if (!granted) throw new Error(`Access to ${PROVIDER_NAMES[selected]} was not granted.`);
    permissionStatus[selected] = true;
    await save({ provider: selected });
    $('message').hidden = true;
  } catch (e) { render(); message((e as Error).message, true); }
  finally { connecting = false; requestingAccess = false; await refresh(); renderConnection(); }
});
key.addEventListener('input', renderConnection);
zeroKey.addEventListener('input', renderConnection);
prompt.addEventListener('input', () => { promptDirty = true; $('prompt-status').textContent = 'Unsaved'; });
$('prompt-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!prompt.value.trim() || prompt.value.length > MAX_PROMPT) { message(`Prompt must be 1–${MAX_PROMPT} characters.`, true); return; }
  const draft = prompt.value;
  try {
    await save({ prompt: draft.trim() });
    if (prompt.value === draft) promptDirty = false;
    render(); message('');
  } catch (e) { message((e as Error).message, true); }
});
$('reset-prompt').addEventListener('click', async () => {
  try { await save({ prompt: DEFAULT_PROMPT }); promptDirty = false; render(); message(''); }
  catch (e) { message((e as Error).message, true); }
});
$('show-key').addEventListener('click', () => {
  key.type = key.type === 'password' ? 'text' : 'password';
  $('show-key').textContent = key.type === 'password' ? 'Show' : 'Hide';
  $('show-key').setAttribute('aria-label', key.type === 'password' ? 'Show API key' : 'Hide API key');
});
$('key-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (connecting || connectionCheck) return;
  const selected = settings.provider;
  const candidate = key.value.trim();
  connecting = true; requestingAccess = true;
  renderConnection();
  message('');
  try {
    // Calling before any await preserves Chrome's required user gesture.
    const granted = await chrome.permissions.request({ origins: [PROVIDER_ORIGINS[selected]] });
    if (!granted) throw new Error(`Access to ${PROVIDER_NAMES[selected]} was not granted.`);
    permissionStatus[selected] = true;
    requestingAccess = false; renderConnection();
    await saveTask;
    if (candidate) {
      const request = send({ type: 'connect', provider: selected, apiKey: candidate });
      void refresh();
      const result = await request;
      if (!result.ok) throw new Error(result.message);
      settings = result.settings; keyStatus = result.keyStatus;
    }
    await refresh();
    key.value = ''; key.type = 'password'; $('show-key').textContent = 'Show'; $('show-key').setAttribute('aria-label', 'Show API key');
    render(); connection.open = false;
    message('');
  } catch (e) { message((e as Error).message, true); }
  finally { connecting = false; requestingAccess = false; await refresh(); renderConnection(); }
});
cancelConnection.addEventListener('click', async () => {
  try { await send({ type: 'cancelConnection' }); await refresh(); }
  catch (e) { message((e as Error).message, true); }
});
$('gptzero-show-key').addEventListener('click', () => {
  zeroKey.type = zeroKey.type === 'password' ? 'text' : 'password';
  $('gptzero-show-key').textContent = zeroKey.type === 'password' ? 'Show' : 'Hide';
  $('gptzero-show-key').setAttribute('aria-label', zeroKey.type === 'password' ? 'Show GPTZero API key' : 'Hide GPTZero API key');
});
$('gptzero-key-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (connecting || connectionCheck) return;
  const candidate = zeroKey.value.trim();
  connecting = true; requestingAccess = true; render(); message('');
  try {
    if (!await chrome.permissions.request({ origins: [GPTZERO_API_ORIGIN] })) throw new Error('Access was not granted.');
    requestingAccess = false; renderConnection();
    await saveTask;
    if (candidate) {
      const request = send({ type: 'connect', provider: 'gptzero', apiKey: candidate });
      void refresh();
      const result = await request;
      if (!result.ok) throw new Error(result.message);
    }
    zeroKey.value = ''; zeroKey.type = 'password';
    $('gptzero-show-key').textContent = 'Show'; $('gptzero-show-key').setAttribute('aria-label', 'Show GPTZero API key');
    await refresh(); zeroConnection.open = false;
  } catch (e) { message((e as Error).message, true); }
  finally { connecting = false; requestingAccess = false; await refresh(); }
});
$('gptzero-cancel').addEventListener('click', async () => {
  try { await send({ type: 'cancelConnection' }); await refresh(); }
  catch (e) { message((e as Error).message, true); }
});
$('gptzero-disconnect').addEventListener('click', async () => {
  try { await saveTask; await send({ type: 'disconnect', provider: 'gptzero' }); zeroKey.value = ''; message(''); await refresh(); }
  catch (e) { message((e as Error).message, true); }
});
$('disconnect').addEventListener('click', async () => {
  try { await saveTask; const result = await send({ type: 'disconnect', provider: settings.provider }); settings = result.settings; keyStatus = result.keyStatus; key.value = ''; render(); message(''); }
  catch (e) { message((e as Error).message, true); }
});
$('clear-cache').addEventListener('click', async () => {
  try { await send({ type: 'clearCache' }); message(''); await refresh(); }
  catch (e) { message((e as Error).message, true); }
});
void refresh().then(async () => { await send({ type: 'refreshGptzeroUsage' }); await refresh(); }).catch(() => {});
setInterval(() => { if (document.activeElement !== threshold) void refresh(); }, 2000);
