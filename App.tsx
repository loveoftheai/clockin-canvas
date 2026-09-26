import "react-native-get-random-values";
import { Buffer } from "buffer";
import { useState, useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
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

// web3.js expects a Buffer global in RN.
(globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;

/* ── Clock In Canvas ─────────────────────────────────────────────
 * A shared pixel board for Seeker: your daily check-in places one pixel.
 * Mobile-native rethink of Cookie Canvas (web) — touch-first grid,
 * Mobile Wallet Adapter sign-in, streak mechanics.
 * Board state: on-chain program (devnet for the hackathon build).
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
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
const APP_IDENTITY = {
  name: "Clock In Canvas",
  uri: "https://clockincanvas.app",
} as const;

type Pixel = {
  x: number;
  y: number;
  color: string;
  owner?: string;
  day?: string;
  sig?: string;
};
type WalletState = "signed-out" | "authorizing" | "signed-in";

const today = () => new Date().toISOString().slice(0, 10);

const addressToBase58 = (base64: string) =>
  new PublicKey(Buffer.from(base64, "base64")).toBase58();

const buildClockInTx = (
  feePayer: PublicKey,
  blockhash: string,
  p: { x: number; y: number; color: string; day: string },
) =>
  new Transaction({ feePayer, recentBlockhash: blockhash }).add(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(
        JSON.stringify({
          app: "clockin",
          x: p.x,
          y: p.y,
          c: p.color,
          d: p.day,
        }),
        "utf8",
      ),
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
  const [txState, setTxState] = useState<string>("");

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
      setPubkey(addressToBase58(result.accounts[0].address));
      setWallet("signed-in");
      setStreak(1); // streak recompute arrives with on-chain history read
    } catch (e) {
      setWallet("signed-out");
      setTxState(
        e instanceof Error
          ? `connect failed: ${e.message}`
          : "connect cancelled",
      );
    }
  }, []);

  // Clock-in = one memo tx per wallet per day, signed in the wallet app.
  const placePixel = useCallback(
    async (x: number, y: number) => {
      if (wallet !== "signed-in" || !auth || placedToday) return;
      const color = PALETTE[picked];
      const day = today();
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
          { x, y, color, owner: pubkey ?? "me", day, sig },
        ]);
        setPlacedToday(true);
        setTxState(
          sig
            ? `✓ ${sig.slice(0, 4)}…${sig.slice(-4)} confirmed on devnet`
            : "✓ clocked in",
        );
      } catch (e) {
        setTxState(
          e instanceof Error ? `tx failed: ${e.message}` : "tx cancelled",
        );
      }
    },
    [wallet, auth, placedToday, picked, pubkey],
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <Text style={s.h1}>CLOCK IN CANVAS</Text>
        <Text style={s.sub}>
          {wallet === "signed-in"
            ? `${pubkey?.slice(0, 4)}…${pubkey?.slice(-4)} · 🔥 ${streak}d streak`
            : "one pixel a day, on-chain forever"}
        </Text>
      </View>

      <Board
        pixels={pixels}
        onCell={placePixel}
        locked={wallet !== "signed-in" || placedToday}
      />

      <View style={s.paletteRow}>
        {PALETTE.map((c, i) => (
          <Pressable
            key={c}
            onPress={() => setPicked(i)}
            style={[
              s.swatch,
              { backgroundColor: c },
              picked === i && s.swatchOn,
            ]}
          />
        ))}
      </View>

      <View style={s.footer}>
        {wallet === "signed-in" ? (
          <Text style={placedToday ? s.done : s.cta}>
            {placedToday
              ? "✓ clocked in today — come back tomorrow"
              : "tap the board to clock in"}
          </Text>
        ) : (
          <Pressable
            style={s.button}
            onPress={connect}
            disabled={wallet === "authorizing"}
          >
            {wallet === "authorizing" ? (
              <ActivityIndicator color="#011627" />
            ) : (
              <Text style={s.buttonText}>Connect wallet (Seed Vault)</Text>
            )}
          </Pressable>
        )}
        <Text style={s.meta}>
          {txState || `${pixels.length} pixels placed · devnet`}
        </Text>
      </View>
    </View>
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
  const at = (x: number, y: number) =>
    pixels.find((p) => p.x === x && p.y === y);
  return (
    <ScrollView horizontal bounces={false} contentContainerStyle={s.boardWrap}>
      <View style={{ borderWidth: 2, borderColor: "#cbf3f0" }}>
        {rows.map((y) => (
          <View key={y} style={s.row}>
            {cols.map((x) => {
              const p = at(x, y);
              return (
                <Pressable
                  key={x}
                  disabled={locked}
                  onPress={() => onCell(x, y)}
                  style={[s.cell, { backgroundColor: p ? p.color : "#0b2038" }]}
                />
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#011627", paddingTop: 54 },
  header: { paddingHorizontal: 18, paddingBottom: 12 },
  h1: { color: "#cbf3f0", fontSize: 28, fontWeight: "800", letterSpacing: 1 },
  sub: { color: "#ffbf69", fontSize: 13, marginTop: 4 },
  boardWrap: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 8,
  },
  row: { flexDirection: "row" },
  cell: { width: 20, height: 20, margin: 0.5 },
  paletteRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 12,
  },
  swatch: { width: 34, height: 34, borderRadius: 17 },
  swatchOn: { borderWidth: 3, borderColor: "#fff" },
  footer: { alignItems: "center", paddingBottom: 28, gap: 8 },
  button: {
    backgroundColor: "#ff9f1c",
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 26,
  },
  buttonText: { color: "#011627", fontWeight: "700", fontSize: 15 },
  cta: { color: "#cbf3f0", fontSize: 15 },
  done: { color: "#2ec4b6", fontSize: 15, fontWeight: "600" },
  meta: { color: "#5b718a", fontSize: 12 },
});
