# Install Slop Detector

## Load in Chrome

Use Node 24.18+ (24.x). From the repository folder:

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select `dist/`.
3. Pin Slop Detector and open its popup.
4. Connect a detector, then refresh X or LinkedIn.

If you're using `slop-detector.zip`, unzip it and load that folder instead.

## Choose a detector

### GPTZero

For free scanning, click **Allow GPTZero access** and approve Chrome's prompt. Builds from this repository need a [configured proxy](CLOUDFLARE_SETUP.md) to offer the free allowance.

To use your own credits, choose **Access → Your API key**, enter a [GPTZero key](https://app.gptzero.me/app/api) and click **Connect**.

GPTZero flags posts classified as AI that meet your threshold. Mixed, AI-polished and human results aren't flagged.

### Jev

Select **Jev**, choose a provider, enter a key and click **Connect**, then approve access when Chrome asks.

| Provider | Get a key |
| --- | --- |
| AI Gateway | [Vercel AI Gateway](https://vercel.com/d/ai-gateway) — use a Gateway key |
| OpenRouter | [OpenRouter](https://openrouter.ai/settings/keys) |
| Jev (TypeSafe) | [TypeSafe](https://console.typesafe.ai/) |

Under **Prompt**, enter your question and click **Save prompt**. A “yes” means Slop.

## Settings

- **On slop:** stamp, fade or collapse flagged posts. Hide is the default; **Show post** expands a collapsed post.
- **Slop threshold:** minimum score to flag a post. Defaults to 70%.
- **Show not-slop:** show Not slop labels and the loading indicator.
- **Show score:** show confidence in the displayed label.

Use the top switch to pause scanning. Click a result label to open settings. **Clear cache** rechecks visible items.

Only post, comment and reply text is checked, up to 6,000 characters per item. Images and videos aren't analysed. See [Privacy](PRIVACY.md) for storage and data use.

## Updates and troubleshooting

For unpacked installs, rebuild or replace the files, click **Reload** at `chrome://extensions`, then refresh your feed.

- **No results:** check the top switch, site access and **Show not-slop** setting.
- **Access needed:** open the popup and approve the requested permission.
- **Checks failing:** check your provider's credits and connection. For free GPTZero, check the allowance shown in the popup.
