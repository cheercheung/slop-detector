# Set up the GPTZero proxy

The proxy keeps the shared GPTZero key on Cloudflare and tracks the free allowance. Personal API keys don't need it.

## Create the config

Run `npm ci`, then create `proxy/wrangler.jsonc` with the config below. If you already have a deployment, use its existing config.

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

Adjust these limits to your GPTZero allowance. They count requests and characters, not billing credits. New checks stop when any limit is reached.

## Deploy

```sh
npm run proxy:login
npm run proxy:deploy
npx wrangler secret put GPTZERO_API_KEY --config proxy/wrangler.jsonc
openssl rand -hex 32 | npx wrangler secret put HASH_SECRET --config proxy/wrangler.jsonc
```

Enter your GPTZero key when prompted. The last command creates a hashing secret. Keep both secrets out of source files. The local Wrangler config is ignored by Git.

## Connect the extension

Use the URL from the deployment:

```sh
npm run configure:proxy -- https://slop-detector-proxy.your-subdomain.workers.dev
npm run package
```

Load `dist/` at `chrome://extensions` and copy its extension ID. In your Wrangler config:

- Set `ALLOWED_EXTENSION_IDS` to that ID. Separate multiple IDs with commas.
- Set `SPONSORED_ENABLED` to `"true"`.

Run `npm run proxy:deploy` again. Open the extension and click **Allow GPTZero access**. Add the Chrome Web Store extension ID to the config and redeploy before distributing it.

## Limits and maintenance

- To stop free scanning, set `SPONSORED_ENABLED` to `"false"` and redeploy.
- Weekly limits reset Monday at 00:00 UTC. Daily and monthly limits also use UTC.
- Results are cached for 24 hours. Failed requests still count towards quotas.
- `/health` checks whether the proxy is reachable; it doesn't check the API key.
- Keep the Worker name, migration, `QUOTAS` binding, `sponsored-v1` object name and `HASH_SECRET` unchanged to preserve quota and cache records.

Set a spending cap with GPTZero or agree to no overage charges. The proxy's quotas don't cap Cloudflare hosting costs, and installation IDs and origin headers can be spoofed.

Run `npm run test:proxy` to test the Worker locally with mock GPTZero responses.
