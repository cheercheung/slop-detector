# Install or update Slop Detector

Version **2.1.3** supports posts, comments and replies on **X and LinkedIn**.

## Update your existing installation

1. Open **chrome://extensions** in Chrome.
2. Find **Slop Detector** and click **Reload**. The version should show **2.1.3**.
3. Ensure the extension has access to X and LinkedIn. If its popup shows **Allow access**, click it to approve access to your selected API provider; your saved key is retained.
4. Refresh your X and LinkedIn tabs.

The rebuilt extension is in the same `dist` folder. Saved keys, prompts and settings are retained. New installations start with GPTZero, a **70%** threshold and **Hide**. Click **Allow GPTZero access** in the popup to finish setup. The button disappears once connected.

Provider permissions are now optional. The update removes old grants for providers with no saved key and keeps access for connected providers.

## First installation

1. Open **chrome://extensions** and enable **Developer mode**.
2. Click **Load unpacked**, then choose:

   `/Users/robin/Documents/ChatGPT/Slop detector/dist`

   In the Mac folder picker, press **⌘⇧G**, paste the path, and select **dist**.
3. Pin **Slop Detector** from Chrome’s Extensions menu.
4. Open its popup and click **Allow GPTZero access** for free scanning. Or select **Jev**, choose a provider, paste its API key, and click **Connect**. Approve access to that provider when Chrome asks. This then makes a small evaluation to verify the key before saving it. Provider charges may apply.
5. Open or refresh X or LinkedIn and scroll. Open comment threads or load replies normally; each is checked independently as it appears.

Keep the extension folder in place. To install from `slop-detector.zip` on another computer, unzip it to a permanent folder and load that folder. End users do not need to deploy a server. The extension publisher sets up the sponsored GPTZero proxy once using [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md). Jev and personal GPTZero keys work directly without a proxy.

Checks start only when the item's own text stays on screen for a quarter-second. Posts and comments further down the page wait until you reach them, and queued checks or retries stay idle while offscreen. Background tabs stay idle. A request already sent can still finish and save its result.

## GPTZero

For free scanning, the publisher must deploy the proxy and build its public URL into the extension; see [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md). GPTZero does not need an API key from individual users. Select **GPTZero**, then click **Allow GPTZero access** if shown, and approve Chrome’s permission prompt. If access is already granted but setup failed, click **Connect GPTZero** to retry. Enabling only reads your quota; it does not spend a GPTZero evaluation.

The popup shows the installation's weekly allowance and reset time. Shared IP/service limits can stop new evaluations earlier. Clearing cache, pausing or switching detectors does not reset server quota. Cached scores can still be reused at the limit. To continue, select **Access → Your API key**, enter a personal [GPTZero API key](https://app.gptzero.me/app/api), and click **Connect**. Approve access to **api.gptzero.me**. The key is checked with one short sample before saving; this uses your own GPTZero credits. Visible items then go directly to GPTZero, without the sponsored proxy or its allowance. You can also choose Jev with your own key. No automatic paid fallback occurs.

Choose **Access → Free** to return to the sponsored allowance. Personal mode remains selected across Chrome restarts. It works even in builds without a proxy URL. Free usage is hidden while personal mode is active. Both GPTZero routes reuse local scores and limit scanning to one request at a time, at least 3.1 seconds apart; provider rate limits are respected. A failed replacement keeps the saved key. **Remove saved key** deletes it and releases the direct API permission; select Free explicitly if you want to resume sponsored scanning.

GPTZero uses only the AI probability for the Slop score. It must classify the item as **AI**, and that score must meet your threshold, before a Slop label, stamp, fade or hide is applied. **Mixed** (including AI-polished human writing) and **Human** results remain Not slop, even with a low threshold. Not slop displays one minus the AI probability. Existing cached scores are corrected from their saved class probabilities without another API call. This is a model estimate, not a percentage of AI-written words or a judgment of a post's value. Click a Slop or Not slop label to open the extension settings. Text the API cannot evaluate stays **Unrated**.

## Jev provider keys

| Provider | Get a key |
| --- | --- |
| AI Gateway | [Vercel AI Gateway](https://vercel.com/d/ai-gateway) — use a Gateway key, not a Vercel account token |
| OpenRouter | [OpenRouter keys](https://openrouter.ai/settings/keys) |
| Jev (TypeSafe) | [TypeSafe console](https://console.typesafe.ai/) — requires API access on your account |

You can save all three keys. Select the provider you want to use; the dropdown marks saved connections. Only that provider receives requests. Switching to a saved provider asks for its site permission if needed; denying access keeps your current provider. **Remove saved key** deletes the selected provider’s key and releases its permission. A failed replacement leaves its existing key intact. Accounts need the required access and credits.

Key checks time out after 20 seconds. You can click **Cancel** and retry; reopening the popup shows any check still in progress. A cancelled check does not replace your saved key.

## Prompt and score

The default prompt is exactly:

> Is this an automated, AI-generated or otherwise low-effort post that offers little value?

In **Jev** mode, under **Prompt**, edit the question and click **Save prompt**. A “yes” maps to **Slop**. There are no extra instructions: Jev receives this prompt and the individual item's text. Saving a new prompt rechecks visible items. **Reset to default** restores the question above.

The percentage shows confidence in the displayed label: **Slop** uses the estimated probability of a yes to your question, and **Not slop** uses the probability of a no. For example, a 32% slop probability displays **Not slop · 68%**. **Slop threshold** still applies to the probability of slop, defaulting to 70%. These are model estimates, not proof of AI authorship. Threshold changes reuse existing scores.

## Appearance

- **Show not-slop:** display or suppress Not slop badges.
- **Checking radar:** shown only when Show not-slop is on, in the result's row. Turning Show not-slop off hides both checking and queued indicators. Scanning continues in the background. Reduced-motion preferences are respected.
- **Show score:** display or suppress percentages on badges.
- **Stamp:** a large red SLOP stamp drops onto flagged content. It allows clicks through and fades on hover or keyboard focus. Reduced-motion settings disable the animation.
- **Fade out:** fade flagged text and media; hover restores readability.
- **Hide (default):** collapse flagged content into a compact **Slop detected - Show post** row. Click it to expand the post. Replies remain independently accessible. Click **Hide post** to collapse it again.

Pause with the top switch. Pausing restores hidden/faded content and removes stamps. **Clear cache** deletes saved scores and rechecks visible items using the current prompt.

## Scope and privacy

Only loaded, readable post/comment/reply text is evaluated. Images, videos, linked pages, author profiles and reaction counts are not analyzed. Draft editors are ignored. Each comment/reply is evaluated separately from its parent. Up to 6,000 characters are sent per item; editing or expanding text triggers a new check.

Personal GPTZero and Jev keys and your prompt stay in trusted local extension storage, without Chrome Sync. Free GPTZero sends text through the publisher's proxy and uses an anonymous installation ID for quotas. Personal GPTZero sends text directly to its API. Its shared API key stays on the server. The local session cache contains hashes and scores, not item text. See [PRIVACY.md](PRIVACY.md) for storage details and provider data flows.

## Troubleshooting

- **Allow GPTZero access:** open the popup and click **Allow GPTZero access**. No detector switch is needed.
- **Connect Jev:** add a key for the selected provider, or switch to a provider with a saved key.
- **Allow provider access:** open the popup and click **Allow access**. Your key is already saved; approve that provider's permission to resume checks.
- **Key check stuck on an older version:** reload the extension at **chrome://extensions** to clear the old check, then try connecting again. Updated versions show progress and a Cancel button.
- **Queued for Jev stays on visible posts:** version 2.0.15 fixes a scrolling visibility check that could leave replies queued, and ensures stalled requests release the queue. Reload the extension, then refresh the site. Offscreen posts still wait until you reach them.
- **Couldn’t rate:** check the key, credits, provider access and network. Errors never become Slop verdicts.
- **No labels:** refresh the site after updating, confirm site access and the top switch, and check whether Show not-slop is off.
- **Old content still visible in Hide:** a Show post override stays until the item changes or is rechecked. Click Hide post to collapse it.
- **Layout changes:** X and LinkedIn can change their markup; an adapter update may be needed.

Automated checks use mocked provider responses. Connecting your own key performs the live API check. Store users receive updates through Chrome; the steps above are for unpacked installations.
