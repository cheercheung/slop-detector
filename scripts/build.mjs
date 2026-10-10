import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { build } from 'esbuild';
import { normalizeProxyUrl } from './proxy-url.mjs';

/** @type {{url?: unknown}} */
let saved = {};
try {
  saved = JSON.parse(await readFile('proxy.config.json', 'utf8'));
} catch (e) {
  if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e;
}
const proxyUrl = normalizeProxyUrl(process.env.GPTZERO_PROXY_URL ?? saved.url ?? '');
const outdir = process.env.BUILD_DIR || 'dist';
if (!['dist', 'dist-test'].includes(outdir)) throw new Error('BUILD_DIR must be dist or dist-test');
await rm(outdir, { recursive: true, force: true });
await mkdir(`${outdir}/icons`, { recursive: true });
await cp('public', outdir, { recursive: true });
await cp('LICENSE', `${outdir}/LICENSE`);
await cp('PRIVACY.md', `${outdir}/PRIVACY.md`);
const manifest = JSON.parse(await readFile(`${outdir}/manifest.json`, 'utf8'));
if (proxyUrl) {
  manifest.optional_host_permissions.push(`${proxyUrl}/*`);
  manifest.content_security_policy.extension_pages += ` ${proxyUrl}`;
}
await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await build({
  entryPoints: ['src/background.ts', 'src/popup.ts'],
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  legalComments: 'eof',
  define: {
    'process.env.NODE_ENV': '"production"',
    __GPTZERO_PROXY_URL__: JSON.stringify(proxyUrl),
  },
});
await build({
  entryPoints: ['src/content.ts'],
  loader: { '.woff2': 'binary' },
  outdir,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
});

// Render each Chrome size directly from the editable SVG for smooth, crisp edges.
const icon = await readFile('public/icons/radar.svg');
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(icon, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  }).render();
  await writeFile(`${outdir}/icons/${size}.png`, png.asPng());
}
console.log(
  `Built extension → ${outdir}/ · GPTZero ${proxyUrl ? proxyUrl : 'not configured (Jev available)'}`,
);
