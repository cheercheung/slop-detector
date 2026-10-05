import { execFileSync } from 'node:child_process';
import { rm, copyFile } from 'node:fs/promises';
await copyFile('INSTALL.md', 'dist/INSTALL.md');
await copyFile('PRIVACY.md', 'dist/PRIVACY.md');
await copyFile('CLOUDFLARE_SETUP.md', 'dist/CLOUDFLARE_SETUP.md');
await rm('slop-detector.zip', { force: true });
execFileSync('zip', ['-qr', '../slop-detector.zip', '.'], { cwd: 'dist' });
console.log('Packaged → slop-detector.zip');
