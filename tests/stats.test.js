// Tests für src/stats.js (localStorage-Statistik) – keine Abhängigkeiten.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/stats.js");
const L = require("../src/logic.js");

/** Minimaler localStorage-Ersatz. */
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}
const result = (dateKey, score, extra = {}) => ({ dateKey, puzzleNumber: L.dailyPuzzleNumber(dateKey), score, moves: 5, maxCombo: 2, shareText: `Letter Slide · ${score} Punkte`, ...extra });

test("leere/kaputte/fehlende Daten -> leere Stats", () => {
  assert.deepEqual(S.loadStats(null), S.emptyStats());
  assert.deepEqual(S.loadStats(memoryStorage()), S.emptyStats());
  assert.deepEqual(S.loadStats(memoryStorage({ [S.STORAGE_KEY]: "{kaputt" })), S.emptyStats());
  const throwing = { getItem() { throw new Error("SecurityError"); } };
  assert.deepEqual(S.loadStats(throwing), S.emptyStats());
});

test("speichern und wieder laden (Roundtrip)", () => {
  const st = memoryStorage();
  const stats = S.emptyStats();
  S.recordDaily(stats, result("2026-11-22", 62));
  S.recordEndless(stats, 340);
  assert.equal(S.saveStats(st, stats), true);
  const back = S.loadStats(st);
  assert.equal(back.endlessBest, 340);
  assert.equal(S.dailyResult(back, "2026-11-22").score, 62);
  assert.equal(S.dailyResult(back, "2026-11-22").puzzleNumber, 326);
  assert.equal(S.dailyResult(back, "2026-11-21"), null);
});

test("Tagesrätsel: bestes Ergebnis pro Tag zählt", () => {
  const stats = S.emptyStats();
  assert.equal(S.recordDaily(stats, result("2026-11-22", 50)).isNewBest, true);
  assert.equal(S.recordDaily(stats, result("2026-11-22", 30)).isNewBest, false);
  assert.equal(stats.daily["2026-11-22"].score, 50);
  assert.equal(S.recordDaily(stats, result("2026-11-22", 80)).isNewBest, true);
  assert.equal(stats.daily["2026-11-22"].score, 80);
});

test("Endlos-Rekord ist das Maximum", () => {
  const stats = S.emptyStats();
  assert.equal(S.recordEndless(stats, 100).isNewBest, true);
  assert.equal(S.recordEndless(stats, 40).isNewBest, false);
  assert.equal(S.recordEndless(stats, 0).isNewBest, false);
  assert.equal(stats.endlessBest, 100);
});

test("alte Tagesergebnisse werden ausgedünnt", () => {
  const stats = S.emptyStats();
  for (let d = 1; d <= 70; d++) {
    const date = new Date(2026, 0, d);
    S.recordDaily(stats, result(L.formatDateKey(date), d));
  }
  assert.equal(Object.keys(stats.daily).length, S.KEEP_DAYS);
  assert.ok(!("2026-01-01" in stats.daily));
  assert.ok("2026-03-11" in stats.daily);
});

test("ungültige Einträge werden beim Laden verworfen", () => {
  const raw = JSON.stringify({ daily: { "2026-11-22": { score: 10 }, "kaputt": { score: 5 }, "2026-11-23": { score: "x" } }, endlessBest: -5 });
  const stats = S.loadStats(memoryStorage({ [S.STORAGE_KEY]: raw }));
  assert.deepEqual(Object.keys(stats.daily), ["2026-11-22"]);
  assert.equal(stats.endlessBest, 0);
});

test("Speicherfehler (Quota) wird abgefangen", () => {
  const full = { getItem: () => null, setItem() { throw new Error("QuotaExceededError"); } };
  assert.equal(S.saveStats(full, S.emptyStats()), false);
  assert.equal(S.saveStats(null, S.emptyStats()), false);
});

test("Level-Fortschritt: Bestwert je Level, Freischalten, Gesamtpunkte", () => {
  const st = memoryStorage();
  const stats = S.emptyStats();
  assert.equal(stats.progress.unlocked, 1);
  assert.equal(S.recordLevel(stats, 1, 60).isNewBest, true);
  assert.equal(S.recordLevel(stats, 1, 40).isNewBest, false);
  S.recordLevel(stats, 2, 40);
  assert.equal(stats.progress.unlocked, 3);
  assert.equal(S.totalScore(stats), 100);
  assert.equal(S.totalScore(stats, 2), 60);
  assert.equal(S.solvedCount(stats), 2);
  stats.tips.first_stein = true;
  stats.prefs.preview = false;
  S.saveStats(st, stats);
  const back = S.loadStats(st);
  assert.deepEqual(back.progress, { unlocked: 3, best: { 1: 60, 2: 40 } });
  assert.equal(back.tips.first_stein, true);
  assert.equal(back.prefs.preview, false);
});
