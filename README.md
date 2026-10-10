# Slop Detector

Chrome extension for X and LinkedIn posts, comments and replies. Version **2.1.3** offers sponsored GPTZero detection through a Cloudflare Worker, or a personal GPTZero key that calls its API directly. Users can explicitly switch to their own key when the free allowance runs out. GPTZero flags only AI-classified text above the chosen threshold; Mixed/AI-polished results are excluded. Jev keeps the editable prompt and AI Gateway, OpenRouter and direct TypeSafe key options.

- [Set up the Cloudflare proxy](CLOUDFLARE_SETUP.md)
- [Install or update the extension](INSTALL.md)
- [Privacy and data flow](PRIVACY.md)

```sh
npm ci
npm run check
npm run package
```

Configure the proxy's public HTTPS URL before packaging for GPTZero:

```sh
npm run configure:proxy -- https://slop-detector-proxy.your-subdomain.workers.dev
npm run package
```

A build without a proxy URL shows free scanning as unavailable; personal GPTZero keys and Jev remain usable. Never put the sponsored API key in the extension or its build configuration. Follow the setup guide to store it in Cloudflare Secrets and enable the proxy only after setting the sponsored allowance.

The proxy uses SQLite Durable Objects for atomic quotas, a score-only cache, shared provider cooldowns and a kill switch. It is compatible with the Workers Free plan; no external database is needed. No deployment is performed by build or package commands.
