# Security

Report vulnerabilities privately to **robin@whirl.sh**. Include affected versions and reproduction steps, but no live keys, private feed text, or user data. Please do not post exploitable issues publicly before a fix is available.

Security fixes target the latest release.

## Boundaries

- Personal keys stay in `chrome.storage.local`, restricted to trusted extension contexts. Chrome does not provide extension-level encryption for this storage.
- The sponsored GPTZero key belongs only in Cloudflare Secrets. Never put it in the extension, a build variable, or a committed file.
- Content scripts can request classifications and open settings; they cannot read keys or change privileged settings.
- The proxy validates input and reserves quotas before calling GPTZero. It stores hashes and scores, not post text or raw IP addresses.
- Anonymous installation IDs and origin headers are not authentication. IP and global budgets limit abuse but cannot guarantee fair access or cap Cloudflare hosting spend.

If a credential enters Git history, revoke it first, then remove it from history before publication. Removing the current file or adding `.gitignore` is not sufficient.
