import { expect, test } from 'vitest';
import { normalizeProxyUrl } from '../scripts/proxy-url.mts';

test('build accepts only a public HTTPS origin without credentials or paths', () => {
  expect(normalizeProxyUrl('https://proxy.example.test/')).toBe('https://proxy.example.test');
  expect(normalizeProxyUrl(undefined)).toBe('');
  for (const value of [
    'http://proxy.example.test',
    'https://user:secret@proxy.example.test',
    'https://proxy.example.test/v1/check',
    'https://proxy.example.test/?key=secret',
    'https://proxy.example.test/#secret',
    'not-a-url',
    42,
  ]) {
    expect(() => normalizeProxyUrl(value)).toThrow();
  }
});
