import { JSDOM } from 'jsdom';
import { afterEach, expect, test, vi } from 'vitest';
import { dimContent, extractPost, findPosts, labelAnchor } from '../src/extract';
import { MAX_TEXT } from '../src/shared';

const windows: JSDOM[] = [];
function feed(html: string, url = 'https://x.com/home') {
  const dom = new JSDOM(html, { url });
  windows.push(dom);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('location', dom.window.location);
  return dom.window.document;
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const dom of windows.splice(0)) dom.window.close();
});
const tweet = (id: string, text: string) =>
  `<article data-testid="tweet"><a href="/example/status/${id}"><time>Now</time></a><div data-testid="tweetText">${text}</div></article>`;

test('extracts only a post’s own text, excludes quote context, and requires a permalink', () => {
  feed(
    tweet('123', 'Original<br>words<button>Show more</button><span hidden>Private</span>').replace(
      '</article>',
      `<div role="link" tabindex="0">${tweet('456', 'Quoted words')}</div></article>`,
    ) +
      '<article data-testid="tweet"><div data-testid="tweetText">No identity</div></article>' +
      '<div>Navigation and suggested profiles</div>',
  );
  const posts = findPosts();
  expect(posts).toHaveLength(2);
  expect(extractPost(posts[0]!)).toMatchObject({
    id: '123',
    text: 'Original words',
    truncated: true,
  });
  expect(extractPost(posts[1]!)).toBeNull();
});

test('LinkedIn separates comments and replies from posts and ignores editable drafts', () => {
  feed(
    `<div class="feed-shared-update-v2" data-urn="urn:li:activity:123">
    <p><span class="update-components-text">Parent post</span></p>
    <div class="comments-comment-item" id="replaceableComment_urn:li:comment:1">
      <div class="comments-comment-item__main-content">First comment</div>
      <div class="comments-comment-item" id="replaceableComment_urn:li:comment:2"><div class="comments-comment-item__main-content">Reply</div></div>
    </div>
    <div contenteditable="true"><div class="comments-comment-item"><div class="comments-comment-item__main-content">Draft</div></div></div>
  </div>`,
    'https://www.linkedin.com/feed/',
  );
  const posts = findPosts();
  expect(posts.map((post) => extractPost(post)?.text)).toEqual([
    'Parent post',
    'First comment',
    'Reply',
  ]);
  expect(labelAnchor(posts[0]!)?.tagName).toBe('P');
});

test('LinkedIn deduplicates SDUI comment wrappers with the same identity', () => {
  feed(
    `<div componentkey="replaceableComment_urn:li:comment:123"><div componentkey="replaceableComment_urn:li:comment:123"><div data-testid="expandable-text-box">Only once</div></div></div>`,
    'https://www.linkedin.com/feed/',
  );
  expect(findPosts()).toHaveLength(1);
  expect(extractPost(findPosts()[0]!)?.text).toBe('Only once');
});

test('text expansion changes extracted content; resizing does not change identity', () => {
  const doc = feed(tweet('123', 'Short<button>More</button>'));
  const post = findPosts()[0]!;
  expect(extractPost(post)?.truncated).toBe(true);
  doc.querySelector('[data-testid="tweetText"]')!.textContent = 'The expanded full text';
  const expanded = extractPost(post);
  expect(expanded).toMatchObject({ id: '123', text: 'The expanded full text', truncated: false });
  post.style.width = '300px';
  expect(extractPost(post)).toEqual(expanded);
});

test('caps outgoing text and never fades a nested reply’s content with its parent', () => {
  feed(
    `<div class="feed-shared-update-v2" data-urn="urn:li:activity:1"><div class="update-components-text">${'a'.repeat(MAX_TEXT + 10)}</div><div class="comments-comment-item"><div class="comments-comment-item__main-content">Reply</div><video></video></div></div>`,
    'https://www.linkedin.com/feed/',
  );
  const post = findPosts()[0]!;
  expect(extractPost(post)).toMatchObject({
    text: 'a'.repeat(MAX_TEXT),
    truncated: true,
    hasMedia: false,
  });
  expect(dimContent(post)).toHaveLength(1);
});

test('ignores post-shaped markup inside a composer', () => {
  feed(`<div role="textbox">${tweet('123', 'Unpublished')}</div>${tweet('456', 'Published')}`);
  expect(findPosts().map((post) => extractPost(post)?.id)).toEqual(['456']);
});
