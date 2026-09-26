# Security policy

Clock In Canvas is a hackathon build on Solana devnet. The only secrets the app
could ever touch are the wallet's own keys, which never leave the Seed Vault —
the app has no server, no database, and no telemetry, and every check-in is a
wallet-signed SPL Memo transaction the user authorizes in the native sheet.

- Keys: never read, stored, or transmitted by this codebase. Signing happens
  exclusively inside the Mobile Wallet Adapter session.
- RPC: read-only devnet queries (`getSignaturesForAddress`, `getTransaction`)
  and wallet-signed transactions. No private RPC credentials in the repo.
- Secrets in repo: none. CI/release artifacts are built locally; the published
  APK contains no embedded credentials.

To report an issue, open a GitHub issue or reach the maintainer via the
hackathon team contact. Devnet-only in v1 — do not point this build at mainnet
funds.
