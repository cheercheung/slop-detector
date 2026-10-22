# Validation

Verified on 2026-10-22 with Node 24.18.0.

- `npm run check`: 54 mocked tests, lint, TypeScript checks, extension build, package validation and repository hygiene passed.
- `npm run test:browser`: extraction, provider routing, permission handling, cached results, viewport-only scanning and loading-layout regressions passed. Fixtures use synthetic feed pages and mocked provider responses.
- `npm run test:customization`: the three-provider list, EvoLink default, both UTM links, upstream footer credit, English/Chinese switching, threshold persistence/reset and the inclusive 70% boundary passed. Threshold/language changes reused cached verdicts without another model request.
- `npm run test:proxy` and `npm run test:gptzero`: local proxy, quota, cache, permission and GPTZero mock integration checks passed.
- `npm audit --audit-level=high`: no vulnerabilities reported.
- Gitleaks 8.24.3 full-history scan: no leaks found. CI downloads the pinned official Linux binary, verifies its SHA256 and scans all Git history.
- `npm run package`: extension ZIP built and validated.

Browser tests use Playwright-managed Chromium, isolated temporary profiles, finite deadlines and cleanup. They do not access a daily Chrome profile. These checks do not measure live model accuracy, probability calibration, latency or billing; no personal key or live model request was used.

The current GitHub result is available under this repository's [Actions](https://github.com/cheercheung/slop-detector/actions/workflows/ci.yml) tab.
