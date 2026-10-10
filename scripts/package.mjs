import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { checkPackage } from './check-package.mjs';
import { RELEASE_FILES } from './release-files.mjs';

await checkPackage();
await rm('slop-detector.zip', { force: true });
execFileSync('zip', ['-qX', '../slop-detector.zip', ...RELEASE_FILES], { cwd: 'dist' });
console.log('Packaged → slop-detector.zip');
