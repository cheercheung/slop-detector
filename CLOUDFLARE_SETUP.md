# Set up the GPTZero proxy

The Worker keeps your sponsored GPTZero key server-side and uses a SQLite Durable Object for quotas and cached scores. Local Wrangler config is ignored by Git and never included in the extension ZIP.

## 1. Create your local config

Install dependencies with `npm ci`, then create **`proxy/wrangler.jsonc`** locally. Do not overwrite an existing deployment’s config.

```json
{
  "$schema": "../node_modules/wrangler/config-schema.json",
  "name": "slop-detector-proxy",
  "main": "worker.ts",
  "compatibility_date": "2026-09-30",
  "workers_dev": true,
  "preview_urls": false,
  "assets": { "directory": "./static", "run_worker_first": ["/v1/*", "/health"] },
  "observability": { "enabled": false },
  "durable_objects": { "bindings": [{ "name": "QUOTAS", "class_name": "Quotas" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Quotas"] }],
  "vars": {
    "ALLOWED_EXTENSION_IDS": "",
    "SPONSORED_ENABLED": "false",
    "INSTALL_WEEKLY_LIMIT": "1000",
    "INSTALL_MINUTE_LIMIT": "20",
    "IP_DAILY_LIMIT": "2000",
    "GLOBAL_DAILY_LIMIT": "5000",
    "GLOBAL_MONTHLY_LIMIT": "100000",
    "GLOBAL_MONTHLY_CHARACTER_LIMIT": "5000000"
  }
}
```

These are example limits, not provider billing units. Set them to match your own allowance. The first exhausted limit stops new uncached checks. The character limit is an additional guard, not GPTZero’s billing meter.

## 2. Deploy and add secrets

```sh
npm run proxy:login
npm run proxy:deploy
npx wrangler secret put GPTZERO_API_KEY --config proxy/wrangler.jsonc
openssl rand -hex 32 | npx wrangler secret put HASH_SECRET --config proxy/wrangler.jsonc
```

Enter the GPTZero key at the hidden prompt. The second command generates a hashing secret and sends it directly to Cloudflare. Neither belongs in the config, source, build variables, or ZIP.

Keep the Worker name, migration, `QUOTAS` binding, `sponsored-v1` object name, and `HASH_SECRET` stable on future deploys: they preserve quota and cache identity.

## 3. Connect the extension

Use the HTTPS origin printed by deployment:

```sh
npm run configure:proxy -- https://slop-detector-proxy.your-subdomain.workers.dev
npm run package
```

Only the public URL is saved in ignored `proxy.config.json`. Load `dist/` at `chrome://extensions` and copy the extension ID.

Set `ALLOWED_EXTENSION_IDS` in your local Wrangler config to that ID (comma-separated for multiple IDs). Set `SPONSORED_ENABLED` to `"true"` when secrets and allowances are ready, then run `npm run proxy:deploy` again. Add your Chrome Web Store ID before distribution.

Open the popup, select GPTZero, and click **Allow GPTZero access**. Connection checks only read the allowance; visible posts trigger classifications.

## Operations

- Set `SPONSORED_ENABLED` to `"false"` and redeploy to stop new sponsored calls.
- Rotate keys using `wrangler secret put`. Normal deploys preserve secrets and quota records.
- `/health` checks reachability, not API credentials or quota availability.
- Weekly allowances reset Monday at 00:00 UTC. Daily and monthly limits use UTC calendar boundaries.
- Cached scores are shared for 24 hours. Concurrent duplicates spend once. Failed requests remain counted because the provider may already have processed them.
- Personal keys are an explicit user choice, never an automatic paid fallback.

Arrange a provider-side spending cap or no-overage agreement. Origin headers and anonymous installation IDs can be spoofed; global limits contain API usage, but application quotas are not a Workers Paid hosting budget.

Run `npm run test:proxy` for the actual local Worker/SQLite integration tests. They use mock GPTZero responses and deploy nothing.
