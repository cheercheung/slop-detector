import {
  dimContent,
  extractPost,
  findPosts,
  labelAlignmentAnchor,
  labelAnchor,
  ownsNode,
} from './extract';
import { fontReady } from './font';
import { resolveLanguage, translate } from './i18n';
import {
  type Classification,
  DEFAULT_SETTINGS,
  detectionChanged,
  hasReadableText,
  isSlopVerdict,
  type Post,
  type PublicSettings,
  postContentKey,
  type Verdict,
} from './shared';
import { createStamp, type SlopStamp } from './stamp';

type Entry = {
  article: HTMLElement;
  host: HTMLElement;
  button: HTMLButtonElement;
  post: Post;
  fingerprint: string;
  visible: boolean;
  visibleSince: number;
  visibilityTarget?: HTMLElement;
  radarAnchor?: HTMLElement;
  state: 'idle' | 'pending' | 'done' | 'error' | 'unrated';
  attempts: number;
  nextTry: number;
  verdict?: Verdict;
  stamp?: SlopStamp;
  error?: string;
  quota?: boolean;
  token: number;
  concealed: HTMLElement[];
  revealed: boolean;
  reveal: HTMLButtonElement;
};
const entries = new Map<HTMLElement, Entry>();
const visibilityTargets = new Map<Element, Entry>();
const radarAnchors = new Map<HTMLElement, number>();
const VISIBLE_DELAY = 250;
const linkedIn = location.hostname === 'linkedin.com' || location.hostname === 'www.linkedin.com';
const alignmentResize = new ResizeObserver((changes) => {
  for (const change of changes) {
    const entry = entries.get(change.target as HTMLElement);
    if (entry) {
      alignLabel(entry);
      positionRadar(entry);
    }
  }
});
let settings: PublicSettings = { ...DEFAULT_SETTINGS, configured: false, cacheEpoch: 0 };
const t = (text: string, values?: Record<string, string | number>) =>
  translate(settings.language, text, values);
let running = 0;
let alive = true;
let scanTimer: ReturnType<typeof setTimeout> | undefined;
let pumpTimer: ReturnType<typeof setTimeout> | undefined;
let viewportFrame = 0;

const CSS = `
:host{display:block!important;box-sizing:border-box!important;margin:8px 0!important;padding:0 var(--jev-label-right,0px) 0 var(--jev-label-left,0px)!important;clear:both;position:relative;z-index:1;font-family:"Slop Geist",sans-serif;color-scheme:light dark}
:host([hidden]){display:none!important}
:host([data-tone=clean]),:host([data-tone=slop]),:host([data-tone=pending]){margin:4px 0!important;font-size:12px;line-height:0}
:host([data-floating]){position:absolute!important;left:var(--jev-radar-left,0px)!important;top:var(--jev-radar-top,0px)!important;width:20px!important;height:0!important;min-height:0!important;margin:0!important;padding:0!important;pointer-events:none}
:host([data-tone=paused]){margin:2px 0!important;font-size:11px;line-height:1.4}
:host([data-collapsed]){margin:4px 0!important}
:host([data-collapsed]) .badge{display:none}
:host([data-collapsed]) .reveal{display:flex;width:100%;margin:0;justify-content:space-between;gap:12px;text-align:left;text-decoration:none;padding:9px 12px;border-color:transparent;border-radius:8px;background:light-dark(#f7f7f6,#1c1c1c);font-size:12.5px;line-height:1.4;transition:background .12s}
:host([data-collapsed]) .reveal:hover{background:light-dark(#f0f0ef,#252525)}
:host([data-collapsed]) .reveal .what{font-weight:500;color:light-dark(#1a1a1a,#ededed)}
:host([data-collapsed]) .reveal .sep,:host([data-collapsed]) .reveal .act,:host([data-collapsed]) .reveal .score{color:light-dark(#767676,#999);transition:color .12s}
:host([data-collapsed]) .reveal:hover .act{color:light-dark(#1a1a1a,#ededed);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
:host([data-collapsed]) .reveal .score{opacity:1;padding:0;border:0;font-variant-numeric:tabular-nums}
@media(prefers-reduced-motion:reduce){.reveal,.reveal *{transition:none!important}}
*{box-sizing:border-box;font-family:"Slop Geist",sans-serif}.badge,.reveal{display:inline-flex;align-items:center;gap:7px;border:1px solid light-dark(#d4d4d4,#555);border-radius:3px;padding:5px 8px;background:light-dark(#fff,#181818);color:light-dark(#333,#ddd);font-size:11px;font-weight:400;line-height:1.2;cursor:pointer}.badge:focus-visible,.reveal:focus-visible{outline:2px solid currentColor;outline-offset:3px}.score{opacity:.65;padding-left:7px;border-left:1px solid light-dark(#ddd,#555)}.badge[data-tone=slop]{font-weight:700;border-color:light-dark(#333,#aaa)}.badge[data-tone=pending]{opacity:.6}.reveal{margin-left:6px;text-decoration:underline;text-underline-offset:2px}.reveal[hidden]{display:none}
.badge[data-tone=clean]{gap:6px;min-height:24px;padding:3px 0;border:0;background:transparent;color:light-dark(#646464,#aaa);font-size:12px;font-weight:500;line-height:1.4}
.badge[data-tone=clean] .check{width:13px;height:13px;flex:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;fill:none}
.badge[data-tone=clean] .score{display:inline-flex;align-items:center;gap:6px;opacity:1;padding:0;border:0;color:light-dark(#767676,#999);font-weight:400;font-variant-numeric:tabular-nums}
.badge[data-tone=clean] .score::before{content:'·'}
.badge[data-tone=clean]:hover{color:light-dark(#202020,#eee)}
.badge[data-tone=clean]:hover .label-text{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.badge[data-tone=clean],.badge[data-tone=slop],.badge[data-tone=pending]{height:24px;vertical-align:top}
.badge[data-tone=pending]{width:24px;justify-content:center;padding:0;border:0;background:transparent;color:light-dark(#858585,#969696);opacity:1;cursor:default}
.badge[data-tone=pending] .label-text{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.radar{display:block;width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}
.radar-sweep{transform-origin:12px 12px}
:host([data-scanning]) .radar-sweep{animation:radar-sweep 2.4s linear infinite}
:host([data-floating]) .badge{width:20px;height:20px}
:host([data-floating]) .radar{width:16px;height:16px}
@keyframes radar-sweep{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){:host([data-scanning]) .radar-sweep{animation:none}}
.badge[data-tone=paused]{padding:0;border:0;border-radius:0;background:transparent;color:light-dark(#767676,#969696);font-size:11px;font-weight:400;line-height:1.4}
.badge[data-tone=paused]:hover{color:light-dark(#555,#bbb);text-decoration:underline;text-underline-offset:3px}
`;

const dimStyle = document.createElement('style');
dimStyle.textContent = `[data-jev-concealed="true"]{display:none!important}[data-jev-collapsed="true"]{min-height:0!important;padding-top:8px!important;padding-bottom:8px!important}[data-jev-dimmed="true"]{opacity:.38;transition:opacity .15s}[data-jev-dimmed="true"]:hover{opacity:1}[data-jev-stamp-position="true"],[data-jev-radar-anchor="true"]{position:relative!important}`;
document.documentElement.append(dimStyle);

function clearDim(article: HTMLElement) {
  article.removeAttribute('data-jev-dim');
  article.querySelectorAll('[data-jev-dimmed]').forEach((node) => {
    if (node.closest('[data-jev-target]') === article) node.removeAttribute('data-jev-dimmed');
  });
}
function applyDim(article: HTMLElement) {
  const targets = new Set(dimContent(article));
  if (article.getAttribute('data-jev-dim') !== 'true') article.setAttribute('data-jev-dim', 'true');
  article.querySelectorAll<HTMLElement>('[data-jev-dimmed]').forEach((node) => {
    if (node.closest('[data-jev-target]') === article && !targets.has(node))
      node.removeAttribute('data-jev-dimmed');
  });
  for (const node of targets) {
    if (node.getAttribute('data-jev-dimmed') !== 'true')
      node.setAttribute('data-jev-dimmed', 'true');
  }
}
function clearConcealed(entry: Entry) {
  entry.article.removeAttribute('data-jev-collapsed');
  for (const node of entry.concealed) node.removeAttribute('data-jev-concealed');
  entry.concealed = [];
}
function alignLabel(entry: Entry) {
  if (
    !linkedIn ||
    !entry.host.isConnected ||
    entry.host.hidden ||
    entry.host.hasAttribute('data-floating')
  )
    return;
  const anchor = labelAlignmentAnchor(entry.article);
  if (!anchor) return;
  const text = anchor.getBoundingClientRect(),
    host = entry.host.getBoundingClientRect();

  if (!text.width || !text.height || !host.width) return;
  const css = getComputedStyle(anchor);
  const left = Math.max(
    0,
    text.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft) - host.left,
  );
  const right = Math.max(
    0,
    host.right - text.right + parseFloat(css.borderRightWidth) + parseFloat(css.paddingRight),
  );
  for (const [property, value] of [
    ['--jev-label-left', left],
    ['--jev-label-right', right],
  ] as const) {
    const pixels = `${Math.round(value * 100) / 100}px`;
    if (entry.host.style.getPropertyValue(property) !== pixels)
      entry.host.style.setProperty(property, pixels);
  }
}
function releaseRadarAnchor(entry: Entry) {
  const anchor = entry.radarAnchor;
  if (!anchor) return;
  const count = (radarAnchors.get(anchor) ?? 1) - 1;
  if (count) radarAnchors.set(anchor, count);
  else {
    radarAnchors.delete(anchor);
    anchor.removeAttribute('data-jev-radar-anchor');
  }
  entry.radarAnchor = undefined;
}
function positionRadar(entry: Entry) {
  const floating =
    !entry.host.hidden && entry.host.hasAttribute('data-floating') && entry.host.isConnected;
  let container = floating ? entry.host.parentElement : null;

  while (container && ['contents', 'inline'].includes(getComputedStyle(container).display))
    container = container.parentElement;
  if (entry.radarAnchor !== container) {
    releaseRadarAnchor(entry);
    if (container) {
      if (getComputedStyle(container).position === 'static')
        container.setAttribute('data-jev-radar-anchor', 'true');
      radarAnchors.set(container, (radarAnchors.get(container) ?? 0) + 1);
      entry.radarAnchor = container;
    }
  }
  const anchor = floating && (labelAlignmentAnchor(entry.article) ?? labelAnchor(entry.article));
  if (!container || !anchor) return;
  const text = anchor.getBoundingClientRect(),
    bounds = container.getBoundingClientRect();
  if (!text.width || !text.height) return;
  const css = getComputedStyle(anchor);

  const marker = entry.button.getBoundingClientRect();
  const scaleX = marker.width / entry.button.offsetWidth || 1;
  const scaleY = marker.height / entry.button.offsetHeight || 1;
  const left =
    (text.left - bounds.left) / scaleX -
    container.clientLeft +
    container.scrollLeft +
    parseFloat(css.paddingLeft) +
    parseFloat(css.borderLeftWidth);
  const top = (text.bottom - bounds.top) / scaleY - container.clientTop + container.scrollTop + 1;
  for (const [property, value] of [
    ['--jev-radar-left', left],
    ['--jev-radar-top', top],
  ] as const) {
    const pixels = `${Math.round(value * 100) / 100}px`;
    if (entry.host.style.getPropertyValue(property) !== pixels)
      entry.host.style.setProperty(property, pixels);
  }
}
function effects(entry: Entry) {
  const slop =
    settings.enabled &&
    settings.configured &&
    entry.verdict &&
    isSlopVerdict(entry.verdict, settings.threshold);

  if (slop && settings.theme === 'fade') applyDim(entry.article);
  else clearDim(entry.article);
  clearConcealed(entry);
  alignLabel(entry);
  positionRadar(entry);
  if (!slop || settings.theme !== 'stamp') {
    entry.stamp?.destroy();
    entry.stamp = undefined;
  }
  const collapsed = !!slop && settings.theme === 'hide' && !entry.revealed;
  entry.host.toggleAttribute('data-collapsed', collapsed);
  entry.reveal.hidden = !slop || settings.theme !== 'hide';
  entry.reveal.textContent = entry.revealed ? t('Hide post') : '';
  if (!entry.revealed) {
    const text = document.createElement('span');
    for (const [name, value] of [
      ['what', 'Slop detected'],
      ['sep', ' - '],
      ['act', 'Show post'],
    ] as const) {
      const part = document.createElement('span');
      part.className = name;
      part.textContent = t(value);
      text.append(part);
    }
    entry.reveal.append(text);
  }
  if (collapsed && settings.showScore) {
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = `${Math.round(entry.verdict!.probability * 100)}%`;
    entry.reveal.append(score);
  }
  entry.reveal.setAttribute('aria-expanded', String(entry.revealed));
  if (!slop) return;
  if (settings.theme === 'stamp' && !entry.stamp) entry.stamp = createStamp(entry.article);
  if (collapsed) {
    entry.article.setAttribute('data-jev-collapsed', 'true');

    const conceal = (parent: HTMLElement) => {
      for (const node of Array.from(parent.children)) {
        if (
          !(node instanceof HTMLElement) ||
          node === entry.host ||
          node.matches('[data-jev-target], jev-slop-stamp, style, script')
        )
          continue;
        if (node.contains(entry.host) || node.querySelector('[data-jev-target]')) conceal(node);
        else {
          node.setAttribute('data-jev-concealed', 'true');
          entry.concealed.push(node);
        }
      }
    };
    conceal(entry.article);
  }
}
function label(entry: Entry, text: string, tone = 'neutral', detail = '', score?: number) {
  text = t(text);
  detail = t(detail);
  entry.host.lang = resolveLanguage(settings.language);
  entry.host.dataset.tone = tone;
  entry.host.toggleAttribute('data-floating', tone === 'pending' && !settings.showNotSlop);
  entry.host.toggleAttribute('data-scanning', tone === 'pending' && entry.state === 'pending');
  entry.button.dataset.tone = tone;
  entry.button.disabled = tone === 'pending';
  entry.button.replaceChildren();
  if (tone === 'pending') {
    entry.button.innerHTML = `<svg class="radar" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" stroke-width="1.3" opacity=".8"/><circle cx="12" cy="12" r="4.85" stroke-width="1.15" opacity=".55"/><g class="radar-sweep"><path d="M12 12V3a9 9 0 0 1 6.364 2.636Z" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="m12 12 6.364-6.364" stroke-width="1.4"/></g><circle cx="6.7" cy="16.15" r="1.2" fill="currentColor" stroke="none"/></svg>`;
  }
  if (tone === 'clean') {
    const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    check.setAttribute('class', 'check');
    check.setAttribute('viewBox', '0 0 14 14');
    check.setAttribute('aria-hidden', 'true');
    check.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M2.5 7 5.5 10 11.5 4');
    check.append(path);
    entry.button.append(check);
  }
  const title = document.createElement('span');
  title.className = 'label-text';
  title.textContent = text;
  entry.button.append(title);
  if (score !== undefined && settings.showScore) {
    const s = document.createElement('span');
    s.className = 'score';
    s.textContent = `${Math.round(score * 100)}%`;
    entry.button.append(s);
  }
  entry.button.setAttribute(
    'aria-label',
    `${score !== undefined && settings.showScore ? t('{text}, {score} percent confidence', { text, score: Math.round(score * 100) }) : text}${tone === 'pending' ? '' : `. ${t(tone === 'error' ? 'Retry this post' : 'Open Slop Detector settings')}.`}`,
  );
  entry.button.title = detail;
  entry.host.hidden = !settings.showNotSlop && (tone === 'clean' || tone === 'pending');
  effects(entry);
}
function paint(entry: Entry) {
  if (!hasReadableText(entry.post)) {
    entry.host.hidden = true;
    effects(entry);
    return;
  }
  const detectorName =
    settings.detector === 'gptzero'
      ? 'GPTZero'
      : settings.provider === 'evolink'
        ? 'Luna Decision'
        : 'Jev';
  if (!settings.enabled) {
    label(entry, 'Detector paused', 'paused', 'Open Slop Detector settings');
    return;
  }
  if (!settings.configured && settings.detector === 'gptzero') {
    label(
      entry,
      settings.permissionRequired
        ? 'Allow GPTZero access'
        : settings.gptzeroSource === 'personal'
          ? 'Connect GPTZero'
          : 'Enable GPTZero',
      'paused',
      'Open Slop Detector settings',
    );
    return;
  }
  if (!settings.configured) {
    label(
      entry,
      settings.permissionRequired ? 'Allow provider access' : `Connect ${detectorName}`,
      'neutral',
      'Open Slop Detector settings',
    );
    return;
  }
  if (entry.verdict) {
    const v = entry.verdict;
    const slop = isSlopVerdict(v, settings.threshold);
    const text = slop ? 'Slop' : 'Not slop';
    const confidence = slop ? v.probability : 1 - v.probability;
    label(entry, text, slop ? 'slop' : 'clean', 'Open Slop Detector settings', confidence);
  } else if (entry.state === 'unrated') {
    label(entry, 'Unrated', 'neutral', entry.error || 'Unable to rate this text');
  } else if (entry.state === 'error') {
    label(
      entry,
      entry.quota ? 'Free limit reached' : 'Couldn’t rate · retry',
      entry.quota ? 'paused' : 'error',
      entry.error || 'Retry this post',
    );
  } else {
    label(
      entry,
      entry.state === 'pending' ? `Checking with ${detectorName}` : `Queued for ${detectorName}`,
      'pending',
      entry.state === 'pending' ? `Checking with ${detectorName}` : 'Queued',
    );
  }
}
function makeEntry(article: HTMLElement, post: Post): Entry {
  article.querySelectorAll('jev-slop-label, jev-slop-stamp').forEach((node) => {
    if (ownsNode(article, node)) node.remove();
  });
  article.setAttribute('data-jev-target', 'true');
  article.removeAttribute('data-jev-collapsed');
  article.querySelectorAll('[data-jev-concealed]').forEach((node) => {
    if (node.closest('[data-jev-target]') === article) node.removeAttribute('data-jev-concealed');
  });
  clearDim(article);
  article.removeAttribute('data-jev-stamped');
  article.removeAttribute('data-jev-stamp-position');
  for (const node of [
    article,
    ...article.querySelectorAll<HTMLElement>('[data-jev-radar-anchor]'),
  ]) {
    if (ownsNode(article, node) && !radarAnchors.has(node))
      node.removeAttribute('data-jev-radar-anchor');
  }
  const host = document.createElement('jev-slop-label');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'badge';
  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.className = 'reveal';
  reveal.hidden = true;
  shadow.append(style, button, reveal);
  const entry: Entry = {
    article,
    host,
    button,
    post,
    fingerprint: `${post.id}:${postContentKey(post, settings)}`,
    visible: false,
    visibleSince: 0,
    state: 'idle',
    attempts: 0,
    nextTry: 0,
    token: 0,
    concealed: [],
    revealed: false,
    reveal,
  };
  reveal.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    entry.revealed = !entry.revealed;
    effects(entry);
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.tone === 'error') {
      entry.state = 'idle';
      entry.attempts = 0;
      entry.nextTry = 0;
      paint(entry);
      pump();
      return;
    }
    void chrome.runtime.sendMessage({ type: 'openSettings' }).catch(() => {
      button.title = 'Reload this page';
    });
  });
  placeHost(entry);
  paint(entry);
  return entry;
}
function placeHost(entry: Entry) {
  const text = labelAnchor(entry.article);
  const header = Array.from(
    entry.article.querySelectorAll<HTMLElement>('[data-testid="User-Name"]'),
  ).find((node) => ownsNode(entry.article, node));
  if (text?.parentElement) text.insertAdjacentElement('afterend', entry.host);
  else if (header) {
    const anchor =
      header.parentElement && header.parentElement !== entry.article
        ? header.parentElement
        : header;
    anchor.insertAdjacentElement('afterend', entry.host);
  } else entry.article.append(entry.host);
  alignLabel(entry);
}
function updateVisibility(changes: IntersectionObserverEntry[]) {
  for (const change of changes) {
    const entry = visibilityTargets.get(change.target);
    if (!entry) continue;
    const visible =
      change.isIntersecting &&
      change.intersectionRect.width > 0 &&
      change.intersectionRect.height > 0;
    if (!visible || !entry.visible) entry.visibleSince = 0;
    entry.visible = visible;
  }
}
const intersection = new IntersectionObserver(
  (changes) => {
    updateVisibility(changes);
    pump();
  },
  { rootMargin: '0px', threshold: 0 },
);
function unwatchVisibility(entry: Entry) {
  if (entry.visibilityTarget) {
    intersection.unobserve(entry.visibilityTarget);
    visibilityTargets.delete(entry.visibilityTarget);
  }
  entry.visibilityTarget = undefined;
  entry.visible = false;
  entry.visibleSince = 0;
}
function watchVisibility(entry: Entry) {
  const target = labelAnchor(entry.article) ?? entry.article;
  if (target === entry.visibilityTarget) return;
  unwatchVisibility(entry);
  entry.visibilityTarget = target;
  visibilityTargets.set(target, entry);
  intersection.observe(target);
}
function inView(entry: Entry): boolean {
  const target = entry.visibilityTarget;
  if (document.hidden || !target?.isConnected || !entry.article.isConnected) return false;

  const rect = target.getBoundingClientRect();
  let left = Math.max(0, rect.left),
    top = Math.max(0, rect.top);
  let right = Math.min(document.documentElement.clientWidth, rect.right),
    bottom = Math.min(document.documentElement.clientHeight, rect.bottom);
  for (
    let node: HTMLElement | null = target;
    node && right > left && bottom > top;
    node = node.parentElement
  ) {
    const css = getComputedStyle(node);
    if (css.visibility !== 'visible' || css.display === 'none' || Number(css.opacity) === 0)
      return false;

    if (node === target || node === document.documentElement || css.display === 'contents')
      continue;
    if (node === document.body) {
      const root = getComputedStyle(document.documentElement);
      if (root.overflowX === 'visible' && root.overflowY === 'visible') continue;
    }
    const clipX = /^(auto|scroll|hidden|clip)$/.test(css.overflowX);
    const clipY = /^(auto|scroll|hidden|clip)$/.test(css.overflowY);
    if (!clipX && !clipY) continue;
    const bounds = node.getBoundingClientRect();
    if (clipX) {
      left = Math.max(left, bounds.left + node.clientLeft);
      right = Math.min(right, bounds.left + node.clientLeft + node.clientWidth);
    }
    if (clipY) {
      top = Math.max(top, bounds.top + node.clientTop);
      bottom = Math.min(bottom, bounds.top + node.clientTop + node.clientHeight);
    }
  }
  return right > left && bottom > top;
}
function viewportChanged() {
  if (!alive || viewportFrame) return;
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = 0;
    for (const entry of entries.values()) positionRadar(entry);
    pump();
  });
}

function scan() {
  scanTimer = undefined;
  if (!alive) return;
  const targets = findPosts();
  const current = new Set(targets);
  for (const [article, entry] of entries)
    if (!current.has(article)) {
      alignmentResize.unobserve(article);
      unwatchVisibility(entry);
      releaseRadarAnchor(entry);
      entry.host.remove();
      entry.stamp?.destroy();
      clearConcealed(entry);
      clearDim(article);
      article.removeAttribute('data-jev-target');
      entry.token++;
      entries.delete(article);
    }
  for (const article of targets) {
    const post = extractPost(article);
    const previous = entries.get(article);
    if (!post) {
      alignmentResize.unobserve(article);
      if (previous) {
        previous.token++;
        releaseRadarAnchor(previous);
        previous.host.remove();
        previous.stamp?.destroy();
        clearConcealed(previous);
        clearDim(article);
        article.removeAttribute('data-jev-target');
        unwatchVisibility(previous);
        entries.delete(article);
      }
      continue;
    }
    const fingerprint = `${post.id}:${postContentKey(post, settings)}`;
    if (!previous) {
      const entry = makeEntry(article, post);
      entries.set(article, entry);
      alignmentResize.observe(article);
    } else if (previous.fingerprint !== fingerprint) {
      previous.token++;
      Object.assign(previous, {
        post,
        fingerprint,
        state: 'idle',
        attempts: 0,
        nextTry: 0,
        verdict: undefined,
        error: undefined,
        quota: false,
        revealed: false,
        visibleSince: 0,
      });
      if (!previous.host.isConnected) placeHost(previous);
      paint(previous);
    } else if (!previous.host.isConnected) {
      placeHost(previous);
      paint(previous);
    }
  }
  for (const entry of entries.values()) {
    effects(entry);
    watchVisibility(entry);
    entry.stamp?.refresh();
  }
  pump();
}
function scheduleScan() {
  if (!scanTimer) scanTimer = setTimeout(scan, 120);
}
const mutations = new MutationObserver((records) => {
  if (
    records.some((record) => {
      const element =
        record.target instanceof Element ? record.target : record.target.parentElement;
      if (element?.closest('jev-slop-label, jev-slop-stamp')) return false;
      return (
        record.type === 'characterData' ||
        record.type === 'attributes' ||
        [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            !(
              node instanceof Element && ['JEV-SLOP-LABEL', 'JEV-SLOP-STAMP'].includes(node.tagName)
            ),
        )
      );
    })
  )
    scheduleScan();
});
mutations.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: [
    'href',
    'id',
    'data-testid',
    'data-urn',
    'data-id',
    'componentkey',
    'data-view-name',
    'contenteditable',
  ],
});

function schedulePump(delay: number) {
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = setTimeout(
    () => {
      pumpTimer = undefined;
      pump();
    },
    Math.min(2147483647, Math.max(100, delay)),
  );
}
function pump() {
  if (!alive || !settings.enabled || !settings.configured || document.hidden) return;
  updateVisibility(intersection.takeRecords());
  let nextDelay = Infinity;
  for (const entry of entries.values()) {
    if (entry.verdict || entry.state === 'unrated' || !hasReadableText(entry.post)) continue;
    if (!inView(entry)) {
      entry.visibleSince = 0;
      continue;
    }
    if (!entry.visibleSince) entry.visibleSince = Date.now();
    if (entry.state === 'pending') continue;
    if (entry.state === 'error' && entry.attempts >= 3) continue;
    if (entry.nextTry > Date.now()) {
      nextDelay = Math.min(nextDelay, entry.nextTry - Date.now());
      continue;
    }
    const settleDelay = VISIBLE_DELAY - (Date.now() - entry.visibleSince);
    if (settleDelay > 0) {
      nextDelay = Math.min(nextDelay, settleDelay);
      continue;
    }
    if (running >= 3) continue;
    void run(entry);
  }
  if (Number.isFinite(nextDelay)) schedulePump(nextDelay);
}
async function run(entry: Entry) {
  if (!inView(entry)) return;
  const token = entry.token;
  entry.state = 'pending';
  running++;
  paint(entry);
  try {
    if (!inView(entry)) {
      entry.state = 'idle';
      entry.visibleSince = 0;
      return;
    }
    const result: Classification = await chrome.runtime.sendMessage({
      type: 'classify',
      post: entry.post,
    });
    if (entry.token !== token || !entry.article.isConnected) return;
    if (result.status === 'ok') {
      entry.verdict = result.verdict;
      entry.state = 'done';
    } else if (result.status === 'busy') {
      entry.state = 'idle';
      entry.nextTry = Date.now() + result.retryAfter + Math.random() * 300;
    } else if (result.status === 'error') {
      entry.state = 'error';
      entry.error = result.message;
      entry.quota = result.code === 'quota';
      entry.attempts = entry.quota ? 0 : entry.attempts + 1;
      if (!result.retryAfter) entry.attempts = 3;
      entry.nextTry = Date.now() + (result.retryAfter ?? 60_000);
    } else if (result.status === 'unrated') {
      entry.state = 'unrated';
      entry.error = result.message;
    } else if (result.status === 'setup') {
      settings.configured = false;
      entry.state = 'idle';
    } else if (result.status === 'paused') {
      settings.enabled = false;
      entry.state = 'idle';
    } else if (result.status === 'empty') {
      entry.state = 'done';
      entry.attempts = 3;
    } else throw new Error('Unexpected extension response');
  } catch (error) {
    if (entry.token !== token) return;
    entry.state = 'error';
    entry.attempts++;
    entry.error = 'The extension was reloaded or disconnected. Refresh this tab.';
    entry.nextTry = Date.now() + 30_000;
    if (String(error).includes('Extension context invalidated')) {
      alive = false;
      mutations.disconnect();
      intersection.disconnect();
      alignmentResize.disconnect();
    }
  } finally {
    running--;
    if (entry.token === token) paint(entry);
    pump();
  }
}
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'settingsChanged') return;
  const wasEnabled = settings.enabled && settings.configured;
  const reevaluate =
    detectionChanged(settings, message.settings) ||
    settings.cacheEpoch !== message.settings.cacheEpoch;
  settings = message.settings;
  for (const entry of entries.values()) {
    if (reevaluate) {
      entry.verdict = undefined;
      entry.revealed = false;
      entry.error = undefined;
      entry.quota = false;
    }
    if (
      reevaluate ||
      !settings.enabled ||
      !settings.configured ||
      !wasEnabled ||
      entry.state === 'error'
    ) {
      entry.token++;
      entry.state = 'idle';
      entry.attempts = 0;
      entry.nextTry = 0;
    }
    paint(entry);
  }
  scan();
});
document.addEventListener('visibilitychange', () => {
  for (const entry of entries.values()) entry.visibleSince = 0;
  if (pumpTimer) {
    clearTimeout(pumpTimer);
    pumpTimer = undefined;
  }
  if (!document.hidden) scan();
});
document.addEventListener('scroll', viewportChanged, { capture: true, passive: true });
window.addEventListener('resize', viewportChanged, { passive: true });
window.addEventListener('resize', () => {
  if (alive) for (const entry of entries.values()) alignLabel(entry);
});
window.addEventListener('online', () => {
  for (const e of entries.values())
    if (e.state === 'error') {
      e.attempts = 0;
      e.nextTry = 0;
    }
  pump();
});
void chrome.runtime
  .sendMessage({ type: 'getSettings' })
  .then((value) => {
    settings = value;
    scan();
  })
  .catch(() => {
    alive = false;
    mutations.disconnect();
    intersection.disconnect();
    alignmentResize.disconnect();
  });

void fontReady.then(() => {
  for (const entry of entries.values()) entry.stamp?.refresh();
});
