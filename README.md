# Clock In Canvas

**One pixel a day, on-chain forever.** A pixel board for Seeker where your daily
check-in places one pixel. Every check-in is a real Solana transaction signed in your
wallet; the memo transaction set is the permanent on-chain record of who showed up,
where, and when.

Streak apps die because check-ins live in someone's database. Clock In Canvas makes the
daily ritual itself the product: touch a cell, sign in your wallet, watch your pixel land.
Over a season the check-ins add up to a mural of everyone who showed up — and a daily
reason to open your Seed Vault wallet.

**Honest scope of this hackathon build (v1):** the memo transactions are submitted and
confirmed on devnet (that part is fully real and auditable), but the board you see renders
from session-local state — restart the app and the picture is gone while the transactions
stay on-chain. The shared on-chain board (Anchor program) is milestone 1 of the roadmap.
The one-check-in-per-day rule and the streak are client-side (per session); recomputing
them from wallet history is milestone 2.

## Why this is mobile-native

- **Touch-first 16×16 board** — big cells, one-thumb clock-in, not a desktop canvas ported down.
- **Seed Vault / Mobile Wallet Adapter** — sign-in and signing go through the native wallet
  flow (`mobile-wallet-adapter-protocol-web3js`), MWA v2 semantics.
- **A 20-second ritual** — open, tap, sign, done. Habit mechanics (streak, one-pixel-per-day)
  are the whole loop, built for the device you carry every day.

## The check-in transaction

Each clock-in is a signed memo transaction on devnet (mainnet support is planned, not
shipped — RPC and chain are devnet in v1) carrying the pixel payload:

```json
{ "app": "clockin", "x": 8, "y": 7, "c": "#ff9f1c", "d": "2026-09-26" }
```

Program: SPL Memo (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) — every check-in is
auditable on-chain with the wallet that placed it and the day it was placed. The
one-transaction-per-wallet-per-day rule is enforced client-side in this build.

Demo clip: cold start → connect wallet (authorize sheet) → tap a cell → sign & send →
"confirmed on devnet" with the signature — the full MWA round-trip in 22 seconds. The demo
transaction was verified on the devnet explorer after the take.

## SKR / Seeker activity

Clock In Canvas is designed to feed the SKR activity flywheel: one signed on-chain
transaction per day (Onchain category), a daily open-and-tap ritual (Daily Use), and a
dApp Store release so check-ins count as dApp exploration (dApp Store publishing is on the
roadmap). The app's whole mechanic is "give Seeker owners a daily reason to transact from
their own wallet." Direct SKR program integration (earning/redeem flows) is roadmap work
once the program SDK is available to this build.

## AI

This project was built AI-first: architecture, MWA v2 wiring, UI, and the redroid-based
on-device UI automation that produced the demo take were all developed with AI agents
(Claude Code as the builder, Codex as the adversarial reviewer whose honesty pass is
reflected in this README). Roadmap: on-device AI suggestions for the daily pixel
(spot in the mural with the most impact today).

## Tech

- Expo SDK 57 / React Native 0.86 / React 19 — TypeScript throughout
- `@solana-mobile/mobile-wallet-adapter-protocol-web3js` — authorize + sign-and-send
  (same-session reauthorize for the privileged sign method, `chain: solana:devnet`)
- `@solana/web3.js` — legacy memo transaction, devnet RPC

### Build

```bash
npm install
npx tsc --noEmit
cd android && ./gradlew :app:assembleRelease   # app-release.apk
```

Requires JDK 17 and an Android SDK; the APK installs on any arm64 Android device or emulator.

## Roadmap

1. On-chain board state (Anchor program) — pixels live in program accounts, board renders
   from chain instead of local session state
2. Streak recomputation from wallet history (getSignaturesForAddress → memo replay),
   replacing the client-side daily rule
3. dApp Store release (create-dapp-store, publishing approval)
4. Season 1 — timed boards, mural mint at season end, creator boards for communities

## License

MIT
