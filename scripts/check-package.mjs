import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { RELEASE_FILES } from './release-files.mjs';

export async function checkPackage(directory = 'dist') {
  const actual = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = actual
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
    )
    .sort();
  assert.deepEqual(files, [...RELEASE_FILES].sort(), 'Unexpected or missing release files');
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(manifest.version, pkg.version, 'Manifest and package versions must match');
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'), 'No blanket site access');
  for (const file of files.filter((file) => /\.(js|json|html|css)$/.test(file))) {
    const content = await readFile(path.join(directory, file), 'utf8');
    assert.ok(
      !/server-only-test-secret|test-gateway-key|__providerGrants|__slopDemo/.test(content),
      `Test code in ${file}`,
    );
    assert.ok(
      !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content),
      `Private key in ${file}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href
) {
  await checkPackage(process.argv[2] || 'dist');
  console.log('Release contents, permissions and version checked.');
}
