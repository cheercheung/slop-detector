export function normalizeProxyUrl(value) {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use only your proxy’s HTTPS origin, for example https://slop-detector-proxy.your-name.workers.dev');
  return url.origin;
}
