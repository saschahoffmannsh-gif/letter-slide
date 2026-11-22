/*
 * Wortgarten – SPIELSTAND & STATISTIK (localStorage)
 * ==================================================
 * Reine Funktionen ohne DOM:
 *   progress  – Level-Fortschritt: höchstes freigeschaltetes Level + beste Punkte je Level
 *               (Gesamtpunktzahl = Summe der besten Level-Punkte)
 *   daily     – Ergebnis des Tagesrätsels pro Datum
 *   tips      – bereits gezeigte Tutorial-Hinweise
 *   prefs     – Einstellungen (Vorschau an/aus)
 * `storage` ist ein localStorage-ähnliches Objekt ({ getItem, setItem }) oder null
 * (z. B. privates Surfen / Node) – dann wird nur im Speicher gearbeitet.
 *
 * Browser: legt `LetterSlideStats` global ab. Node: require("./src/stats.js").
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "wortgartenStats.v1";
  /** So viele Tagesergebnisse bleiben gespeichert (ältere werden entfernt). */
  const KEEP_DAYS = 60;

  function emptyStats() {
    return { daily: {}, endlessBest: 0, progress: { unlocked: 1, best: {} }, tips: {}, prefs: { preview: true }, tutorial: { done: {}, skipped: false } };
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
      const p = data && data.progress;
      if (p && Number.isInteger(p.unlocked) && p.unlocked >= 1) stats.progress.unlocked = p.unlocked;
      if (p && p.best && typeof p.best === "object") {
        for (const [id, pts] of Object.entries(p.best)) if (/^\d+$/.test(id) && Number.isFinite(pts) && pts >= 0) stats.progress.best[id] = pts;
      }
      if (data && data.tips && typeof data.tips === "object") for (const k of Object.keys(data.tips)) stats.tips[k] = true;
      if (data && data.prefs && typeof data.prefs.preview === "boolean") stats.prefs.preview = data.prefs.preview;
      const tu = data && data.tutorial;
      if (tu && tu.done && typeof tu.done === "object") for (const id of Object.keys(tu.done)) if (/^\d+$/.test(id) && tu.done[id]) stats.tutorial.done[id] = true;
      if (tu && tu.skipped === true) stats.tutorial.skipped = true;
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

  /**
   * Gelöstes Level eintragen: beste Punkte behalten, nächstes Level freischalten.
   * @returns { stats, isNewBest }
   */
  function recordLevel(stats, id, points) {
    const prev = stats.progress.best[id];
    const isNewBest = prev === undefined || points > prev;
    if (isNewBest) stats.progress.best[id] = points;
    stats.progress.unlocked = Math.max(stats.progress.unlocked, id + 1);
    return { stats, isNewBest };
  }

  /** Gesamtpunkte = Summe der besten Level-Punkte (optional ohne ein Level). */
  function totalScore(stats, excludeId = null) {
    return Object.entries(stats.progress.best).reduce((sum, [id, pts]) => (Number(id) === excludeId ? sum : sum + pts), 0);
  }

  /** Anzahl gelöster Level. */
  function solvedCount(stats) { return Object.keys(stats.progress.best).length; }

  /** Ergebnis für ein Datum oder null. */
  function dailyResult(stats, dateKey) {
    return stats.daily[dateKey] || null;
  }

  const api = {
    STORAGE_KEY, KEEP_DAYS, emptyStats, loadStats, saveStats, pruneDaily, recordDaily, recordEndless, dailyResult,
    recordLevel, totalScore, solvedCount
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LetterSlideStats = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
