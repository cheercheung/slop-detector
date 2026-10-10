import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BuildOptions, build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.demo');
await mkdir(output, { recursive: true });
await cp(path.join(root, 'demo'), output, { recursive: true });
await cp(path.join(root, 'public/fonts'), path.join(output, 'fonts'), { recursive: true });
await cp(path.join(root, 'public/icons'), path.join(output, 'icons'), { recursive: true });
await cp(path.join(root, 'public/popup.css'), path.join(output, 'popup.css'));
const popup = await readFile(path.join(root, 'public/popup.html'), 'utf8');
await writeFile(
  path.join(output, 'popup.html'),
  popup.replace(
    '<script src="popup.js" type="module"></script>',
    '<script src="bridge.js"></script><script src="popup.js" defer></script>',
  ),
);

const common: BuildOptions = {
  absWorkingDir: root,
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  format: 'iife',
  logLevel: 'warning',
};
await build({
  ...common,
  entryPoints: ['demo/controller.ts'],
  outfile: path.join(output, 'controller.js'),
});
await build({
  ...common,
  entryPoints: ['src/popup.ts'],
  outfile: path.join(output, 'popup.js'),
  define: { __GPTZERO_PROXY_URL__: '""' },
});
for (const [site, hostname] of [
  ['x', 'x.com'],
  ['linkedin', 'www.linkedin.com'],
]) {
  await build({
    ...common,
    entryPoints: ['src/content.ts'],
    loader: { '.woff2': 'binary' },
    outfile: path.join(output, `${site}-content.js`),
    define: { 'location.hostname': JSON.stringify(hostname) },
  });
}

const files = new Map<string, string>();

async function index(directory: string, prefix = '') {
  const { readdir } = await import('node:fs/promises');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await index(path.join(directory, entry.name), relative);
    else if (!relative.endsWith('.ts') && !relative.endsWith('.md'))
      files.set(relative, path.join(directory, entry.name));
  }
}
await index(output);

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const file = files.get(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!file || !['GET', 'HEAD'].includes(req.method ?? '')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data: blob:; img-src 'self' data:; connect-src 'none'; frame-src 'self'; form-action 'none'; object-src 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch {
    res.writeHead(500);
    res.end('Unable to load demo');
  }
});
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(4173, '127.0.0.1', () =>
  console.log(
    'Staged feed ready: http://127.0.0.1:4173\nFictional content, preset scores, no API calls. Ctrl+C to stop.',
  ),
);
