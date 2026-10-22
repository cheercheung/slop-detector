# Local EvoLink Luna Decision adaptation

Upstream: https://github.com/rbilgil/slop-detector, MIT, exact source 365e11972afea2907d2edac3d2509e857dfe3fff (v2.1.3). The source post and origin are in `EVOLINK_SOURCE.json`. The Geist font's SIL OFL remains bundled. Local development branch: `local/evolink-luna-decision`. No upstream PR or release has been published.

A new **EvoLink Luna Decision** provider is available under **Decision model** in the settings source. GPTZero, Gateway, OpenRouter and direct Jev are retained. `src/luna.ts` implements an AI SDK evaluation model adapter: SDK boolean questions become named `predicate` questions on `POST https://direct.evolink.ai/v1/decisions`, model `gpt-6-luna-decisions`; returned `probability` is used directly. No text-generation model or invented probability is substituted. Refusals and malformed/missing/duplicate answers fail safely. No automatic retries or provider fallback are added.

Existing post extraction, custom prompt, threshold, queue, cache and stamp/fade/hide behavior remain. Cache identities include the EvoLink provider and actual model ID. Only source optional-host permissions/CSP add `direct.evolink.ai`; actual Chrome permissions were never accessed or changed.

## Offline verification · initial adaptation (2026-10-21)

The upstream engine requires Node >=24.18 <25. A task-local official Node 24.18.0 binary was downloaded and SHA256 checked against nodejs.org's version manifest. It did not replace the system Node. Dependencies were read first and installed with `npm ci --ignore-scripts` from the existing lockfile. No installation lifecycle script, browser install, Cloudflare login/deploy or proxy setup ran.

```sh
npm run check
```

This runs lint, type checks, mock tests with coverage, a local extension build, package checks and repository hygiene. Tests mock HTTP and Chrome APIs, and use synthetic post text. `dist/` is a local build artifact only. No extension was installed or loaded into Chrome. Browser/viewport/live GPTZero/proxy tests were not run. No timeline data was collected or sent.

## Credentials and live testing

No key is needed for the offline tests. Do not put a key in source or an env file for this extension; its existing flow accepts personal keys only in the settings UI. Live use is configured in the extension popup, not an env file. Select Decision model, then EvoLink Luna Decision, and enter an EvoLink key in the local extension settings. The existing Connect flow sends a synthetic sample and can incur a charge; do not start it until live calls are authorized. Never paste the key into chat, logs or commits.

The upstream extension stores keys in local extension storage, not synced storage, and restricts content-script access. It is not an encrypted credential vault; use a dedicated key and remove it via Disconnect after testing. A future actual scan sends visible text and the custom prompt to EvoLink. This task did not read any existing Chrome profile or stored credential.

Official contract checked 2026-10-21: https://evolink.ai/docs/en/api-manual/language-series/gpt/decisions/decisions-reference.json. Detection quality, fairness of threshold 0.7, probability calibration, latency and billing for Luna have not been measured. Human review is still needed; the probability is a model judgment, not proof a post was AI-generated.

## Customization update · 2026-10-22

- Fresh installs default to EvoLink Luna Decision. Existing saved detector/provider settings and legacy Gateway keys keep their selected provider.
- Both EvoLink links in the popup open `https://evolink.ai/dashboard/keys?utm_source=github&utm_medium=extension&utm_campaign=slop`.
- Slop means probability **≥ threshold**, with **70%** as the default. Slider and numeric input accept **0–100% in 1% increments**, save on commit and provide a reset button. Changing the threshold repaints cached verdicts without another model call.
- Language can follow Chrome or be set to English / 简体中文. The preference is saved and applies to popup controls, status/error messages, feed labels and reveal controls. The custom prompt remains source text; the decorative stamp retains the SLOP mark.
- Rebuilt `dist/` is ready to load or reload. See [INSTALL.md](INSTALL.md) for the Chinese steps.

Verification: **53 unit/mock tests**, lint, all TypeScript checks, build and release-content checks passed. A separate Playwright-managed Chrome for Testing profile verified the real popup, UTM URLs, language changes, threshold persistence/reset and content-script rendering at the inclusive 70% boundary. Threshold/language changes reused scores with zero model requests. The test used synthetic feed data, a mock runtime and no personal key; it never read or changed a daily Chrome profile. The test browser closed, its temporary profile was removed and the process check found no leftovers.

Screenshots: `test-results/customization-zh.png` / `test-results/customization-en.png`. Logs: `../../evidence/slop-detector-check-2026-10-22.log` / `../../evidence/slop-detector-customization-browser-2026-10-22.log`. This remains an unpublished local adaptation; live model quality and billing have not been tested.
