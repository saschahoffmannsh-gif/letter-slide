/*
 * Letter Slide – SPIELLOGIK
 * =========================
 * Reine Logik ohne DOM-Zugriff: PRNG, Brett-Operationen, Wortsuche, Kaskaden,
 * Punkte, Modi-Start, Undo/Reset, Teilen-Text.
 *
 * Browser: nach config.js laden, legt `LetterSlideLogic` global ab.
 * Node:    `const L = require("./src/logic.js")` (lädt config.js selbst).
 */
(function (root) {
  "use strict";

  const CONFIG = (typeof module !== "undefined" && module.exports)
    ? require("./config.js")
    : root.LetterSlideConfig;
  if (!CONFIG) throw new Error("config.js muss vor logic.js geladen werden.");

  const {
    GRID_SIZE, MIN_WORD_LENGTH, WORD_LIST_RAW, LETTER_WEIGHTS, USE_UNIFORM_LETTERS,
    SCORE_BY_LENGTH, COMBO_STEP, HISTORY_LIMIT, MAX_CASCADE_LEVELS, MAX_BOARD_ATTEMPTS,
    DAILY_EPOCH, MODES
  } = CONFIG;

  /* ---------------------------------------------------------------------
   * WÖRTERBUCH
   * ------------------------------------------------------------------- */

  /** Template-String -> bereinigtes, dedupliziertes Array aus Großbuchstaben-Wörtern. */
  function parseWordList(raw) {
    const seen = new Set();
    const out = [];
    for (const line of raw.split("\n")) {
      if (line.trim().startsWith("//")) continue;
      for (const token of line.trim().split(/\s+/)) {
        const w = token.toUpperCase();
        if (w.length >= MIN_WORD_LENGTH && w.length <= GRID_SIZE && /^[A-Z]+$/.test(w) && !seen.has(w)) {
          seen.add(w);
          out.push(w);
        }
      }
    }
    return out;
  }

  /** Bereinigte Wortliste (Array) und Wörterbuch als Set für O(1)-Lookup. */
  const WORD_LIST = parseWordList(WORD_LIST_RAW);
  const DICTIONARY = new Set(WORD_LIST);

  /* ---------------------------------------------------------------------
   * PUNKTE
   * ------------------------------------------------------------------- */

  /** Punkte für ein einzelnes Wort ohne Multiplikator. */
  function baseWordScore(length) {
    if (length < MIN_WORD_LENGTH) return 0;
    return SCORE_BY_LENGTH[Math.min(length, 6)];
  }

  /** Multiplikator einer Kaskadenstufe (Stufe 1 = x1). */
  function comboMultiplier(level) {
    return 1 + COMBO_STEP * (level - 1);
  }

  /* ---------------------------------------------------------------------
   * PRNG – Mulberry32. Der Zustand ist eine einzige uint32-Zahl, damit er
   * für Undo trivial gespeichert/wiederhergestellt werden kann.
   * ------------------------------------------------------------------- */

  function createRng(seed) {
    return { state: seed >>> 0 };
  }

  /** Liefert eine Zahl in [0, 1) und schreitet den Zustand fort. */
  function rngNext(rng) {
    rng.state = (rng.state + 0x6D2B79F5) >>> 0;
    let t = rng.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** FNV-1a 32-Bit-Hash, z. B. für das Datum "YYYY-MM-DD" -> Seed. */
  function hashString(str) {
    let h = 0x811C9DC5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Zufälliger Seed für den Endlos-Modus (nicht deterministisch). */
  function randomSeed() {
    return ((Math.random() * 4294967296) ^ Date.now()) >>> 0;
  }

  /** Lokales Datum -> "YYYY-MM-DD". */
  function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  /** Rätselnummer: Tage seit DAILY_EPOCH + 1 (2026-01-01 = #1). */
  function dailyPuzzleNumber(dateKey) {
    const toUtc = (key) => { const [y, m, d] = key.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((toUtc(dateKey) - toUtc(DAILY_EPOCH)) / 86400000) + 1;
  }

  /* Kumulierte Gewichtstabelle einmalig vorberechnen. */
  const LETTER_TABLE = (() => {
    const letters = Object.keys(LETTER_WEIGHTS);
    let total = 0;
    const cumulative = letters.map((l) => (total += USE_UNIFORM_LETTERS ? 1 : LETTER_WEIGHTS[l]));
    return { letters, cumulative, total };
  })();

  /** Zieht einen Buchstaben gewichtet mit dem übergebenen (geseedeten) PRNG. */
  function drawLetter(rng) {
    const x = rngNext(rng) * LETTER_TABLE.total;
    const { letters, cumulative } = LETTER_TABLE;
    for (let i = 0; i < letters.length; i++) if (x < cumulative[i]) return letters[i];
    return letters[letters.length - 1];
  }

  /* ---------------------------------------------------------------------
   * BRETT – flaches Array der Länge GRID_SIZE², Index = Zeile * GRID_SIZE + Spalte.
   * Leere Zelle = null (nur kurzzeitig während Löschen/Gravitation).
   * ------------------------------------------------------------------- */

  const idx = (r, c) => r * GRID_SIZE + c;

  /** Alle 12 Linien (6 Zeilen, 6 Spalten) mit ihren Zellindizes. */
  const LINES = (() => {
    const lines = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      lines.push({ axis: "row", index: r, cells: Array.from({ length: GRID_SIZE }, (_, c) => idx(r, c)) });
    }
    for (let c = 0; c < GRID_SIZE; c++) {
      lines.push({ axis: "col", index: c, cells: Array.from({ length: GRID_SIZE }, (_, r) => idx(r, c)) });
    }
    return lines;
  })();

  /**
   * slideLine – verschiebt eine Zeile oder Spalte zyklisch um genau ein Feld.
   * @param grid  flaches Array
   * @param axis  "row" | "col"
   * @param index Zeilen- bzw. Spaltennummer (0..5)
   * @param dir   +1 = rechts/runter, -1 = links/hoch
   * @returns neues Array (das Original bleibt unverändert)
   */
  function slideLine(grid, axis, index, dir) {
    const next = grid.slice();
    const n = GRID_SIZE;
    for (let k = 0; k < n; k++) {
      const src = ((k - dir) % n + n) % n; // Feld, das an Position k landet
      if (axis === "row") next[idx(index, k)] = grid[idx(index, src)];
      else next[idx(k, index)] = grid[idx(src, index)];
    }
    return next;
  }

  /**
   * findWords – sucht in allen Zeilen und Spalten zusammenhängende Folgen
   * (Länge >= 3), die im Wörterbuch stehen.
   * Treffer, die vollständig in einem längeren Treffer derselben Linie liegen,
   * werden verworfen (HAUS zählt nicht zusätzlich AUS). Überlappende, aber
   * nicht enthaltene Treffer sowie Kreuzungen Zeile/Spalte bleiben alle erhalten.
   * @returns Array von { word, cells, axis, line, start, length }
   */
  function findWords(grid, dict = DICTIONARY) {
    const matches = [];
    for (const line of LINES) {
      const letters = line.cells.map((i) => grid[i]);
      const found = [];
      for (let start = 0; start < GRID_SIZE; start++) {
        let word = "";
        for (let end = start; end < GRID_SIZE; end++) {
          if (letters[end] == null) break; // leere Zelle unterbricht
          word += letters[end];
          if (word.length >= MIN_WORD_LENGTH && dict.has(word)) found.push({ start, length: word.length, word });
        }
      }
      for (const m of found) {
        const contained = found.some((o) => o !== m && o.length > m.length &&
          o.start <= m.start && o.start + o.length >= m.start + m.length);
        if (contained) continue;
        matches.push({
          word: m.word, axis: line.axis, line: line.index, start: m.start, length: m.length,
          cells: line.cells.slice(m.start, m.start + m.length)
        });
      }
    }
    return matches;
  }

  /** checkBoard – prüft das Brett mit dem aktiven Wörterbuch (Wrapper um findWords). */
  function checkBoard(grid) {
    return findWords(grid, DICTIONARY);
  }

  /**
   * clearWords – markiert alle Zellen aller Treffer gleichzeitig und leert sie.
   * @returns { grid, cleared } – cleared = sortierte Liste der geleerten Indizes
   */
  function clearWords(grid, matches) {
    const marked = new Set();
    for (const m of matches) for (const i of m.cells) marked.add(i);
    const next = grid.slice();
    for (const i of marked) next[i] = null;
    return { grid: next, cleared: [...marked].sort((a, b) => a - b) };
  }

  /**
   * applyGravity – Buchstaben fallen in ihrer Spalte nach unten in Lücken.
   * @returns { grid, fromRow } – fromRow[i] = Ursprungszeile des Buchstabens,
   *          der jetzt in Zelle i steht (null = Zelle leer). Für die Fall-Animation.
   */
  function applyGravity(grid) {
    const next = new Array(grid.length).fill(null);
    const fromRow = new Array(grid.length).fill(null);
    for (let c = 0; c < GRID_SIZE; c++) {
      let write = GRID_SIZE - 1;
      for (let r = GRID_SIZE - 1; r >= 0; r--) {
        const v = grid[idx(r, c)];
        if (v != null) {
          next[idx(write, c)] = v;
          fromRow[idx(write, c)] = r;
          write--;
        }
      }
    }
    return { grid: next, fromRow };
  }

  /**
   * refill – füllt leere Zellen (nach der Gravitation immer oben) mit neuen
   * Buchstaben aus dem geseedeten PRNG. Reihenfolge deterministisch:
   * Spalte 0..5, je Spalte von oben nach unten.
   * @param fromRow optional; wird für neue Kacheln mit negativen Zeilen (oberhalb
   *                des Bretts) ergänzt, damit sie „von oben hereinfallen“.
   * @returns { grid, fromRow, added } – added = Indizes der neuen Kacheln
   */
  function refill(grid, rng, fromRow = null) {
    const next = grid.slice();
    const rows = fromRow ? fromRow.slice() : new Array(grid.length).fill(null);
    const added = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      let empty = 0;
      for (let r = 0; r < GRID_SIZE; r++) if (next[idx(r, c)] == null) empty++;
      for (let r = 0; r < GRID_SIZE; r++) {
        const i = idx(r, c);
        if (next[i] == null) {
          next[i] = drawLetter(rng);
          rows[i] = r - empty;
          added.push(i);
        }
      }
    }
    return { grid: next, fromRow: rows, added };
  }

  /**
   * cascade – prüft, löscht, lässt fallen, füllt nach und wiederholt, bis keine
   * Wörter mehr gefunden werden. Jede weitere Runde erhöht die Kaskadenstufe.
   * Verändert state (grid, score, combo, maxCombo, wordsFound, rng).
   * @returns Array von Schritten für die Animation:
   *   { level, multiplier, matches, points, cleared, gridBefore, gridCleared,
   *     gridAfter, fromRow, scoreAfter }
   */
  function cascade(state) {
    const steps = [];
    let level = 0;
    let matches = checkBoard(state.grid);
    while (matches.length > 0 && level < MAX_CASCADE_LEVELS) {
      level++;
      const multiplier = comboMultiplier(level);
      const base = matches.reduce((sum, m) => sum + baseWordScore(m.length), 0);
      const points = Math.round(base * multiplier);
      state.score += points;
      state.wordsFound += matches.length;

      const gridBefore = state.grid;
      const cleared = clearWords(gridBefore, matches);
      const fallen = applyGravity(cleared.grid);
      const filled = refill(fallen.grid, state.rng, fallen.fromRow);
      state.grid = filled.grid;

      steps.push({
        level, multiplier, matches, points, cleared: cleared.cleared,
        gridBefore, gridCleared: cleared.grid, gridAfter: filled.grid,
        fromRow: filled.fromRow, scoreAfter: state.score
      });
      matches = checkBoard(state.grid);
    }
    state.combo = level;
    state.maxCombo = Math.max(state.maxCombo, level);
    return steps;
  }

  /* ---------------------------------------------------------------------
   * MODI STARTEN (Definitionen siehe MODES in config.js)
   * ------------------------------------------------------------------- */

  /** Hilfsfunktionen, die Modi für ihren Seed nutzen dürfen. */
  const SEED_HELPERS = { hashString, randomSeed };

  /** Erzeugt deterministisch ein Startbrett ohne Wörter (würfelt mit demselben PRNG-Strom neu). */
  function generateStartBoard(rng) {
    let grid;
    for (let attempt = 0; attempt < MAX_BOARD_ATTEMPTS; attempt++) {
      grid = Array.from({ length: GRID_SIZE * GRID_SIZE }, () => drawLetter(rng));
      if (checkBoard(grid).length === 0) return grid;
    }
    return grid; // praktisch unerreichbar; Brett ist dann evtl. nicht wortfrei
  }

  /** Setzt Brett und Zähler eines States auf den Anfang seines Seeds zurück. */
  function initBoard(state) {
    state.rng = createRng(state.seed);
    state.grid = generateStartBoard(state.rng);
    state.score = 0;
    state.moves = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.wordsFound = 0;
    state.ended = false;
    state.history = [];
    return state;
  }

  /** Startet einen beliebigen Modus aus MODES. ctx: { date?, seed? } */
  function startMode(modeId, ctx = {}) {
    const mode = MODES[modeId];
    if (!mode) throw new Error(`Unbekannter Modus: ${modeId}`);
    const date = ctx.date || new Date();
    const dateKey = formatDateKey(date);
    const state = {
      modeId, dateKey,
      puzzleNumber: dailyPuzzleNumber(dateKey),
      seed: mode.seed({ ...ctx, date, dateKey }, SEED_HELPERS) >>> 0
    };
    return initBoard(state);
  }

  /** startDaily – Tagesrätsel für das (lokale) Datum, Standard: heute. */
  function startDaily(date = new Date()) {
    return startMode("daily", { date });
  }

  /** startEndless – Endlos-Modus mit Zufalls-Seed (optional fester Seed). */
  function startEndless(seed) {
    return startMode("endless", { seed });
  }

  /* ---------------------------------------------------------------------
   * ZÜGE, UNDO, RESET, TEILEN
   * ------------------------------------------------------------------- */

  /** Kompletter Snapshot inkl. PRNG-Zustand. */
  function takeSnapshot(state) {
    return {
      grid: state.grid.slice(), score: state.score, moves: state.moves,
      combo: state.combo, maxCombo: state.maxCombo, wordsFound: state.wordsFound,
      rngState: state.rng.state
    };
  }

  function restoreSnapshot(state, snap) {
    state.grid = snap.grid.slice();
    state.score = snap.score;
    state.moves = snap.moves;
    state.combo = snap.combo;
    state.maxCombo = snap.maxCombo;
    state.wordsFound = snap.wordsFound;
    state.rng.state = snap.rngState;
  }

  /**
   * performSlide – EIN Zug: Snapshot sichern, Linie verschieben, Kaskade auflösen.
   * @returns { gridBefore, gridAfterSlide, steps } oder null (Runde beendet)
   */
  function performSlide(state, axis, index, dir) {
    if (state.ended) return null;
    state.history.push(takeSnapshot(state));
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    const gridBefore = state.grid;
    state.grid = slideLine(gridBefore, axis, index, dir);
    state.moves++;
    const gridAfterSlide = state.grid;
    const steps = cascade(state);
    return { gridBefore, gridAfterSlide, steps };
  }

  /** undo – stellt den Zustand vor dem letzten Zug exakt wieder her. */
  function undo(state) {
    if (state.ended || state.history.length === 0) return false;
    restoreSnapshot(state, state.history.pop());
    return true;
  }

  /** reset – aktuelles Level auf Anfangszustand (gleicher Seed, gleiches Brett). */
  function reset(state) {
    return initBoard(state);
  }

  /** Runde beenden: Score wird festgehalten, keine weiteren Züge. */
  function endRound(state) {
    state.ended = true;
    return buildShareText(state);
  }

  /** Teilbarer Text ohne Brett-Spoiler. 🔥-Anzahl = höchste erreichte Kaskadenstufe. */
  function buildShareText(state) {
    const mode = MODES[state.modeId];
    const parts = [
      `Letter Slide ${mode.shareTag(state)}`,
      `${state.moves} ${state.moves === 1 ? "Zug" : "Züge"}`,
      `${state.score} Punkte`
    ];
    if (state.maxCombo > 0) parts.push("🔥".repeat(state.maxCombo));
    return parts.join(" · ");
  }

  const api = {
    CONFIG, GRID_SIZE, MODES, HISTORY_LIMIT, WORD_LIST, DICTIONARY,
    parseWordList, baseWordScore, comboMultiplier, createRng, rngNext, hashString, randomSeed,
    formatDateKey, dailyPuzzleNumber, drawLetter, idx, slideLine, findWords, checkBoard,
    clearWords, applyGravity, refill, cascade, generateStartBoard, startMode, startDaily,
    startEndless, takeSnapshot, restoreSnapshot, performSlide, undo, reset, endRound, buildShareText
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LetterSlideLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
