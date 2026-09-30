import "react-native-get-random-values";
import { Buffer } from "buffer";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import type { AuthorizationResult } from "@solana-mobile/mobile-wallet-adapter-protocol";
import {
  buildMemoPayload,
  collapseByDay,
  decodeMemo,
  streakFromDays,
  today,
  type Pixel,
} from "./src/lib";

// web3.js expects a Buffer global in RN.
(globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;

/* ── Clock In Canvas ─────────────────────────────────────────────
 * A shared pixel board for Seeker: your daily check-in places one pixel.
 * Mobile-native rethink of Cookie Canvas (web) — touch-first grid,
 * Mobile Wallet Adapter sign-in, streak mechanics.
 * v1: the board rehydrates from the wallet's own memo history on
 * connect (restart-safe); the memo txs ARE the on-chain record
 * (shared cross-wallet board = next milestone, see README roadmap).
 * ─────────────────────────────────────────────────────────────── */

const GRID = 16; // 16x16 on-phone board; zoom/pan arrives with Skia pass
const PALETTE = [
  "#ff9f1c",
  "#ffbf69",
  "#2ec4b6",
  "#cbf3f0",
  "#011627",
  "#e71d36",
];
const COLOR_NAMES = ["Orange", "Peach", "Teal", "Ice", "Navy", "Red"];
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
const APP_IDENTITY = {
  name: "Clock In Canvas",
  uri: "https://clockincanvas.app",
} as const;

type WalletState = "signed-out" | "authorizing" | "signed-in";

/* Rebuild the session board + streak from the wallet's own memo history:
 * every past clock-in tx is an auditable record, so the app can rehydrate
 * state after a restart instead of pretending it never happened. Pages
 * past the first 20 signatures (cap 200) so older pixels survive, counts
 * only SPL Memo instructions on this app's program, and stamps each pixel
 * with chain order (seq) for deterministic same-day collapse. */
const loadHistory = async (feePayer: PublicKey) => {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const found: Pixel[] = [];
  const days = new Set<string>();
  let before: string | undefined;
  let seq = 0; // decreases: signatures arrive newest-first
  for (let page = 0; page < 10; page++) {
    const sigs = await conn.getSignaturesForAddress(feePayer, {
      limit: 20,
      before,
    });
    if (!sigs.length) break;
    before = sigs[sigs.length - 1].signature ?? undefined;
    const good = sigs.filter((s) => s.signature && !s.err);
    // fetch transaction bodies in devnet-friendly batches of 10;
    // a failed batch is skipped, not fatal — keep whatever synced so far
    for (let i = 0; i < good.length; i += 10) {
      const batch = good.slice(i, i + 10);
      let txs;
      try {
        txs = await Promise.all(
          batch.map((s) =>
            conn.getTransaction(s.signature!, {
              maxSupportedTransactionVersion: 0,
            }),
          ),
        );
      } catch {
        continue;
      }
      txs.forEach((tx, j) => {
        const msg = tx?.transaction.message;
        const ixs = (
          msg && "instructions" in msg ? msg.instructions : []
        ) as Array<{
          data?: string;
          programId?: string;
          programIdIndex?: number;
        }>;
        for (const ix of ixs) {
          if (!ix.data) continue;
          // count only SPL Memo instructions on the clockin program.
          // json encoding: programIdIndex indexes accountKeys, which the
          // SDK returns as PublicKey objects (not strings — normalize
          // before comparing); jsonParsed: programId as string.
          const rawPid =
            typeof ix.programId === "string"
              ? ix.programId
              : (msg as { accountKeys?: unknown[] }).accountKeys?.[
                  ix.programIdIndex ?? -1
                ];
          const pid =
            typeof rawPid === "string"
              ? rawPid
              : typeof (rawPid as { toBase58?: unknown } | undefined)
                    ?.toBase58 === "function"
                ? (rawPid as { toBase58: () => string }).toBase58()
                : undefined;
          if (pid !== MEMO_PROGRAM_ID.toBase58()) continue;
          // legacy tx memo payload arrives as base58-encoded bytes
          const m = decodeMemo(ix.data);
          if (m) {
            days.add(m.d);
            found.push({
              x: m.x,
              y: m.y,
              color: m.c,
              owner: feePayer.toBase58(),
              day: m.d,
              sig: batch[j].signature,
              seq: seq--,
            });
          }
        }
      });
    }
    if (sigs.length < 20) break;
  }
  // one pixel per day (latest wins), oldest → newest so later days overwrite
  const pixels = collapseByDay(found);
  // streak = consecutive days ending today (or yesterday, grace for timezone)
  const streak = streakFromDays(days);
  return { pixels, streak, days };
};

const buildClockInTx = (
  feePayer: PublicKey,
  blockhash: string,
  p: { x: number; y: number; color: string; day: string },
) =>
  new Transaction({ feePayer, recentBlockhash: blockhash }).add(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(buildMemoPayload(p), "utf8"),
    }),
  );

export default function App() {
  const [wallet, setWallet] = useState<WalletState>("signed-out");
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [auth, setAuth] = useState<AuthorizationResult | null>(null);
  const [streak, setStreak] = useState(0);
  const [picked, setPicked] = useState(0);
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [placedToday, setPlacedToday] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [txState, setTxState] = useState<string>("");
  const daysRef = useRef<Set<string>>(new Set());

  // MWA connect — launches the wallet app (Phantom / Seed Vault) via
  // mobile-wallet-adapter-protocol; the returned auth_token powers
  // reauthorize on next launch once board state moves on-chain.
  const connect = useCallback(async () => {
    setWallet("authorizing");
    setTxState("");
    try {
      const result = await transact(async (w) =>
        w.authorize({ identity: APP_IDENTITY, chain: "solana:devnet" }),
      );
      setAuth(result);
      const feePayer = new PublicKey(
        Buffer.from(result.accounts[0].address, "base64"),
      );
      setPubkey(feePayer.toBase58());
      setWallet("signed-in");
      setSyncing(true);
      setTxState("syncing on-chain history…");
      // rehydrate board + streak from the wallet's own memo history;
      // board stays locked until sync settles (no placement/sync race)
      try {
        const { pixels: px, streak: st, days } = await loadHistory(feePayer);
        setPixels(px);
        setStreak(st);
        daysRef.current = days;
        setPlacedToday(days.has(today()));
        setTxState(
          px.length
            ? `synced ${px.length} clock-in${px.length > 1 ? "s" : ""} from devnet`
            : "no clock-ins yet — tap the board to start",
        );
      } catch {
        setTxState("history sync failed (devnet) — session-local mode");
      } finally {
        setSyncing(false);
      }
    } catch (e) {
      setWallet("signed-out");
      setTxState(
        e instanceof Error
          ? `connect failed: ${e.message}`
          : "connect cancelled",
      );
    }
  }, []);

  // Day rollover: if the app stays open across midnight (or is backgrounded
  // and resumed), unlock the board for the new day without a reconnect —
  // and recompute the streak from known days (a multi-day gap resets it
  // instead of incrementing a stale count).
  const refreshRollover = useCallback(() => {
    if (placedToday && !daysRef.current.has(today())) {
      setPlacedToday(false);
      setStreak(streakFromDays(daysRef.current));
    }
  }, [placedToday]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") refreshRollover();
    });
    const timer = setInterval(refreshRollover, 60_000); // foreground midnight
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refreshRollover]);

  // Clock-in = one memo tx per wallet per day, signed in the wallet app.
  const placePixel = useCallback(
    async (x: number, y: number) => {
      if (wallet !== "signed-in" || !auth || placedToday || busy) return;
      const color = PALETTE[picked];
      const day = today();
      setBusy(true);
      setTxState("signing in wallet…");
      try {
        const feePayer = new PublicKey(
          Buffer.from(auth.accounts[0].address, "base64"),
        );
        const { blockhash } = await new Connection(
          "https://api.devnet.solana.com",
          "confirmed",
        ).getLatestBlockhash();
        const tx = buildClockInTx(feePayer, blockhash, { x, y, color, day });
        const [sig] = await transact(async (w) => {
          // MWA v2: sign_and_send_transactions is privileged — authorize in
          // this same session first (app scope = remembered, usually silent).
          const reauth = await w.authorize({
            identity: APP_IDENTITY,
            chain: "solana:devnet",
          });
          setAuth(reauth);
          return w.signAndSendTransactions({ transactions: [tx] });
        });
        setPixels((p) => [
          ...p,
          { x, y, color, owner: pubkey ?? "me", day, sig, seq: Date.now() },
        ]);
        daysRef.current.add(day);
        setPlacedToday(true);
        setStreak((n) => n + 1);
        setTxState(
          sig
            ? `✓ ${sig.slice(0, 4)}…${sig.slice(-4)} confirmed on devnet`
            : "✓ clocked in",
        );
      } catch (e) {
        setTxState(
          e instanceof Error ? `tx failed: ${e.message}` : "tx cancelled",
        );
      } finally {
        setBusy(false);
      }
    },
    [wallet, auth, placedToday, busy, picked, pubkey],
  );

  const pending = syncing || busy;
  const statusError = /failed|cancelled/i.test(txState);

  return (
    <SafeAreaView
      style={[
        s.root,
        Platform.OS === "android" && {
          paddingTop: StatusBar.currentHeight ?? 24,
          paddingBottom: 32,
        },
      ]}
    >
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <Text style={s.h1}>Clock In Canvas</Text>
          <Text style={s.sub}>One pixel a day, on-chain forever.</Text>
          {wallet === "signed-in" && (
            <View style={s.identityRow}>
              <Text style={s.walletText}>
                {pubkey?.slice(0, 4)}…{pubkey?.slice(-4)} · devnet
              </Text>
              <View style={s.streakChip}>
                <Text style={s.streakText}>
                  {syncing ? "loading streak…" : `🔥 ${streak} day streak`}
                </Text>
              </View>
            </View>
          )}
        </View>

        <View style={s.boardCard}>
          <View style={s.boardHeading}>
            <Text style={s.sectionTitle}>Your canvas</Text>
            <Text style={s.boardCount}>16 × 16</Text>
          </View>
          <Board
            pixels={pixels}
            onCell={placePixel}
            locked={wallet !== "signed-in" || placedToday || busy || syncing}
          />
        </View>

        <View style={s.paletteSection}>
          <Text style={s.paletteLabel}>Your color: {COLOR_NAMES[picked]}</Text>
          <View style={s.paletteRow}>
            {PALETTE.map((c, i) => (
              <Pressable
                key={c}
                onPress={() => setPicked(i)}
                accessibilityRole="radio"
                accessibilityLabel={COLOR_NAMES[i]}
                accessibilityState={{ checked: picked === i }}
                style={[s.swatch, picked === i && s.swatchOn]}
              >
                <View style={[s.swatchFill, { backgroundColor: c }]}>
                  {picked === i && (
                    <View style={s.checkBadge}>
                      <Text style={s.checkText}>✓</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={s.footer}>
          {wallet !== "signed-in" ? (
            <Pressable
              onPress={connect}
              disabled={wallet === "authorizing"}
              accessibilityRole="button"
              accessibilityState={{ disabled: wallet === "authorizing" }}
              style={({ pressed }) => [s.button, pressed && s.buttonPressed]}
            >
              {wallet === "authorizing" && (
                <ActivityIndicator color="#211837" />
              )}
              <Text style={s.buttonText}>
                {wallet === "authorizing"
                  ? "Opening wallet…"
                  : "Connect wallet (Seed Vault)"}
              </Text>
            </Pressable>
          ) : (
            <View
              style={[
                s.actionPanel,
                pending && s.actionNeutral,
                !pending && placedToday && s.actionDone,
              ]}
            >
              <View style={s.actionRow}>
                {pending && <ActivityIndicator color="#B9A7FF" />}
                <Text style={!pending && placedToday ? s.done : s.cta}>
                  {syncing
                    ? "Syncing your canvas…"
                    : busy
                      ? "Completing check-in…"
                      : placedToday
                        ? "✓ Clocked in today"
                        : "Tap a square to clock in"}
                </Text>
              </View>
              {!pending && placedToday && (
                <Text style={s.doneHint}>See you tomorrow.</Text>
              )}
            </View>
          )}

          <Text
            accessibilityLiveRegion="polite"
            style={[s.meta, statusError && s.metaError]}
          >
            {txState || `${pixels.length} pixels placed · devnet`}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Board({
  pixels,
  onCell,
  locked,
}: {
  pixels: Pixel[];
  onCell: (x: number, y: number) => void;
  locked: boolean;
}) {
  const rows = Array.from({ length: GRID }, (_, y) => y);
  const cols = Array.from({ length: GRID }, (_, x) => x);
  // latest placement wins at a coordinate (pixels are chronological)
  const at = (x: number, y: number) => {
    for (let i = pixels.length - 1; i >= 0; i--) {
      const p = pixels[i];
      if (p.x === x && p.y === y) return p;
    }
    return undefined;
  };
  return (
    <View style={s.boardWrap}>
      <View style={s.grid}>
        {rows.map((y) => (
          <View key={y} style={s.row}>
            {cols.map((x) => {
              const p = at(x, y);
              return (
                <Pressable
                  key={x}
                  disabled={locked}
                  onPress={() => onCell(x, y)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: locked }}
                  accessibilityLabel={`Row ${y + 1}, column ${x + 1}, ${
                    p ? "filled" : "empty"
                  }`}
                  style={({ pressed }) => [
                    s.cell,
                    p && s.cellFilled,
                    p && { backgroundColor: p.color },
                    pressed && !locked && s.cellPressed,
                  ]}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#101116" },
  scroll: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 24,
  },
  header: { gap: 8 },
  h1: {
    color: "#F4F3FA",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  sub: { color: "#BABDCC", fontSize: 14, lineHeight: 20 },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  walletText: { color: "#9399AB", fontSize: 12, lineHeight: 18 },
  streakChip: {
    backgroundColor: "#30283F",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  streakText: {
    color: "#D5C8FF",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  boardCard: {
    backgroundColor: "#191B23",
    borderColor: "#303440",
    borderWidth: 1,
    borderRadius: 24,
    padding: 12,
    gap: 12,
  },
  boardHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    color: "#F4F3FA",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  boardCount: { color: "#9399AB", fontSize: 12, lineHeight: 18 },
  boardWrap: {
    backgroundColor: "#101116",
    borderRadius: 12,
    padding: 8,
  },
  grid: { width: "100%", aspectRatio: 1, gap: 2 },
  row: { flex: 1, flexDirection: "row", gap: 2 },
  cell: {
    flex: 1,
    borderRadius: 3,
    backgroundColor: "#242833",
    borderWidth: 1,
    borderColor: "#2D323F",
  },
  cellFilled: { borderColor: "#FFFFFF52" },
  cellPressed: { opacity: 0.7, transform: [{ scale: 0.9 }] },

  paletteSection: { gap: 12 },
  paletteLabel: { color: "#BABDCC", fontSize: 14, lineHeight: 20 },
  paletteRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
  },
  swatch: {
    width: 44,
    height: 48,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  swatchOn: {
    backgroundColor: "#2B253E",
    borderColor: "#B9A7FF",
  },
  swatchFill: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#FFFFFF52",
    alignItems: "center",
    justifyContent: "center",
  },
  checkBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#101116",
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: {
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },

  footer: { gap: 10 },
  button: {
    minHeight: 56,
    backgroundColor: "#B9A7FF",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonPressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  buttonText: {
    color: "#211837",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    letterSpacing: -0.2,
    flexShrink: 1,
    textAlign: "center",
  },
  actionPanel: {
    minHeight: 56,
    backgroundColor: "#252133",
    borderColor: "#403652",
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  actionNeutral: {
    backgroundColor: "#191B23",
    borderColor: "#303440",
  },
  actionDone: {
    backgroundColor: "#18382F",
    borderColor: "#305C4C",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  cta: {
    color: "#D5C8FF",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
  },
  done: {
    color: "#80E3BC",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  doneHint: { color: "#BABDCC", fontSize: 13, lineHeight: 18 },
  meta: {
    minHeight: 36,
    color: "#9399AB",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    paddingHorizontal: 4,
  },
  metaError: { color: "#FF9B9B" },
});
