# Set up the GPTZero proxy

This is a small Cloudflare Worker with a SQLite Durable Object for quotas and a score cache. It does not need Vercel, Upstash, a separate database account, or a paid Cloudflare plan. Version 2.1.0 of the extension uses the public proxy URL; the GPTZero API key stays in Cloudflare Secrets.

The current deployment is live at `https://slop-detector-proxy.whirl-intelligence.workers.dev`. Sponsored scanning is enabled for the local Chrome extension `jhlbmippncgmiflimjllpbekdpnofcke`. On 5 October 2026, its CORS preflight, quota lookup, and one live GPTZero classification were verified successfully. The steps below cover setup on another account or extension installation.

## 1. Log in and create the Worker

Create a [Cloudflare account](https://dash.cloudflare.com/sign-up) and keep **Workers on the Free plan**. If your existing account already has Workers Paid, use a separate Free account for this deployment if you want the free-tier cut-off. A domain is not required; the included `workers.dev` address works.

Open Terminal:

```sh
cd '/Users/robin/Documents/ChatGPT/Slop detector'
npm ci
npm run proxy:login
npm run proxy:deploy
```

Use Node.js 24 or newer. `proxy:login` opens Cloudflare's login/authorization screen. The first deploy may ask you to choose an account and a `workers.dev` subdomain. The SQLite namespace is created automatically by the migration in `proxy/wrangler.jsonc`.

Copy the URL printed by deployment, for example:

```text
https://slop-detector-proxy.your-subdomain.workers.dev
```

The Worker is deliberately disabled at this stage. Its `/health` URL confirms deployment, but does not verify credentials or indicate that scanning is enabled.

## 2. Add the two secrets

Paste your sponsored GPTZero key at the hidden prompt:

```sh
npx wrangler secret put GPTZERO_API_KEY --config proxy/wrangler.jsonc
```

Generate and store a separate random secret for hashing installation IDs, IP addresses and text:

```sh
openssl rand -hex 32 | npx wrangler secret put HASH_SECRET --config proxy/wrangler.jsonc
```

The generated value is piped directly to Cloudflare. Neither secret belongs in extension code, a build environment variable, `proxy.config.json`, Git, or the ZIP. Keep `HASH_SECRET` stable across deployments so anonymous user quotas and cached scores retain their identity.

## 3. Point the extension at your Worker

Replace the example URL with yours (just the HTTPS origin, with no `/v1/check` path):

```sh
npm run configure:proxy -- https://slop-detector-proxy.your-subdomain.workers.dev
npm run package
```

This saves the **public URL only** in local `proxy.config.json`. Future builds reuse it. The build adds permission for that exact host, not every Cloudflare site.

In Chrome, open **chrome://extensions**:

1. Enable **Developer mode**.
2. If Slop Detector is already loaded from this project's `dist` folder, click **Reload**. Otherwise choose **Load unpacked** and select `/Users/robin/Documents/ChatGPT/Slop detector/dist`.
3. Copy its 32-letter extension **ID**.

## 4. Allow that extension and enable the sponsored service

Open `proxy/wrangler.jsonc`. Set these values under `vars`:

```json
"ALLOWED_EXTENSION_IDS": "paste-the-32-letter-extension-id-here",
"SPONSORED_ENABLED": "true"
```

Before enabling, confirm the free-credit amount, renewal/expiry, and **no paid overages or automatic top-ups** with GPTZero. The limits below are protective starting values, not confirmed sponsorship terms. Set them to fit the agreement:

| Setting | Initial value | Meaning |
| --- | ---: | --- |
| `INSTALL_WEEKLY_LIMIT` | 1,000 | New uncached checks per anonymous installation; Monday 00:00 UTC reset |
| `INSTALL_MINUTE_LIMIT` | 20 | New uncached checks per installation per UTC minute |
| `IP_DAILY_LIMIT` | 2,000 | New uncached checks per IP per UTC day, across installation IDs |
| `GLOBAL_DAILY_LIMIT` | 5,000 | New uncached checks across the entire extension per UTC day |
| `GLOBAL_MONTHLY_LIMIT` | 100,000 | New uncached checks across the entire extension per calendar month UTC |
| `GLOBAL_MONTHLY_CHARACTER_LIMIT` | 5,000,000 | Total submitted text characters across the extension per calendar month UTC |

Whichever limit is reached first stops new API calls. Character count is an additional safety bound, **not GPTZero's billing meter**. Limits do not guarantee a particular API bill; the provider-side non-billable cap is the final protection. If sponsored credits are one-time rather than recurring, arrange a matching provider-side cap before enabling this recurring allowance.

Then deploy again:

```sh
npm run proxy:deploy
```

Secrets and existing quota records survive normal deployments. Keep the Worker name, Durable Object binding/class, migration and `sponsored-v1` object name unchanged. Do not delete the namespace to reset an error: it contains the live quota records.

## 5. Start scanning

1. Open the Slop Detector popup and select **GPTZero**.
2. Select the **GPTZero** tab and approve access to your proxy host.
3. The popup should show the weekly allowance. Enabling checks the proxy without making a paid GPTZero evaluation.
4. Refresh X or LinkedIn, then scroll. A visible readable post will make the first real GPTZero call.
5. Choose **Jev** whenever you want your own prompt. Existing Jev keys and prompts remain saved. The extension never silently switches to a paid personal key after a quota failure.

After the proxy is configured, `slop-detector.zip` contains the distributable extension. It contains the public endpoint but no server secrets or Worker source.

## Distribution and maintenance

- **Chrome Web Store:** add the store-assigned extension ID to `ALLOWED_EXTENSION_IDS` and redeploy. Multiple IDs can be separated with commas. Unpacked IDs can differ across machines or paths. A consumer release should use a stable Web Store ID; the local ID is for your development install.
- **Stop sponsored calls:** set `SPONSORED_ENABLED` to `"false"` in `proxy/wrangler.jsonc`, then run `npm run proxy:deploy`. Already dispatched calls may finish. Jev is unaffected.
- **Rotate a compromised GPTZero key:** replace it with the `wrangler secret put GPTZERO_API_KEY` command. This does not reset quotas.
- **Adjust allowances:** edit the config file and redeploy. Raising a limit grants more of the current period; lowering it takes effect against usage already recorded. Do not edit only dashboard variables: the next CLI deployment reapplies the file's values.
- **Update the extension:** `npm run package`, reload it in Chrome, and refresh social tabs. Preserve `proxy.config.json` to retain your endpoint.
- **Don't set up paid fallbacks or automatic upgrades.** Free Workers and SQLite Durable Object operations fail when their limits are exceeded. Free scanning then becomes unavailable; it doesn't bypass quota checks or forward directly to GPTZero. Stay on Free to retain this behavior. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

## What the limits protect

The proxy makes one atomic reservation before each uncached GPTZero request. Concurrent tabs, Worker instances and restarts cannot double-spend the last allowance. A 24-hour cache shares only sanitized scores for identical text; cached results do not consume new checks. Concurrent identical requests wait for one result. Provider 429 responses trigger a shared cooldown honoring `Retry-After`. Failures count conservatively because a timed-out request may already have been billed upstream. Invalid/unsupported text is marked Unrated, not Not slop, and cached briefly to avoid repeated failed requests.

Anonymous installation IDs are not authenticated people. Reinstalling or a custom client can create another ID, and an extension-origin header can be spoofed outside a browser. IP and global quotas contain that abuse; they cannot prevent someone exhausting the shared free service. Strict per-person quotas would require sign-in. The proxy itself can still be called by attackers, so an application quota is not a hosting spend cap on a paid plan.

The default workload is intentionally bounded. Worker requests, storage reads/writes, usage lookups, retries and rejected requests all use Cloudflare capacity. Do not assume the free request allowance equals that many classified posts. No post text, raw IP or API key is stored in application logs or the quota database. See [PRIVACY.md](PRIVACY.md).

## Troubleshooting

- **GPTZero is not set up in this build:** run `configure:proxy` with the public URL, then `npm run package`, and reload the extension.
- **Connection fails:** check the URL, both Cloudflare secrets, `SPONSORED_ENABLED`, the extension ID and its proxy permission. `/health` alone doesn't check those settings.
- **Free limit reached with weekly checks left:** an IP/global limit can be reached first. Check the configured quotas and Cloudflare usage. Wait for the relevant reset, or choose Jev.
- **GPTZero is temporarily unavailable:** check the sponsored credits and API access with GPTZero. The proxy does not relay provider error bodies to the extension.
- **Cloudflare error 1027/storage limits:** the free plan has stopped service. Let the daily limits reset; don't upgrade automatically to fix a temporary traffic spike.

## Local validation

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
npm run test:proxy
npm run test:gptzero
```

The proxy test runs the actual Cloudflare runtime and SQLite Durable Object with mocked GPTZero responses. The GPTZero browser test runs the extension through a temporary local HTTPS proxy into that Worker. It uses an isolated Chrome profile and a one-day test certificate; nothing is deployed or billed. Jev transport, permissions, layout and viewport regression tests also use mocks. The current deployed sponsored key also passed a live sample classification on 5 October 2026.

## Score interpretation in extension 2.1.2

The extension now derives its GPTZero Slop score from the AI class probability alone and requires an AI classification. Mixed and Human results do not trigger Slop effects. The v1 proxy wire format retains its original aggregate `probability` for compatibility with older installations; updated extensions derive the new score from the accompanying `gptzero.probabilities`. Both local and proxy caches are handled without spending another evaluation. No Worker redeploy or cache reset is required for this extension update.
