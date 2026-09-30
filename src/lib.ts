/* Pure logic shared by the app and the test suite: memo payload codec,
 * day-collapse, and streak computation. No React Native imports here. */
import { Buffer } from "buffer";
import bs58 from "bs58";

export type Pixel = {
  x: number;
  y: number;
  color: string;
  owner?: string;
  day?: string;
  sig?: string;
  seq?: number; // chain order (higher = newer); tiebreak within a day
};

export type MemoPayload = {
  app: "clockin";
  x: number;
  y: number;
  c: string;
  d: string;
};

/* The on-chain record: one JSON memo per check-in. */
export const buildMemoPayload = (p: {
  x: number;
  y: number;
  color: string;
  day: string;
}): string =>
  JSON.stringify({ app: "clockin", x: p.x, y: p.y, c: p.color, d: p.day });

/* Decode a base58 memo instruction into a payload, or null if it is not
 * a clockin memo. Mirrors what rehydration accepts from chain. */
export const decodeMemo = (ixData: string): MemoPayload | null => {
  try {
    const json = Buffer.from(bs58.decode(ixData)).toString("utf8");
    const m = JSON.parse(json) as Partial<MemoPayload>;
    if (
      m.app === "clockin" &&
      m.d &&
      typeof m.x === "number" &&
      typeof m.y === "number"
    ) {
      return {
        app: "clockin",
        x: m.x,
        y: m.y,
        c: m.c ?? "#ff9f1c",
        d: m.d,
      };
    }
    return null;
  } catch {
    // not a clockin memo — ignore
    return null;
  }
};

/* One pixel per day: sort oldest → newest so later days (and later txs on
 * the same day — higher seq, regardless of input order) overwrite earlier
 * ones, then keep the last per day. */
export const collapseByDay = (found: Pixel[]): Pixel[] => {
  const sorted = [...found].sort((a, b) => {
    if (a.day! !== b.day!) return a.day! < b.day! ? -1 : 1;
    return (a.seq ?? 0) - (b.seq ?? 0);
  });
  const byDay = new Map<string, Pixel>();
  for (const p of sorted) byDay.set(p.day!, p);
  return [...byDay.values()];
};

/* Streak = consecutive days ending today (grace: yesterday, for timezone
 * rollover while the user is checking in). */
export const streakFromDays = (days: Set<string>, now = new Date()): number => {
  let streak = 0;
  const cursor = new Date(now);
  if (!days.has(cursor.toISOString().slice(0, 10)))
    cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    const d = cursor.toISOString().slice(0, 10);
    if (!days.has(d)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};

export const today = (now = new Date()) => now.toISOString().slice(0, 10);
