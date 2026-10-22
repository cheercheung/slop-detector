# Adaptation notes

Upstream: [rbilgil/slop-detector](https://github.com/rbilgil/slop-detector) by Robin Bilgil, MIT. Base commit: `365e11972afea2907d2edac3d2509e857dfe3fff` (v2.1.3). The original license and font license are retained.

## Changes

- EvoLink Luna Decision is the default decision provider. OpenRouter and direct Jev remain available; AI Gateway has been removed from the UI, transport, optional host permissions and direct dependencies. The AI SDK itself still has an internal Gateway dependency.
- The EvoLink adapter sends named predicate questions to `https://direct.evolink.ai/v1/decisions`, with model `gpt-6-luna-decisions`. It maps native probabilities into the AI SDK evaluation interface. Invalid/missing/duplicate answers fail rather than becoming scores. No provider fallback or automatic SDK retries are added.
- Slop is an inclusive probability threshold: `probability >= threshold`. The default is 70%, adjustable from 0% to 100% in 1% steps. Threshold and language changes reuse cached scores.
- English and Simplified Chinese controls, feed labels and status messages are available; custom prompt text stays unchanged.
- Both EvoLink links include `utm_source=github&utm_medium=extension&utm_campaign=slop`. A separate footer link credits the upstream repository in both languages.
- GPTZero, viewport filtering, queueing, caching and stamp/fade/hide controls are retained.

## Verification boundaries

Unit and browser checks use synthetic text and mocked model responses. They do not measure live detection quality, probability calibration, latency or billing. Browser tests use separate profiles and managed Chromium, with deadlines and cleanup. No personal key is needed for these tests.

For live use, enter a key in the popup. The connection check sends one synthetic request; actual scans send visible post text to the selected provider. See the README and privacy policy for details.
