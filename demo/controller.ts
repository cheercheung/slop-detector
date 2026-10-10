import { DEFAULT_SETTINGS, EMPTY_STATS, normalizeSettings, type PublicSettings } from '../src/shared';

type Listener = (message: unknown) => void;
const listeners = new Set<Listener>();
const params = new URLSearchParams(location.search);
let settings: PublicSettings = { ...normalizeSettings({ ...DEFAULT_SETTINGS, theme: params.get('theme') || 'stamp' }), configured: true, cacheEpoch: 0 };
const sourceKeys = { gateway: true, openrouter: true, jev: true };
const feed = document.querySelector<HTMLIFrameElement>('#feed')!;
const panel = document.querySelector<HTMLElement>('#settings-panel')!;
const theme = document.querySelector<HTMLSelectElement>('#demo-theme')!;
const toggle = document.querySelector<HTMLButtonElement>('#settings-toggle')!;
function openSettings(open = true) { panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); }
function update(patch: Record<string, unknown>) {
  settings = { ...settings, ...normalizeSettings({ ...settings, ...patch }) };
  theme.value = settings.theme;
  const url = new URL(location.href); url.searchParams.set('theme', settings.theme); history.replaceState(null, '', url);
  for (const listener of listeners) listener({ type: 'settingsChanged', settings: { ...settings } });
}
// Only these local iframe documents use this in-memory stand-in for Chrome.
// No credentials, storage, external API, or installed extension are involved.
const demo = {
  subscribe(listener: Listener) { listeners.add(listener); return () => listeners.delete(listener); },
  async send(message: any) {
    if (message.type === 'getSettings') return { ...settings };
    if (message.type === 'getDashboard') return {
      settings: { ...settings }, stats: { ...EMPTY_STATS }, keyStatus: sourceKeys, permissionStatus: sourceKeys,
      connectionCheck: null, connectionResult: null, gptzeroConnecting: false,
      gptzero: { available: true, connected: true, permissionGranted: true, personalKeySaved: false, personalPermissionGranted: false, usage: null },
    };
    if (message.type === 'saveSettings') { update(message.settings); return { settings: { ...settings } }; }
    if (message.type === 'openSettings') { openSettings(); return { ok: true }; }
    if (message.type === 'clearCache') { settings.cacheEpoch++; update({}); return { ok: true }; }
    if (message.type === 'refreshGptzeroUsage' || message.type === 'connectGptzero') return { ok: true };
    if (message.type === 'classify') {
      const id = String(message.post.id).match(/(\d+)$/)?.[1];
      const probability = ({ '900000001': .06, '900000002': .97, '900000003': .12, '900000004': .94, '900000005': .03 } as Record<string, number>)[id || ''] ?? .08;
      return { status: 'ok', cached: true, verdict: { probability, evaluatedAt: Date.now(), latencyMs: 0,
        ...(settings.detector === 'gptzero' ? { gptzero: { classification: probability >= .5 ? 'ai' : 'human', probabilities: { ai: probability, mixed: .01, human: 1 - probability - .01 } } } : {}),
      } };
    }
    return { error: 'Demo only. No API key is needed.' };
  },
  escape() { document.body.classList.remove('capture'); resize(); },
};
(window as any).__slopDemo = demo;
function chooseSite(site: string) {
  const linkedIn = site === 'linkedin';
  document.querySelector('#x')!.setAttribute('aria-pressed', String(!linkedIn));
  document.querySelector('#linkedin')!.setAttribute('aria-pressed', String(linkedIn));
  feed.src = linkedIn ? 'linkedin.html' : 'x.html';
  feed.title = linkedIn ? 'Staged LinkedIn feed' : 'Staged X feed';
  const url = new URL(location.href); url.searchParams.set('site', linkedIn ? 'linkedin' : 'x'); history.replaceState(null, '', url);
}
document.querySelector('#x')!.addEventListener('click', () => chooseSite('x'));
document.querySelector('#linkedin')!.addEventListener('click', () => chooseSite('linkedin'));
theme.value = settings.theme;
theme.addEventListener('change', () => update({ theme: theme.value }));
toggle.addEventListener('click', () => openSettings(panel.hidden));
document.querySelector('#capture')!.addEventListener('click', () => { document.body.classList.add('capture'); resize(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') demo.escape(); });
function resize() {
  const margin = document.body.classList.contains('capture') ? 0 : 32;
  document.documentElement.style.setProperty('--scale', String(Math.min(1, (innerWidth - margin) / 1280)));
}
window.addEventListener('resize', resize);
resize();
chooseSite(params.get('site') || 'x');
const settingsFrame = document.querySelector<HTMLIFrameElement>('#settings')!;
settingsFrame.addEventListener('load', () => {
  const body = settingsFrame.contentDocument?.body;
  if (!body) return;
  new ResizeObserver(() => { settingsFrame.style.height = `${Math.min(718, Math.ceil(body.scrollHeight))}px`; }).observe(body);
});
settingsFrame.src = 'popup.html';
