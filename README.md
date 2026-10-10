# Slop Detector

Chrome extension that marks AI slop on X and LinkedIn, including comments and replies.

- Use GPTZero with a free allowance or your own key. Mixed and AI-polished results aren't flagged.
- Use Jev with your own prompt through AI Gateway, OpenRouter or TypeSafe.
- Stamp, fade or collapse flagged posts. Only visible items are checked.

## Development

Use Node 24.18+ (24.x) and npm.

```sh
npm ci
npm run check
```

This runs lint, type checks, tests and a build.

Load `dist/` at `chrome://extensions` with Developer mode enabled. Free GPTZero scanning needs a [Cloudflare proxy](CLOUDFLARE_SETUP.md). Personal keys work without one.

- `npm run test:watch` — run tests while editing.
- `npm run lint:fix` — format code and fix lint errors.
- `npm run package` — build `slop-detector.zip`.
- `npm run demo` — open the [screenshot demo](demo/README.md).

[Installation](INSTALL.md) · [Contributing](CONTRIBUTING.md) · [Privacy](PRIVACY.md)

## License

[MIT](LICENSE). The bundled Geist font uses the [SIL Open Font License](public/fonts/OFL.txt).
