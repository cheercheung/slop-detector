# Contributing

Use the Node version in `.nvmrc` and install dependencies with `npm ci`. The full test suite also needs `openssl` and `zip`.

Try to keep each pull request focused on one change, with a test if you’re fixing a bug or a screenshot if you’re changing the UI.

Before opening a pull request:

```sh
npx playwright install chromium
npm run check:all
```

## Releasing

1. Update the version in `package.json` and `public/manifest.json`, then run `npm install --package-lock-only`.
2. Run `npm run check:all`.
3. [Configure the proxy](CLOUDFLARE_SETUP.md) if needed, then run `npm run package`.
4. Unzip and test in a clean Chrome profile, including the first-run permission prompt.
5. Upload `slop-detector.zip` to the Chrome Web Store.
