# Security

Report vulnerabilities to **robin@whirl.sh** with the affected version and steps to reproduce. Don't include live keys or private user data. Please wait for a fix before posting details publicly. Security fixes apply to the latest release.

## Keys and access

Personal API keys are stored in `chrome.storage.local`. Content scripts can't read them, but someone with access to the Chrome profile can. See [Privacy](PRIVACY.md) for details.

Store the shared GPTZero key in Cloudflare Secrets. Keep keys and local deployment config out of Git and extension builds. If a key leaks, revoke it before removing it from Git history.

The proxy's installation IDs and origin checks aren't authentication. Global quotas limit API use, but they don't cap Cloudflare hosting costs.
