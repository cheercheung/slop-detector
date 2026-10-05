import { GPTZERO_PROXY_ORIGIN } from './gptzero-config';
import { DEFAULT_PROMPT, DEFAULT_SETTINGS, MAX_PROMPT, PROVIDERS, PROVIDER_NAMES, PROVIDER_ORIGINS, type GptzeroStatus, type ConnectionCheckStatus, type ConnectionCheckResult, type KeyStatus, type Provider, type PublicSettings, type Settings, type Stats } from './shared';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const keyUrls: Record<Provider, string> = { gateway: 'https://vercel.com/d/ai-gateway', openrouter: 'https://openrouter.ai/settings/keys', jev: 'https://console.typesafe.ai/' };
let settings: PublicSettings = { ...DEFAULT_SETTINGS, configured: false, cacheEpoch: 0 };
let keyStatus: KeyStatus = { gateway: false, openrouter: false, jev: false };
let permissionStatus: KeyStatus = { gateway: false, openrouter: false, jev: false };
let gptzero: GptzeroStatus = { available: !!GPTZERO_PROXY_ORIGIN, connected: false, permissionGranted: false, usage: null };
let enablingGptzero = false;
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

async function send<T = any>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.error) throw new Error(response?.error || 'The extension did not respond. Reload it and try again.');
  return response;
}
function message(text: string, error = false) { const el = $('message'); el.textContent = text; el.hidden = false; el.classList.toggle('error', error); }
function renderConnection() {
  const busy = connecting || !!connectionCheck;
  connect.disabled = busy;
  provider.disabled = busy;
  key.disabled = busy;
  $<HTMLButtonElement>('disconnect').disabled = busy;
  const needsAccess = keyStatus[settings.provider] && !permissionStatus[settings.provider];
  key.required = !needsAccess;
  connect.textContent = requestingAccess ? 'Allowing…' : connectionCheck?.phase === 'saving' ? 'Saving…' : busy ? 'Checking…' : needsAccess && !key.value.trim() ? 'Allow access' : 'Connect';
  cancelConnection.hidden = !connectionCheck;
  cancelConnection.disabled = connectionCheck?.phase === 'saving';
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
  $('gptzero-status').textContent = !gptzero.available ? 'GPTZero is not set up in this build. You can use Jev with your own key.' : !gptzero.connected || !gptzero.permissionGranted ? 'Enable free scanning with GPTZero.' : !settings.enabled ? 'Scanning paused' : 'Watching posts, comments & replies';
  const connectZero = $<HTMLButtonElement>('connect-gptzero');
  connectZero.hidden = !gptzero.available || (gptzero.connected && gptzero.permissionGranted);
  connectZero.disabled = enablingGptzero;
  connectZero.textContent = enablingGptzero ? 'Connecting…' : gptzero.connected ? 'Allow access' : 'Enable GPTZero';
  const usage = gptzero.usage;
  const currentUsage = usage && usage.resetsAt > Date.now();
  $('gptzero-usage').hidden = !currentUsage;
  $('gptzero-reset').hidden = !currentUsage;
  if (currentUsage) {
    $('gptzero-usage').textContent = `${usage.remaining.toLocaleString()} / ${usage.limit.toLocaleString()} free checks left`;
    $('gptzero-reset').textContent = `Weekly reset: ${new Date(usage.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. Shared service limits also apply.`;
  }
  $('threshold-help').textContent = zero ? 'Mark Slop when AI + mixed probability reaches this score.' : 'Mark Slop at or above this score.';
  const hasKey = !!keyStatus[settings.provider];
  const configured = hasKey && permissionStatus[settings.provider];
  toggle.setAttribute('aria-checked', String(settings.enabled));
  threshold.value = String(Math.round(settings.threshold * 100));
  $('threshold-value').textContent = `${Math.round(settings.threshold * 100)}%`;
  $<HTMLSelectElement>('theme').value = settings.theme;
  $<HTMLInputElement>('show-not-slop').checked = settings.showNotSlop;
  $<HTMLInputElement>('show-score').checked = settings.showScore;
  if (!promptDirty) prompt.value = settings.prompt;
  $('prompt-status').textContent = promptDirty ? 'Unsaved' : settings.prompt === DEFAULT_PROMPT ? 'Default' : 'Custom';
  $('status-title').textContent = !hasKey ? 'Add an API key to start using Slop Detector' : !configured ? `Allow access to ${PROVIDER_NAMES[settings.provider]} to resume Slop Detector` : settings.enabled ? 'Watching posts, comments & replies' : 'Scanning paused';
  $('provider-section').dataset.configured = String(configured);
  if (!configured) connection.open = true;
  for (const name of PROVIDERS) provider.querySelector(`option[value="${name}"]`)!.textContent = `${PROVIDER_NAMES[name]}${keyStatus[name] ? ' · Saved' : ''}`;
  provider.value = settings.provider;
  $('key-status').textContent = configured ? 'Connected' : hasKey ? 'Allow access' : 'Add key';
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
    const previousCheck = connectionCheck;
    connectionCheck = data.connectionCheck;
    keyStatus = data.keyStatus;
    permissionStatus = data.permissionStatus;
    if (!saveTask && !Object.keys(pending).length) { settings = data.settings; render(); }
    if (!initialized) { connection.open = !settings.configured; initialized = true; }
    if (connectionCheck) {
      connection.open = true;
      if (connectionCheck.id !== previousCheck?.id || connectionCheck.phase !== previousCheck?.phase) message(connectionCheck.phase === 'saving' ? 'Key verified. Saving…' : `Checking your ${PROVIDER_NAMES[connectionCheck.provider]} key. This can take up to 20 seconds.`);
    }
    if (data.connectionResult && data.connectionResult.id > observedResultId && (!connectionCheck || data.connectionResult.id >= connectionCheck.id)) {
      observedResultId = data.connectionResult.id;
      message(data.connectionResult.message, !data.connectionResult.ok);
      if (data.connectionResult.ok && settings.configured && data.connectionResult.provider === settings.provider) connection.open = false;
    }
    renderConnection();
    $('session-count').hidden = !data.stats.evaluated;
    $('session-count').textContent = `${data.stats.evaluated.toLocaleString()} checked this session`;
    if (data.stats.lastError && settings.enabled && settings.configured) $(settings.detector === 'gptzero' ? 'gptzero-status' : 'status-title').textContent = data.stats.lastError;
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
$('detector-gptzero').addEventListener('click', () => { saveControl({ detector: 'gptzero' }); });
$('detector-jev').addEventListener('click', () => { saveControl({ detector: 'jev' }); });
$('connect-gptzero').addEventListener('click', async () => {
  if (enablingGptzero || !GPTZERO_PROXY_ORIGIN) return;
  enablingGptzero = true; render();
  try {
    const granted = await chrome.permissions.request({ origins: [GPTZERO_PROXY_ORIGIN] });
    if (!granted) throw new Error('Access was not granted. Click Enable GPTZero to try again.');
    await saveTask;
    await send({ type: 'connectGptzero' });
    $('message').hidden = true;
  } catch (e) { message((e as Error).message, true); }
  finally { enablingGptzero = false; await refresh(); }
});
toggle.addEventListener('click', () => saveControl({ enabled: !settings.enabled }));
threshold.addEventListener('input', () => { $('threshold-value').textContent = `${threshold.value}%`; });
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
    if (!granted) throw new Error(`Access to ${PROVIDER_NAMES[selected]} was not granted. Your provider has not changed.`);
    permissionStatus[selected] = true;
    await save({ provider: selected });
    $('message').hidden = true;
  } catch (e) { render(); message((e as Error).message, true); }
  finally { connecting = false; requestingAccess = false; await refresh(); renderConnection(); }
});
key.addEventListener('input', renderConnection);
prompt.addEventListener('input', () => { promptDirty = true; $('prompt-status').textContent = 'Unsaved'; });
$('prompt-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!prompt.value.trim() || prompt.value.length > MAX_PROMPT) { message(`Write a prompt between 1 and ${MAX_PROMPT} characters.`, true); return; }
  const draft = prompt.value;
  try {
    await save({ prompt: draft.trim() });
    if (prompt.value === draft) promptDirty = false;
    render(); message('Prompt saved. Visible items are being rechecked.');
  } catch (e) { message((e as Error).message, true); }
});
$('reset-prompt').addEventListener('click', async () => {
  try { await save({ prompt: DEFAULT_PROMPT }); promptDirty = false; render(); message('Default prompt restored.'); }
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
  message(`Allow access to ${PROVIDER_NAMES[selected]} to connect.`);
  try {
    // Calling before any await preserves Chrome's required user gesture.
    const granted = await chrome.permissions.request({ origins: [PROVIDER_ORIGINS[selected]] });
    if (!granted) throw new Error(`Access to ${PROVIDER_NAMES[selected]} was not granted. Click Connect to try again.`);
    permissionStatus[selected] = true;
    requestingAccess = false; renderConnection();
    await saveTask;
    if (candidate) {
      message('Testing your key with a small Jev evaluation…');
      const request = send({ type: 'connect', provider: selected, apiKey: candidate });
      void refresh();
      const result = await request;
      if (!result.ok) throw new Error(result.message);
      settings = result.settings; keyStatus = result.keyStatus;
    }
    await refresh();
    key.value = ''; key.type = 'password'; $('show-key').textContent = 'Show'; $('show-key').setAttribute('aria-label', 'Show API key');
    render(); connection.open = false;
    message('Connected. Posts, comments and replies are checked as you scroll.');
  } catch (e) { message((e as Error).message, true); }
  finally { connecting = false; requestingAccess = false; await refresh(); renderConnection(); }
});
cancelConnection.addEventListener('click', async () => {
  try { await send({ type: 'cancelConnection' }); await refresh(); }
  catch (e) { message((e as Error).message, true); }
});
$('disconnect').addEventListener('click', async () => {
  try { await saveTask; const result = await send({ type: 'disconnect', provider: settings.provider }); settings = result.settings; keyStatus = result.keyStatus; key.value = ''; render(); message('Saved key removed for this provider.'); }
  catch (e) { message((e as Error).message, true); }
});
$('clear-cache').addEventListener('click', async () => {
  try { await send({ type: 'clearCache' }); message('Cache cleared. Visible items are being rechecked.'); await refresh(); }
  catch (e) { message((e as Error).message, true); }
});
void refresh().then(async () => { await send({ type: 'refreshGptzeroUsage' }); await refresh(); }).catch(() => {});
setInterval(() => { if (document.activeElement !== threshold) void refresh(); }, 2000);
