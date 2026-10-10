import { writeFile } from 'node:fs/promises';
import { normalizeProxyUrl } from './proxy-url.mts';

const url = normalizeProxyUrl(process.argv[2]);
if (!url) throw new Error('Pass your deployed Worker’s HTTPS URL. Never pass an API key.');
await writeFile('proxy.config.json', `${JSON.stringify({ url }, null, 2)}\n`);
console.log(`Saved public proxy URL: ${url}\nRun npm run package, then reload the extension.`);
