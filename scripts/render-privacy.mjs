import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('PRIVACY.md', root), 'utf8');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = text => escape(text)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
// The policy uses headings, paragraphs and unordered lists only. Escape all
// source HTML; no remote renderer, scripts, fonts, tracking or dependencies.
const sections = source.trim().split(/\n\s*\n/).map(block => {
  if (block.startsWith('# ')) return `<h1>${inline(block.slice(2))}</h1>`;
  if (block.startsWith('## ')) return `<h2>${inline(block.slice(3))}</h2>`;
  if (block.startsWith('- ')) return `<ul>${block.split('\n').map(line => `<li>${inline(line.replace(/^- /, ''))}</li>`).join('')}</ul>`;
  return `<p>${inline(block.replaceAll('\n', ' '))}</p>`;
}).join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="How Slop Detector handles post text, API keys, detection results and free scanning allowances.">
<title>Privacy · Slop Detector</title><style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:light-dark(#fff,#171717);color:light-dark(#202020,#ededed);font-synthesis:none}*{box-sizing:border-box}body{max-width:800px;margin:0 auto;padding:64px 28px 80px;font-size:16px;line-height:1.7}header{font-size:13px;font-weight:600;color:light-dark(#777,#aaa);margin-bottom:26px}h1{font-size:36px;line-height:1.15;letter-spacing:-1.1px;margin:0 0 14px;font-weight:650}h1+p{font-size:13px;color:light-dark(#777,#aaa);margin:0 0 32px}h2{font-size:21px;line-height:1.35;letter-spacing:-.35px;margin:36px 0 12px;font-weight:650}p{margin:0 0 18px}li{padding-left:4px;margin:0 0 12px}ul{padding-left:23px}code{font-family:ui-monospace,monospace;font-size:.88em;overflow-wrap:anywhere}footer{font-size:12px;color:light-dark(#777,#aaa);border-top:1px solid light-dark(#ddd,#444);margin-top:40px;padding-top:18px}@media(max-width:540px){body{padding:32px 20px 50px;font-size:15px}h1{font-size:29px}}
</style></head><body><header>SLOP DETECTOR</header><main>${sections}</main><footer>Slop Detector · X &amp; LinkedIn</footer></body></html>\n`;
const directory = new URL('proxy/static/privacy/', root);
await mkdir(directory, { recursive: true });
await writeFile(new URL('index.html', directory), html);
console.log(`Privacy page ready: ${fileURLToPath(new URL('index.html', directory))}`);
