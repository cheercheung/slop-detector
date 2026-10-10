# Contributing

Use the Node version in `.nvmrc`, then run `npm ci`.

Try to keep each pull request focused on one change, with a test if you’re fixing a bug or a screenshot if you’re changing the UI. Please use mock API responses in tests and fictional posts in screenshots, and leave API keys and local deployment settings out of your commits.

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
