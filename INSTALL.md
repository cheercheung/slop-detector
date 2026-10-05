# Install or update Slop Detector

Version **2.1.0** supports posts, comments and replies on **X and LinkedIn**.

## Update your existing installation

1. Open **chrome://extensions** in Chrome.
2. Find **Slop Detector** and click **Reload**. The version should show **2.1.0**.
3. Ensure the extension has access to X and LinkedIn. If its popup shows **Allow access**, click it to approve access to your selected API provider; your saved key is retained.
4. Refresh your X and LinkedIn tabs.

The rebuilt extension is in the same `dist` folder. Existing installs keep Jev selected and retain saved keys, prompts and settings. New installs start in GPTZero mode and require opt-in before sending text. To switch, use the GPTZero/Jev buttons in the popup. New installations default to **70%** and **Hide**; to use these on an existing installation, select them under **Appearance**. If dimming was previously enabled, it becomes **Fade out**.

Provider permissions are now optional. The update removes old grants for providers with no saved key and keeps access for connected providers.

## First installation

1. Open **chrome://extensions** and enable **Developer mode**.
2. Click **Load unpacked**, then choose:

   `/Users/robin/Documents/ChatGPT/Slop detector/dist`

   In the Mac folder picker, press **⌘⇧G**, paste the path, and select **dist**.
3. Pin **Slop Detector** from Chrome’s Extensions menu.
4. Open its popup. Choose **GPTZero → Enable GPTZero** for the sponsored service, if configured in this build. Or select **Jev**, choose a provider, paste its API key, and click **Connect**. Approve access to that provider when Chrome asks. This then makes a small evaluation to verify the key before saving it. Provider charges may apply.
5. Open or refresh X or LinkedIn and scroll. Open comment threads or load replies normally; each is checked independently as it appears.

Keep the extension folder in place. To install from `slop-detector.zip` on another computer, unzip it to a permanent folder and load that folder. End users do not need to deploy a server. The extension publisher sets up the sponsored GPTZero proxy once using [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md). Jev works directly with your own key.

Checks start only when the item's own text stays on screen for a quarter-second. Posts and comments further down the page wait until you reach them, and queued checks or retries stay idle while offscreen. Background tabs stay idle. A request already sent can still finish and save its result.

## GPTZero

The publisher must deploy the proxy and build its public URL into the extension; see [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md). GPTZero does not need an API key from individual users. Click **Enable GPTZero** and grant permission to the proxy host. Enabling only reads your quota; it does not spend a GPTZero evaluation.

The popup shows the installation's weekly allowance and reset time. Shared IP/service limits can stop new evaluations earlier. Clearing cache, pausing or switching detectors does not reset server quota. Cached scores can still be reused at the limit. Choose Jev with your own key to continue; no automatic paid fallback occurs.

GPTZero's AI and mixed probabilities are added to form the Slop score. Not slop displays the complementary probability. This is a model estimate, not a percentage of AI-written words or a judgment of a post's value. Open badge details for the original Human / Mixed human/AI / AI-generated category and model confidence. Text the API cannot evaluate stays **Unrated**.

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
- **Checking radar:** a small gray radar animates while the selected detector checks an item. When Show not-slop is on it occupies the result's row; when off it sits just below the left edge of the text without adding height. Queued items stay still, and reduced-motion preferences are respected.
- **Show score:** display or suppress percentages on badges and in their details.
- **Stamp:** a large red SLOP stamp drops onto flagged content. It allows clicks through and fades on hover or keyboard focus. Reduced-motion settings disable the animation.
- **Fade out:** fade flagged text and media; hover restores readability.
- **Hide (default):** collapse flagged content into a compact **Slop detected - Show post** row. Click it to expand the post. Replies remain independently accessible. Click **Hide post** to collapse it again.

Pause with the top switch. Pausing restores hidden/faded content and removes stamps. **Clear cache** deletes saved scores and rechecks visible items using the current prompt.

## Scope and privacy

Only loaded, readable post/comment/reply text is evaluated. Images, videos, linked pages, author profiles and reaction counts are not analyzed. Draft editors are ignored. Each comment/reply is evaluated separately from its parent. Up to 6,000 characters are sent per item; editing or expanding text triggers a new check.

Jev keys and your prompt stay in trusted local extension storage, without Chrome Sync. GPTZero sends text through the publisher's proxy and uses an anonymous installation ID for quotas. Its shared API key stays on the server. The local session cache contains hashes and scores, not item text. See [PRIVACY.md](PRIVACY.md) for storage details and provider data flows.

## Troubleshooting

- **Connect Jev:** add a key for the selected provider, or switch to a provider with a saved key.
- **Allow provider access:** open the popup and click **Allow access**. Your key is already saved; approve that provider's permission to resume checks.
- **Key check stuck on an older version:** reload the extension at **chrome://extensions** to clear the old check, then try connecting again. Updated versions show progress and a Cancel button.
- **Queued for Jev stays on visible posts:** version 2.0.15 fixes a scrolling visibility check that could leave replies queued, and ensures stalled requests release the queue. Reload the extension, then refresh the site. Offscreen posts still wait until you reach them.
- **Couldn’t rate:** check the key, credits, provider access and network. Errors never become Slop verdicts.
- **No labels:** refresh the site after updating, confirm site access and the top switch, and check whether Show not-slop is off.
- **Old content still visible in Hide:** a Show post override stays until the item changes or is rechecked. Click Hide post to collapse it.
- **Layout changes:** X and LinkedIn can change their markup; an adapter update may be needed.

Automated checks use mocked provider responses. Connecting your own key performs the live API check. This package has not been published to the Chrome Web Store.
