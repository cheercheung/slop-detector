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

### Decision model (Jev or EvoLink Luna Decision)

Local adaptation, 2026-10-21: no extension installation or real calls were performed by this task; see [local setup and authorization boundary](EVOLINK_LOCAL.md). The following upstream manual steps are for separately approved live use.

Fresh installs select **Decision model → EvoLink Luna Decision**. Existing saved detector/provider choices are preserved. Enter a key and click **Connect**, then approve access when Chrome asks. Connect sends one synthetic sample request and can incur a charge.

| Provider | Get a key |
| --- | --- |
| AI Gateway | [Vercel AI Gateway](https://vercel.com/d/ai-gateway) — use a Gateway key |
| OpenRouter | [OpenRouter](https://openrouter.ai/settings/keys) |
| Jev (TypeSafe) | [TypeSafe](https://console.typesafe.ai/) |
| EvoLink Luna Decision | [EvoLink API keys](https://evolink.ai/dashboard/keys?utm_source=github&utm_medium=extension&utm_campaign=slop) — dedicated EvoLink key |

Under **Prompt**, enter your question and click **Save prompt**. A “yes” means Slop.

## Settings

- **On slop:** stamp, fade or collapse flagged posts. Hide is the default; **Show post** expands a collapsed post.
- **Language / 语言:** follow the browser language, or choose English / 简体中文. The choice is saved and also updates feed labels. Your custom prompt text stays unchanged.
- **Slop threshold / Slop 判定阈值:** Slop probability **greater than or equal to** the threshold is flagged. Defaults to **70%**. Drag the slider or enter a whole percentage from **0 to 100**; changes save automatically on release/commit (press Tab or click outside the number field). **Reset to 70% / 恢复为 70%** restores the default. Invalid input is rejected. Changing the threshold reuses cached scores and does not ask the model to score the same text again. At 0% every valid Luna result meets the threshold; at 100% only a probability of 1 does.
- **Scores:** Slop shows the Slop probability; Not slop shows its complement (100% minus that probability). There is one decision threshold, not two independent scores.
- **Show not-slop:** show Not slop labels and the loading indicator.
- **Show score:** show confidence in the displayed label.

Use the top switch to pause scanning. Click a result label to open settings. **Clear cache** rechecks visible items.

Only post, comment and reply text is checked, up to 6,000 characters per item. Images and videos aren't analysed. See [Privacy](PRIVACY.md) for storage and data use.

## Updates and troubleshooting

For unpacked installs, rebuild or replace the files, click **Reload** at `chrome://extensions`, then refresh your feed.

- **No results:** check the top switch, site access and **Show not-slop** setting.
- **Access needed:** open the popup and approve the requested permission.
- **Checks failing:** check your provider's credits and connection. For free GPTZero, check the allowance shown in the popup.

## 使用新版设置（中文）

1. 已安装的用户：在 `chrome://extensions` 点击 Slop Detector 的重新加载按钮，再刷新 X / LinkedIn。首次安装选择本仓库的 `dist/` 文件夹。
2. 顶部「Language / 语言」可选择「简体中文」「English」或跟随浏览器。
3. 首次安装默认使用 EvoLink Luna Decision；已有设置会保留，可在「决策模型」中手动选择。
4. 点击「获取 Key」打开带 UTM 的 EvoLink Key 页面，在扩展中填写 Key 并连接。连接检查会发送一条样例请求，可能计费。
5. 「Slop 判定阈值」默认 70：概率 **≥70%** 判为 Slop。可输入 0–100 的整数，按 Tab 或点击其他位置自动保存；也可拖动滑块。
6. 首次观察效果可选择「盖章」或「淡化」，并开启「显示分数」。测试完可关闭顶部检测开关。
