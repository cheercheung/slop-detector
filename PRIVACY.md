# Slop Detector privacy

Updated 5 October 2026 · Extension version 2.1.2

Slop Detector evaluates readable posts, comments and replies on X and LinkedIn using the detector you choose. Existing installs keep Jev selected. New installs start in GPTZero setup mode; scanning through the proxy requires you to enable it and grant its site permission.

## Free GPTZero mode

The extension sends up to 6,000 characters of the visible item's text to the publisher's Cloudflare proxy. The proxy forwards only that text to GPTZero's text-detection API using the sponsored API key stored in Cloudflare Secrets. Your Jev prompt and personal keys are not sent through this route.

An anonymous random installation ID accompanies proxy requests. Cloudflare also receives your IP address as part of the connection. The application hashes the installation ID, IP address and text with a server-held HMAC secret before using them in its quota database. It stores counters, temporary request locks, cooldowns and sanitized scores; it does not store raw text, raw IP addresses or the GPTZero key in that database. Scores for identical text can be reused across installations for 24 hours. Unsupported-input results expire after an hour. Counters expire at the end of their relevant minute, day, week or month. Expired records are ignored immediately and cleaned up in bounded batches as traffic arrives; underlying platform backups may retain older records.

The application does not log request bodies or provider responses, and Worker observability is disabled in the supplied configuration. Cloudflare and GPTZero process requests under their own applicable terms and privacy policies; this integration does not promise zero retention by those providers. The proxy returns only probabilities, classifications, timing, allowance information and sanitized messages. It does not return the shared API key or raw GPTZero response.

The proxy stores counters so clear-cache, normal service restarts, pausing and detector switches cannot reset an allowance. Installation IDs are not authenticated user accounts. Shared IP and global service limits can apply before the displayed weekly allowance is used up.

## Personal GPTZero key

Selecting **Your API key** uses your personal GPTZero account directly. The background service worker sends only the item text (up to 6,000 characters) as `document` to `https://api.gptzero.me/v2/predict/text`, with your key in the `x-api-key` header. No prompt, installation ID, cookies or sponsored proxy is used. GPTZero receives your IP address as part of the direct connection. Clicking Connect makes one short sample evaluation to validate the key before saving it; your account's credits or charges apply. Provider data handling follows GPTZero's policies.

The free route never switches automatically to a personal key. The selected route persists until you change it. A failed replacement preserves the previous key, and a cancelled or timed-out check cannot save its candidate.

## Jev mode

The selected route is Vercel AI Gateway → TypeSafe Jev, OpenRouter → TypeSafe Jev, or TypeSafe's direct API. That provider receives the extracted text and your saved prompt. The extension authenticates with the personal key you entered for that provider. Other saved providers do not receive requests. Clicking Connect sends a short sample sentence and your prompt to verify that key; provider charges may apply.

Vercel requests include its zero-data-retention option. OpenRouter and TypeSafe requests are subject to their applicable provider data policies. Jev requests go directly from the extension, not through the GPTZero proxy.

## When and what is sent

Checks begin after the item's own text stays visible for a quarter-second. Offscreen items, queued offscreen retries and background tabs wait. A dispatched request may still complete after you scroll away, pause, or switch detectors. Images, videos and linked pages are not evaluated. Draft editors are ignored.

No additional author metadata, profile, post ID, page URL, media file, cookie or browsing history is included in either evaluation payload. Information written inside the item itself remains part of its text. Each comment/reply is evaluated separately. The extension does not open threads or linked pages on your behalf.

## Stored in this Chrome profile

- Personal GPTZero and Jev provider keys and preferences, including your custom prompt, are saved in trusted local extension storage, without application-level encryption or Chrome Sync. We recommend a dedicated personal API key and a spending cap where supported.
- The anonymous installation ID, public proxy URL associated with activation and last-known weekly usage are stored locally. They survive Chrome restarts.
- A session cache holds at most 800 hashes and sanitized scores, with a 24-hour expiry. Text is not persisted. GPTZero hashes cover the detector version and text; Jev hashes also cover the provider, model and prompt.
- Session counters record evaluation count, cache hits, latency and sanitized errors.

Social-site content scripts cannot read stored keys or the installation ID, change privileged settings, or access the server secret. Someone with access to your Chrome profile or extension developer tools can inspect local extension storage.

## Your controls

Pause scanning, switch detectors, edit the Jev prompt, remove individual personal keys, or clear local cached scores. Removing a personal GPTZero or Jev key releases its host permission. Revoking the proxy/provider permission stops new requests while retaining saved settings. Uninstalling removes the extension's local storage, but does not immediately remove previously created server counters or cache entries; those expire as described above. Requests already received by a provider cannot be retracted.

Required permissions cover storage and supported social sites. The three Jev provider hosts, the direct GPTZero API host, and, in configured builds, the single proxy host are optional. Each is requested in a user action when enabling or connecting its provider. The extension never falls back to spending personal GPTZero or Jev credits without you selecting that route. All extension code and styling are bundled locally. There is no application analytics or advertising telemetry, and the application does not sell data.
