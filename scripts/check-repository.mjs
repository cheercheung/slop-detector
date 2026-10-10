import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const privateFile =
  /(^|\/)(wrangler[^/]*\.(jsonc?|toml)|\.env[^/]*|\.dev\.vars[^/]*|proxy\.config\.json|\.DS_Store|store-listing-draft\.jpg)$/;
const privateDirectory =
  /(^|\/)(node_modules|dist|dist-test|coverage|test-results|\.wrangler|\.demo|\.private-backups)\//;
const unexpected = tracked.filter((file) => privateFile.test(file) || privateDirectory.test(file));
assert.deepEqual(
  unexpected,
  [],
  'Local configuration or generated/private files are tracked in Git',
);
console.log('Repository hygiene checked: local config and build artifacts are untracked.');
