# Clock In Canvas

**One pixel a day, on-chain forever.** A shared pixel board for Seeker where your daily
check-in places one pixel. Every check-in is a real Solana transaction signed in your
wallet — miss a day and your streak resets, but the pixels you placed are on-chain for good.

Streak apps die because check-ins live in someone's database. Clock In Canvas makes the
daily ritual itself the product: touch a cell, sign in your wallet, watch your pixel land.
Over a season the board becomes a group mural of everyone who showed up — and a daily
reason to open your Seed Vault wallet.

## Why this is mobile-native

- **Touch-first 16×16 board** — big cells, one-thumb clock-in, not a desktop canvas ported down.
- **Seed Vault / Mobile Wallet Adapter** — sign-in and signing go through the native wallet
  flow (`mobile-wallet-adapter-protocol-web3js`), MWA v2 semantics.
- **A 20-second ritual** — open, tap, sign, done. Habit mechanics (streak, one-pixel-per-day)
  are the whole loop, built for the device you carry every day.

## The check-in transaction

Each clock-in is a signed memo transaction on devnet (mainnet-ready) carrying the pixel
payload:

```json
{ "app": "clockin", "x": 8, "y": 7, "c": "#ff9f1c", "d": "2026-09-26" }
```

Program: SPL Memo (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) — every check-in is
auditable on-chain with the wallet that placed it and the day it was placed. One
transaction per wallet per day is the rule the app enforces client-side.

Demo clip: cold start → connect wallet (authorize sheet) → tap a cell → sign & send →
"confirmed on devnet" with the signature — the full MWA round-trip in 22 seconds.

## SKR / Seeker activity

Clock In Canvas is designed as an SKR activity flywheel: one signed on-chain transaction
per day (Onchain category), a daily open-and-tap ritual (Daily Use), published on the
dApp Store (dApp exploration). The app's whole mechanic is "give Seeker owners a daily
reason to transact from their own wallet."

## Tech

- Expo SDK 57 / React Native 0.86 / React 19 — TypeScript throughout
- `@solana-mobile/mobile-wallet-adapter-protocol-web3js` — authorize + sign-and-send
  (same-session reauthorize for the privileged sign method, `chain: solana:devnet`)
- `@solana/web3.js` — legacy memo transaction, devnet RPC, confirmed commitment

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
2. Streak recomputation from wallet history (getSignaturesForAddress → memo replay)
3. dApp Store release (create-dapp-store, publishing approval)
4. Seasonal boards — board resets per season, final mural minted as the season trophy

## License

MIT
