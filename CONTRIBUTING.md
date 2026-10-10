# Contributing

Use the Node version in `.nvmrc`, then run `npm ci`.

Keep pull requests focused. Include a regression test for bug fixes and screenshots for UI changes. Use mock API responses and fictional posts in tests and screenshots. Keep keys and local deployment config out of commits.

Before opening a pull request:

```sh
npx playwright install chromium
npm run check:all
```

This includes lint, types, unit tests, browser tests and local Worker tests. You'll also need `openssl` and `zip`. Tests don't call paid APIs.

## Releasing

1. Update the version in `package.json` and `public/manifest.json`, then run `npm install --package-lock-only`.
2. Run `npm run check:all`.
3. [Configure the proxy](CLOUDFLARE_SETUP.md) if needed, then run `npm run package`.
4. Unzip and test in a clean Chrome profile, including the first-run permission prompt.
5. Upload `slop-detector.zip` to the Chrome Web Store.
