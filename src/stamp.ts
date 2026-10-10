import { labelAnchor } from './extract';

const STAMP_CSS = `
:host{all:initial!important;display:block!important;position:absolute!important;inset:0!important;bottom:auto!important;height:var(--stamp-height,100%)!important;z-index:3!important;pointer-events:none!important;overflow:hidden!important;border-radius:inherit!important;container-type:inline-size!important;user-select:none!important}
*,*::before,*::after{box-sizing:border-box;pointer-events:none!important}
.position{position:absolute;left:50%;top:var(--impact-y,130px);width:min(78cqw,420px);transform:translate(-50%,-50%) scale(var(--stamp-fit,1));visibility:hidden}
:host([data-dropped]) .position{visibility:visible}
.impact{transform:rotate(-12deg);transform-origin:50% 60%}
.ink{position:relative;color:#d62828;border:6px solid currentColor;border-radius:9px;padding:9px 16px 5px;text-align:center;background:rgba(255,255,255,.64);box-shadow:inset 0 0 0 3px rgba(255,255,255,.8),inset 0 0 0 5px currentColor;opacity:.76;transition:opacity .2s ease;font:900 clamp(42px,17cqw,108px)/.98 "Slop Geist",sans-serif;letter-spacing:.075em;text-indent:.075em;text-shadow:1px 1px 0 currentColor}
.ink::after{content:"";position:absolute;inset:-6px;border-radius:9px;background:repeating-linear-gradient(172deg,transparent 0 16px,rgba(255,255,255,.65) 16px 17px,transparent 17px 26px);opacity:.5}
:host-context([data-jev-stamped]:hover) .ink,:host-context([data-jev-stamped]:focus-within) .ink{opacity:.16;transition-delay:1s}
.shockwave{position:absolute;inset:-12px;border:3px solid #d62828;border-radius:50%;opacity:0}
.dust{position:absolute;left:50%;top:50%;width:5px;height:12px;border-radius:2px;background:#b91c1c;opacity:0}
:host([data-dropped]) .impact{animation:stamp-slam .82s both}
:host([data-dropped]) .shockwave{animation:stamp-wave .45s .31s both}
:host([data-dropped]) .dust{animation:stamp-dust .52s .31s both}
@keyframes stamp-slam{
  0%{opacity:0;transform:translateY(-180px) rotate(-28deg) scale(2.8);filter:blur(3px)}
  28%{opacity:1;transform:translateY(-55px) rotate(-20deg) scale(1.5);filter:blur(1px)}
  40%{opacity:1;transform:translateY(6px) rotate(-10deg) scale(.92,1.07);filter:blur(0)}
  52%{transform:translateY(-9px) rotate(-15deg) scale(1.04,.98)}
  65%{transform:translateY(3px) rotate(-9deg) scale(.99,1.02)}
  80%{transform:translateY(-1px) rotate(-13deg) scale(1)}
  100%{opacity:1;transform:translateY(0) rotate(-12deg) scale(1);filter:blur(0)}
}
@keyframes stamp-wave{0%{opacity:0;transform:scale(.7,.8)}20%{opacity:.55}100%{opacity:0;transform:scale(1.22,1.55)}}
@keyframes stamp-dust{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}15%{opacity:.9}100%{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) rotate(var(--spin)) scale(.2)}}
@media(prefers-reduced-motion:reduce){.impact,.shockwave,.dust{animation:none!important;will-change:auto}.shockwave,.dust{display:none}.ink{transition:none!important}}
`;

export type SlopStamp = { refresh: () => void; destroy: () => void };

export function createStamp(article: HTMLElement): SlopStamp {
  const positioned = getComputedStyle(article).position === 'static';
  if (positioned) article.setAttribute('data-jev-stamp-position', 'true');
  article.setAttribute('data-jev-stamped', 'true');
  const host = document.createElement('jev-slop-stamp');
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STAMP_CSS;
  const position = document.createElement('div');
  position.className = 'position';
  const impact = document.createElement('div');
  impact.className = 'impact';
  const ink = document.createElement('div');
  ink.className = 'ink';
  ink.textContent = 'SLOP';
  impact.append(ink);
  const wave = document.createElement('div');
  wave.className = 'shockwave';
  position.append(wave, impact);
  for (let i = 0; i < 12; i++) {
    const particle = document.createElement('i');
    particle.className = 'dust';
    const angle = (i * Math.PI) / 6;
    particle.style.setProperty('--dx', `${Math.cos(angle) * 180}px`);
    particle.style.setProperty('--dy', `${Math.sin(angle) * 80}px`);
    particle.style.setProperty('--spin', `${i * 37}deg`);
    position.append(particle);
  }
  shadow.append(style, position);
  article.append(host);

  let frame = 0;
  let destroyed = false;
  const refresh = () => {
    if (destroyed) return;
    if (!host.isConnected) article.append(host);
    const rect = article.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const anchor = labelAnchor(article)?.getBoundingClientRect();

    const children = Array.from(article.querySelectorAll<HTMLElement>('[data-jev-target]'))
      .map((node) => node.getBoundingClientRect())
      .filter((child) => child.width && child.height && child.top > rect.top);
    const height = Math.min(rect.height, ...children.map((child) => child.top - rect.top));
    host.style.setProperty('--stamp-height', `${height}px`);
    const center = anchor
      ? anchor.top - rect.top + Math.min(anchor.height, 260) / 2
      : rect.height / 2;
    const angle = (12 * Math.PI) / 180;
    const rotatedHeight =
      position.offsetHeight * Math.cos(angle) + position.offsetWidth * Math.sin(angle);
    const rotatedWidth =
      position.offsetWidth * Math.cos(angle) + position.offsetHeight * Math.sin(angle);
    const fit = Math.max(
      0.1,
      Math.min(1, (height - 16) / rotatedHeight, (rect.width - 16) / rotatedWidth),
    );
    const half = (rotatedHeight * fit) / 2 + 8;
    const y = `${Math.round(Math.min(Math.max(half, center), height - half))}px`;
    if (host.style.getPropertyValue('--stamp-fit') !== String(fit))
      host.style.setProperty('--stamp-fit', String(fit));
    if (host.style.getPropertyValue('--impact-y') !== y) host.style.setProperty('--impact-y', y);
  };
  const resize = new ResizeObserver(() => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        refresh();
      });
  });
  resize.observe(article);
  refresh();

  const visibility = new IntersectionObserver((changes) => {
    if (!changes.some((change) => change.isIntersecting) || document.hidden) return;
    host.setAttribute('data-dropped', 'true');
    visibility.disconnect();
  });
  visibility.observe(position);
  const onVisible = () => {
    if (document.hidden || host.hasAttribute('data-dropped')) return;
    visibility.unobserve(position);
    visibility.observe(position);
  };
  document.addEventListener('visibilitychange', onVisible);

  return {
    refresh,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      visibility.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      host.remove();
      article.removeAttribute('data-jev-stamped');
      if (positioned) article.removeAttribute('data-jev-stamp-position');
    },
  };
}
