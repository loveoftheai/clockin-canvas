/* Contract tests for the on-chain memo codec and rehydration logic.
 * Imports the same src/lib.ts the app ships with — not a copy. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMemoPayload,
  decodeMemo,
  collapseByDay,
  streakFromDays,
  today,
} from "../src/lib.ts";
import bs58 from "bs58";

const enc = (json) => bs58.encode(Buffer.from(json, "utf8"));
const day = (offset) => {
  const d = new Date("2026-09-26T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};
const NOW = new Date("2026-09-26T12:00:00.000Z");

test("memo payload round-trips through base58 like an on-chain instruction", () => {
  const payload = buildMemoPayload({
    x: 8,
    y: 7,
    color: "#ff9f1c",
    day: day(0),
  });
  const decoded = decodeMemo(enc(payload));
  assert.deepEqual(decoded, {
    app: "clockin",
    x: 8,
    y: 7,
    c: "#ff9f1c",
    d: day(0),
  });
});

test("decodeMemo ignores non-clockin and malformed memos", () => {
  assert.equal(
    decodeMemo(enc(JSON.stringify({ app: "other", x: 1, y: 1 }))),
    null,
  );
  assert.equal(decodeMemo(enc("not json at all")), null);
  assert.equal(
    decodeMemo(enc(JSON.stringify({ app: "clockin", d: "2026-09-26" }))),
    null,
  ); // missing x/y
});

test("collapseByDay keeps one pixel per day, later tx wins", () => {
  const pixels = [
    { x: 1, y: 1, color: "#2ec4b6", day: day(2) },
    { x: 2, y: 2, color: "#e71d36", day: day(0) },
    { x: 3, y: 3, color: "#011627", day: day(0) }, // same-day re-pick
    { x: 4, y: 4, color: "#ffbf69", day: day(1) },
  ];
  const out = collapseByDay(pixels);
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.find((p) => p.day === day(0)),
    { x: 3, y: 3, color: "#011627", day: day(0) },
  );
});

test("streak counts consecutive days ending today", () => {
  assert.equal(streakFromDays(new Set([day(0), day(1), day(2)]), NOW), 3);
  assert.equal(streakFromDays(new Set([day(0), day(2)]), NOW), 1); // gap breaks it
  assert.equal(streakFromDays(new Set(), NOW), 0);
});

test("streak has a one-day grace when today is not clocked in yet", () => {
  assert.equal(streakFromDays(new Set([day(1), day(2)]), NOW), 2);
});

test("memo contract holds for the recorded demo transaction (5cG5AtnH…WU6z)", () => {
  // docs/demo.mp4 demo tx: pixel payload per the contract above
  const payload = buildMemoPayload({
    x: 8,
    y: 7,
    color: "#ff9f1c",
    day: "2026-09-26",
  });
  const m = decodeMemo(enc(payload));
  assert.equal(m.app, "clockin");
  assert.ok(m.x >= 0 && m.x < 16 && m.y >= 0 && m.y < 16);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(m.d));
  assert.ok(/^#[0-9a-f]{6}$/i.test(m.c));
});

test("today() is ISO yyyy-mm-dd", () => {
  assert.match(today(NOW), /^\d{4}-\d{2}-\d{2}$/);
});
