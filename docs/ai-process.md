# How this build used AI — the actual record

This project was built by an AI agent (Claude Code) driving the repo, the Android
toolchain, an on-device emulator rig, and an adversarial second model (Codex) as
reviewer. Below is what that looked like concretely — the prompts that mattered, what
the agents discovered, and where the human stepped in. Nothing here is aspirational;
every item maps to a commit, a log, or a recorded take.

## 1. The agent derived MWA v2's real signing rules from protocol source

The first `sign_and_send_transactions` calls failed with opaque codes (`-1 auth_token
not valid for signing`, `-2 payloads invalid for signing`). Instead of guessing, the
agent read the wallet-protocol TypeScript source (`mobile-wallet-adapter-protocol`)
and the reference wallet implementation, and derived three rules that the docs don't
state plainly:

1. `sign_and_send_transactions` is a **privileged method**: it must be called inside the
   same `transact()` session that ran `authorize` — an auth token from a previous
   session is not attached automatically.
2. `authorize` must pin `chain: "solana:devnet"`, otherwise the wallet defaults to
   mainnet and every devnet blockhash is invalid there (surfaces as `-2`).
3. With a 90s client timeout and a ~60s blockhash TTL, the flow only survives if it is
   scripted end-to-end — pausing to inspect mid-flow guarantees a timeout.

Those rules are baked into `App.tsx` (same-session authorize → sign-and-send,
`chain: "solana:devnet"`) and this README's build notes.

## 2. The agent unblocked the native toolchain — and shipped the workaround upstream-safe

Local release builds died inside Hermes bytecode compilation: `hermesc` is an x86_64
binary and this build machine is aarch64. The agent's fix: a machine-guarded stub
(`hermesc` placeholder) that ships the plain JS bundle — Hermes parses it at load time —
wired into `build.gradle` so standard x86 machines are unaffected. Release APK builds
went from impossible to 7–9s incremental. The submitted APK is signed release build
output from this path.

## 3. The demo video is a real take, produced by scripted UI automation

`docs/demo.mp4` is one continuous 22-second screen recording from an Android emulator
(redroid) driven by scripted `uiautomator` taps: cold start (`pm clear` first) →
Connect → authorize sheet → tap one cell → sign sheet → send sheet → the confirmed
signature rendered on screen. The on-chain result of that exact take is
[`2t4ijdFU…QzPs` on devnet](https://explorer.solana.com/tx/2t4ijdFUTU3q79Zg8gW7AZRwsaYetByomA3miEburQrf5SczSFsK5N1NACgrn6oNpvrMi8PqPE3p3oxzG1jyQzPs?cluster=devnet).
The automation used adaptive polling (`tap_when`) rather than fixed sleeps — fixed
sleeps lost every race against the wallet sheets.

## 4. Adversarial review (Codex) shipped an honesty pass into the README

Before the first submission, the repo was handed to Codex for a read-only adversarial
review. Its findings — overstated claims ("mural of everyone" while v1 is per-wallet),
a streak counter that counted non-attendance, missing in-flight guards — produced the
commit _"Honesty pass (Codex review)"_ and the "Honest scope of this hackathon build"
section in the project README. A later Codex judge-mode review caught an evidence bug: the README's
"demo transaction" link contained a 32-byte value (an address, not a signature). The
link now points at the real 64-byte signature, verified against devnet RPC.

## 5. Where the human was essential

- Product judgment: the pivot from a general pixel canvas to a **daily check-in ritual**
  (one pixel per day, streak mechanics) — the mobile-native hook.
- Terms and scope decisions: what counted as "significant mobile development" under the
  hackathon rules, and what to declare honestly as session-scoped.
- Final take-or-retake calls on the demo video.

## Roadmap for AI in the product itself

On-device suggestion of "today's pixel" (the spot in the mural with the most visual
impact given current state) is designed but intentionally **not** shipped in this build —
the AI points above are development-process AI, fully real and documented; the product
AI feature will ship when it runs on the phone, not before.
