# Slop Detector

Chrome extension that marks AI slop on X and LinkedIn, including comments and replies.

- GPTZero with a free allowance or your own API key. Mixed/AI-polished results are excluded.
- Jev with a custom prompt through AI Gateway, OpenRouter, or TypeSafe.
- Stamp, fade, or collapse flagged posts. Only visible items are checked.

## Development

Use Node **24.18+ (24.x)** and npm. No API keys are needed to build or test.

```sh
npm ci
npm run check
```

| Command | What it does |
| --- | --- |
| `npm run lint` | Biome linting and formatting checks |
| `npm run lint:fix` | Apply safe lint fixes and formatting |
| `npm run format` | Format source files |
| `npm run typecheck` | Strict TypeScript checks for extension, demo, tests, scripts, and Worker |
| `npm test` | Vitest regression tests |
| `npm run test:watch` | Watch tests while editing |
| `npm run test:coverage` | Coverage report in `coverage/` |
| `npm run check` | Lint, types, coverage, build, release-file checks, and repository hygiene |
| `npm run check:all` | Above plus Worker and Chromium integration tests |
| `npm run demo` | Local fictional feed for screenshots |
| `npm run package` | Validate and create `slop-detector.zip` |

For the browser suite, install Chromium first:

```sh
npx playwright install chromium
npm run check:all
```

Tests use mock providers and temporary storage. They do not contact paid APIs or deploy anything. The HTTPS browser fixture also requires `openssl`; packaging requires `zip` (available on macOS and Ubuntu).

Load `dist/` as an unpacked extension at `chrome://extensions`. A build without a proxy URL supports personal keys; free GPTZero scanning requires your own [Cloudflare proxy](CLOUDFLARE_SETUP.md).

## Layout

- `src/` — content script, popup, background service worker, provider clients
- `public/` — popup markup/styles, radar icon, bundled font
- `proxy/` — Cloudflare Worker and atomic quota storage
- `tests/` — unit tests, DOM fixtures, browser and Worker integration tests
- `demo/` — fictional screenshot feed
- `scripts/` — build, packaging, and local setup

Real Wrangler config, proxy URL config, credentials, and build output stay local and ignored. The release ZIP uses an explicit allowlist and contains no Worker config or source.

[Install](INSTALL.md) · [Contribute](CONTRIBUTING.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

## License

[MIT](LICENSE). Geist is distributed under its own [SIL Open Font License](public/fonts/OFL.txt), included in the extension. Dependencies retain their respective licenses.
