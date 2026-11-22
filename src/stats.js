/*
 * Letter Slide – STATISTIK (localStorage)
 * =======================================
 * Reine Funktionen ohne DOM: Ergebnis des Tagesrätsels pro Datum und Endlos-Rekord.
 * `storage` ist ein localStorage-ähnliches Objekt ({ getItem, setItem }) oder null
 * (z. B. privates Surfen / Node) – dann wird nur im Speicher gearbeitet.
 *
 * Browser: legt `LetterSlideStats` global ab. Node: require("./src/stats.js").
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "letterSlideStats.v1";
  /** So viele Tagesergebnisse bleiben gespeichert (ältere werden entfernt). */
  const KEEP_DAYS = 60;

  function emptyStats() {
    return { daily: {}, endlessBest: 0 };
  }

  /** Stats laden; kaputte/fehlende Daten ergeben leere Stats statt eines Fehlers. */
  function loadStats(storage) {
    try {
      const raw = storage && storage.getItem(STORAGE_KEY);
      if (!raw) return emptyStats();
      const data = JSON.parse(raw);
      const stats = emptyStats();
      if (data && typeof data.daily === "object" && data.daily) {
        for (const [key, r] of Object.entries(data.daily)) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(key) && r && Number.isFinite(r.score)) stats.daily[key] = r;
        }
      }
      if (data && Number.isFinite(data.endlessBest)) stats.endlessBest = Math.max(0, data.endlessBest);
      return stats;
    } catch (_) {
      return emptyStats();
    }
  }

  /** Stats speichern; Fehler (Quota, Privatmodus) werden geschluckt. Liefert true bei Erfolg. */
  function saveStats(storage, stats) {
    try {
      if (!storage) return false;
      storage.setItem(STORAGE_KEY, JSON.stringify(stats));
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Nur die neuesten KEEP_DAYS Tagesergebnisse behalten. */
  function pruneDaily(stats, keep = KEEP_DAYS) {
    const keys = Object.keys(stats.daily).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - keep))) delete stats.daily[k];
    return stats;
  }

  /**
   * Beendetes Tagesrätsel eintragen. Bei mehreren Versuchen am selben Tag zählt das
   * beste Ergebnis. Liefert { stats, isNewBest }.
   * @param result { dateKey, puzzleNumber, score, moves, maxCombo, shareText }
   */
  function recordDaily(stats, result) {
    const prev = stats.daily[result.dateKey];
    const isNewBest = !prev || result.score > prev.score;
    if (isNewBest) {
      stats.daily[result.dateKey] = {
        puzzleNumber: result.puzzleNumber, score: result.score, moves: result.moves,
        maxCombo: result.maxCombo, shareText: result.shareText
      };
      pruneDaily(stats);
    }
    return { stats, isNewBest };
  }

  /** Endlos-Score eintragen (Rekord = Maximum). Liefert { stats, isNewBest }. */
  function recordEndless(stats, score) {
    const isNewBest = score > stats.endlessBest;
    if (isNewBest) stats.endlessBest = score;
    return { stats, isNewBest };
  }

  /** Ergebnis für ein Datum oder null. */
  function dailyResult(stats, dateKey) {
    return stats.daily[dateKey] || null;
  }

  const api = { STORAGE_KEY, KEEP_DAYS, emptyStats, loadStats, saveStats, pruneDaily, recordDaily, recordEndless, dailyResult };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LetterSlideStats = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
