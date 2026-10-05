import { cleanText, MAX_TEXT, type Post } from './shared';

export const X_POST = 'article[data-testid="tweet"]';
// SDUI uses opaque CSS classes, but stable component keys and text test IDs.
export const LINKEDIN_POST = '[role="listitem"][componentkey^="update-card-focus"], [data-view-name="feed-full-update"], .feed-shared-update-v2, [data-urn^="urn:li:activity:"], [data-id^="urn:li:activity:"]';
export const LINKEDIN_COMMENT = '.comments-comment-item, [id^="replaceableComment_urn:li:comment:"], [componentkey^="replaceableComment_urn:li:comment:"]';
export const LINKEDIN_TEXT = '[data-testid="expandable-text-box"], .update-components-text, .feed-shared-update-v2__description, .feed-shared-text';
const COMMENT_TEXT = `${LINKEDIN_TEXT}, .comments-comment-item__main-content, .comments-comment-item-content-body`;
const COMMENT_CONTAINER = `${LINKEDIN_COMMENT}, .comments-comments-list, [componentkey*="replaceableCommentTools"], [id*="replaceableCommentTools"]`;
const EDITOR = '[contenteditable]:not([contenteditable="false"]), [role="textbox"], textarea, input';
const QUOTE = '[role="link"][tabindex="0"]';
const MEDIA = '[data-testid="tweetPhoto"], video, [data-testid="videoPlayer"], .update-components-image, .feed-shared-image, [data-view-name*="image"], [data-view-name*="video"]';
const fallbackIds = new WeakMap<HTMLElement, string>();
let nextId = 0;

function commentIdentity(node: HTMLElement): string {
  return [node.id, node.getAttribute('componentkey'), node.getAttribute('data-id'), node.getAttribute('data-urn')]
    .find(value => value?.includes('urn:li:comment:')) || '';
}
export function postSelector(hostname = location.hostname): string {
  return hostname === 'linkedin.com' || hostname === 'www.linkedin.com' ? LINKEDIN_POST : X_POST;
}
export function findPosts(): HTMLElement[] {
  const selector = postSelector();
  const posts = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(node => {
    if (node.closest(EDITOR)) return false;
    if (selector === X_POST) return !node.parentElement?.closest(QUOTE);
    return !node.parentElement?.closest(`${selector}, ${COMMENT_CONTAINER}`);
  });
  if (selector === X_POST) return posts;
  const comments = Array.from(document.querySelectorAll<HTMLElement>(LINKEDIN_COMMENT)).filter(node => {
    if (node.closest(EDITOR)) return false;
    const identity = commentIdentity(node);
    // SDUI sometimes nests two wrappers with the same comment URN. Use the inner one.
    return !identity || !Array.from(node.querySelectorAll<HTMLElement>(LINKEDIN_COMMENT)).some(child => commentIdentity(child) === identity);
  });
  return [...posts, ...comments];
}
export function ownsNode(article: HTMLElement, node: Element): boolean {
  if (article.matches(X_POST)) return node.closest(X_POST) === article;
  if (article.matches(LINKEDIN_COMMENT)) return node.closest(LINKEDIN_COMMENT) === article;
  return !node.closest(COMMENT_CONTAINER) && node.closest(LINKEDIN_POST) === article;
}
function readableText(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`button, [role="button"], [hidden], [aria-hidden="true"], ${EDITOR}, ${LINKEDIN_COMMENT}, jev-slop-label, jev-slop-stamp`).forEach(n => n.remove());
  clone.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
  return clone.textContent || '';
}
function textNodes(article: HTMLElement): HTMLElement[] {
  if (article.matches(X_POST)) {
    const nodes = Array.from(article.querySelectorAll<HTMLElement>('[data-testid="tweetText"]')).filter(n => !n.closest(EDITOR));
    const own = nodes.filter(n => ownsNode(article, n) && !n.closest(QUOTE));
    return own.length ? own : nodes.filter(n => n.closest(QUOTE)?.closest(X_POST) === article).slice(0, 1);
  }
  const comment = article.matches(LINKEDIN_COMMENT);
  const nodes = Array.from(article.querySelectorAll<HTMLElement>(comment ? COMMENT_TEXT : LINKEDIN_TEXT)).filter(n =>
    !n.closest(EDITOR) && (comment ? ownsNode(article, n) : !n.closest(COMMENT_CONTAINER))
  );
  const own = nodes.filter(n => ownsNode(article, n));
  const selected = own.length ? own : nodes;
  return selected.filter(n => !selected.some(parent => parent !== n && parent.contains(n))).slice(0, 1);
}
export function dimContent(article: HTMLElement): HTMLElement[] {
  const nodes = [...textNodes(article), ...Array.from(article.querySelectorAll<HTMLElement>(MEDIA)).filter(n => ownsNode(article, n))];
  return nodes.filter(n => !nodes.some(parent => parent !== n && parent.contains(n)));
}
export function labelAnchor(article: HTMLElement): HTMLElement | null {
  const text = textNodes(article)[0];
  // SDUI text is inside a paragraph: place the block badge after the paragraph.
  return text?.parentElement?.tagName === 'P' ? text.parentElement : text ?? null;
}
export function labelAlignmentAnchor(article: HTMLElement): HTMLElement | null {
  let text: HTMLElement | null = textNodes(article)[0] ?? null;
  // Classic cards can put their inset on a text wrapper nested inside the description.
  while (text) {
    const nested: HTMLElement | null = text.querySelector<HTMLElement>(COMMENT_TEXT);
    if (!nested) break;
    text = nested;
  }
  // Inline spans only cover their words; use the containing text column's full width.
  while (text && text !== article && getComputedStyle(text).display === 'inline') text = text.parentElement;
  return text;
}
export function extractPost(article: HTMLElement): Post | null {
  const nodes = textNodes(article);
  const rawText = nodes.map(readableText).join('\n');
  let id: string;
  if (article.matches(X_POST)) {
    const times = Array.from(article.querySelectorAll<HTMLTimeElement>('time')).filter(n => ownsNode(article, n) && !n.closest(QUOTE));
    const status = times.map(time => time.closest<HTMLAnchorElement>('a[href*="/status/"]')?.getAttribute('href')?.match(/\/status\/(\d+)/)?.[1]).find(Boolean);
    if (!status) return null;
    id = status;
  } else {
    const comment = article.matches(LINKEDIN_COMMENT);
    const identity = commentIdentity(article);
    const urn = article.getAttribute('data-urn') || article.getAttribute('data-id') || '';
    const permalink = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="urn:li:activity:"], a[href*="urn%3Ali%3Aactivity%3A"], a[href*="-activity-"]')).find(n => ownsNode(article, n))?.getAttribute('href') || '';
    const activity = `${urn} ${permalink}`.match(/(?:urn(?::|%3A)li(?::|%3A)activity(?::|%3A)|-activity-)(\d+)/i)?.[1];
    const component = article.getAttribute('componentkey');
    if (!fallbackIds.has(article)) fallbackIds.set(article, `li:local:${++nextId}`);
    const stable = comment ? identity : activity ? `activity:${activity}` : component;
    id = stable ? `li:${stable}`.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 240) : fallbackIds.get(article)!;
  }
  return {
    id,
    text: cleanText(rawText, MAX_TEXT),
    hasMedia: Array.from(article.querySelectorAll(MEDIA)).some(n => ownsNode(article, n)),
    truncated: rawText.length > MAX_TEXT || nodes.some(n => n.querySelector('button:not([aria-hidden="true"]), [data-testid="expandable-text-button"]:not([aria-hidden="true"])')) || Array.from(article.querySelectorAll('[data-testid="tweet-text-show-more-link"]')).some(n => ownsNode(article, n)),
  };
}
