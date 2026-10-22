# Slop Detector privacy

Updated 22 October 2026 (EvoLink adaptation)

Slop Detector checks visible posts, comments and replies on X and LinkedIn. This adaptation has no bundled hosted backend. Free scanning is available only if you configure a proxy; that operator and the selected model provider have their own policies.

## What gets sent

The extension sends post text, up to 6,000 characters per check, to your chosen detector. Personal information within that text is included. Images, videos, linked pages and drafts aren’t analysed. Cookies, browsing history and profile details aren’t added to requests.

- **Free GPTZero:** text goes through your configured Cloudflare proxy to GPTZero.
- **Your GPTZero key:** text goes directly to GPTZero using your key.
- **EvoLink Luna Decision (local adaptation, 2026-10-21):** visible post text and your custom prompt go directly to EvoLink at `direct.evolink.ai` using your key. The detector returns a probability, not proof of authorship. The extension does not add Chrome profile data to the request.
- **Jev / OpenRouter:** text and your custom prompt go directly to TypeSafe or through OpenRouter, according to your selected provider. AI Gateway is not supported.

Connecting a personal key sends a short sample to check it works. Only the selected provider receives your key. Cloudflare and the AI providers process requests under their own privacy policies.

## What’s stored

**In Chrome:** settings, your prompt, API keys, a random installation ID and usage counts. Keys are saved in local extension storage, aren’t synced, and can be read by someone with access to your Chrome profile. Use a dedicated key with a spending cap where available.

The extension temporarily caches text fingerprints and results, not post text. These expire after 24 hours or when the browser session ends. It also keeps session counts, timings and errors.

**On a configured proxy server, for free GPTZero checks:** Cloudflare receives your IP address. We hash it and your installation ID to track usage limits. We store those usage records and cached results, not raw post text or IP addresses. We don’t log post text or provider responses.

Cached results expire within 24 hours. Usage records expire at the end of their relevant minute, day, week or month. Expired records are removed as the service runs; Cloudflare backups may retain older records. Your selected provider also receives your IP address when you connect to it directly.

## Your controls

You can pause scanning, change detectors, remove saved keys, clear cached results or revoke site permissions. Uninstalling removes local extension data. Server records expire as described above. Requests already sent may still finish, and provider retention follows their policies.

Free scanning never switches to a personal key automatically.
