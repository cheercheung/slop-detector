import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    isolate: true,
    restoreMocks: true,
    unstubGlobals: true,
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'proxy/{quota,limits}.ts'],
      exclude: ['src/**/*.d.ts', 'src/font.ts', 'src/stamp.ts', 'src/gptzero-config.ts'],
      reporter: ['text', 'html', 'lcov'],

      thresholds: {
        statements: 50,
        branches: 50,
        functions: 60,
        lines: 50,
        'src/{classifier,gptzero-schema,gptzero-direct,shared}.ts': {
          statements: 90,
          branches: 80,
          functions: 100,
          lines: 90,
        },
        'proxy/quota.ts': { statements: 95, branches: 85, functions: 90, lines: 95 },
        'src/extract.ts': { statements: 85, branches: 75, functions: 85, lines: 85 },
      },
    },
  },
});
