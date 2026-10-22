# Install Slop Detector

[English installation and usage](README.md#install) · [中文安装与使用](README.zh-CN.md#安装)

```sh
git clone https://github.com/cheercheung/slop-detector.git
cd slop-detector
npm ci
npm run build
```

Use Node 24.18+ within 24.x and Chrome 120+. Open `chrome://extensions`, enable Developer mode, choose Load unpacked and select `dist/`.

Fresh installs select Decision model → EvoLink Luna Decision. Enter a key in the popup and click Connect; the connection check sends a sample request and may incur a charge. API keys are not read from `.env` files. Detailed provider, language, threshold and update instructions are in the linked READMEs.
