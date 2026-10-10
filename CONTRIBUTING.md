# Contributing

Use the Node version in `.nvmrc`, run `npm ci`, then `npm run check`.

Keep changes focused. Add regression tests for bug fixes, especially provider errors, permissions, quota accounting, post extraction, and asynchronous cancellation. Tests must use fake credentials and mock providers; never rely on the sponsored service.

- `npm run lint:fix` formats code and applies safe Biome fixes.
- `npm run test:watch` runs Vitest during development.
- `npm run check:all` also runs Chromium and the real local Worker runtime. Install Chromium with `npx playwright install chromium` first.

Unit coverage includes runtime modules. Layout and viewport behavior is exercised separately by the Chromium tests; its coverage is not added to the Vitest report. Coverage gates protect the provider, quota, and extraction paths as well as the overall baseline.

The DOM fixtures deliberately reproduce third-party markup, including its accessibility quirks, so HTML accessibility lint rules do not apply to `tests/*.html`. Production code uses Biome’s recommended rules. Non-null assertions are allowed for fixed popup elements and test fixture invariants; CSS specificity ordering is left to each component. New untyped `any` values are disallowed outside test doubles.

Do not commit `wrangler.*`, `proxy.config.json`, `.env*`, `.dev.vars*`, `.wrangler/`, real API keys, or screenshots of real users. Local deployment settings are intentionally absent from Git. Store sponsored keys with `wrangler secret put`.

Pull requests run lint, type checks, tests, package checks, and secret scanning. CI needs no deployment credentials. A passing check never publishes or deploys.

## Release

1. Keep `package.json` and `public/manifest.json` versions in sync; update the lockfile with `npm install --package-lock-only`.
2. Run `npm run check:all` and review the diff.
3. Configure your public proxy URL locally if needed, then run `npm run package`.
4. Test the ZIP as an unpacked extension in a clean Chrome profile, including the initial permission prompt.
5. Upload the ZIP to the Chrome Web Store manually.

Enable required CI checks, private vulnerability reporting, and secret push protection in the GitHub repository settings before accepting outside contributions. Before making an existing private repository public, audit its full history: deleting a file from the current tree does not remove past copies.
