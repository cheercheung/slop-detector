import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { checkPackage } from '../scripts/check-package.mjs';
import { RELEASE_FILES } from '../scripts/release-files.mjs';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function packageFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'slop-package-'));
  folders.push(directory);
  for (const file of RELEASE_FILES) {
    const target = path.join(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      file === 'manifest.json' ? await readFile('public/manifest.json') : 'fixture',
    );
  }
  return directory;
}

test('release validation rejects local config and accidental development files', async () => {
  const directory = await packageFixture();
  await expect(checkPackage(directory)).resolves.toBeUndefined();
  await writeFile(path.join(directory, 'proxy.config.json'), '{}');
  await expect(checkPackage(directory)).rejects.toThrow('Unexpected or missing release files');
});

test('release validation rejects version drift and test code in bundles', async () => {
  const directory = await packageFixture();
  const filename = path.join(directory, 'manifest.json');
  const original = await readFile(filename, 'utf8');
  await writeFile(filename, JSON.stringify({ ...JSON.parse(original), version: '0.0.0' }));
  await expect(checkPackage(directory)).rejects.toThrow('versions must match');
  await writeFile(filename, original);
  await writeFile(
    path.join(directory, 'background.js'),
    'globalThis.__providerGrants = new Set();',
  );
  await expect(checkPackage(directory)).rejects.toThrow('Test code in background.js');
});
