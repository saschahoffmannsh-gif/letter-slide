/*
 * Wortgarten – SPIELLOGIK
 * =======================
 * Reine Logik ohne DOM-Zugriff: PRNG, Brett-Operationen, Wortsuche, Zielwort-Prüfung,
 * Schutz benötigter Zielbuchstaben, Kaskaden, Punkte, Hinweise, Level laden, Undo/Reset,
 * Teilen-Text.
 *
 * DATENMODELL (Zustand `state`)
 *   grid[36]     Buchstaben, Index = Zeile * 6 + Spalte (null nur kurz während Löschen/Fallen)
 *   Zielbuchstaben (neededCells): pro Zielwort-Buchstabe so viele Kacheln, wie das Wort braucht
 *                  (Doppelbuchstaben wie E in KAFFEE: höchstens die benötigte Anzahl), plus alle
 *                  Felder der besten Teilfolge (bestPartialRun). Sie zerbröseln nie. Bei der
 *                  Gravitation bleiben sie stehen (Nachfüll-Buchstaben füllen um sie herum);
 *                  Schieben bewegt sie ganz normal mit der Zeile/Spalte.
 *
 * Browser: nach config.js und levels.js laden, legt `LetterSlideLogic` global ab
 *          (interne Namen „LetterSlide…“ bleiben aus Kompatibilität bestehen).
 * Node:    `const L = require("./src/logic.js")` (lädt config.js und levels.js selbst).
 */
(function (root) {
  "use strict";

  const IS_NODE = typeof module !== "undefined" && module.exports;
  const CONFIG = IS_NODE ? require("./config.js") : root.LetterSlideConfig;
  const LEVELS = IS_NODE ? require("./levels.js") : root.LetterSlideLevels;
  if (!CONFIG) throw new Error("config.js muss vor logic.js geladen werden.");
  if (!LEVELS) throw new Error("levels.js muss vor logic.js geladen werden.");

  const {
    GRID_SIZE, MIN_WORD_LENGTH, WORD_LIST_RAW, LETTER_WEIGHTS, USE_UNIFORM_LETTERS,
    SHORT_MIN, SHORT_MAX, PROTECT_MIN, POINTS_PER_LETTER, COMBO_STEP, HINTS_PER_LEVEL, HINT_PENALTY,
    HISTORY_LIMIT, MAX_CASCADE_LEVELS, MAX_BOARD_ATTEMPTS, DAILY_EPOCH, MODES
  } = CONFIG;
  const N = GRID_SIZE;

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

  const WORD_LIST = parseWordList(WORD_LIST_RAW);
  const DICTIONARY = new Set(WORD_LIST);

  /* ---------------------------------------------------------------------
   * PRNG – Mulberry32 (Zustand = eine uint32-Zahl -> trivial für Undo)
   * ------------------------------------------------------------------- */

  function createRng(seed) { return { state: seed >>> 0 }; }

  function rngNext(rng) {
    rng.state = (rng.state + 0x6D2B79F5) >>> 0;
    let t = rng.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** FNV-1a 32-Bit-Hash (Datum, Level-Id -> Seed). */
  function hashString(str) {
    let h = 0x811C9DC5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  function randomSeed() { return ((Math.random() * 4294967296) ^ Date.now()) >>> 0; }

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

  const LETTER_TABLE = (() => {
    const letters = Object.keys(LETTER_WEIGHTS);
    let total = 0;
    const cumulative = letters.map((l) => (total += USE_UNIFORM_LETTERS ? 1 : LETTER_WEIGHTS[l]));
    return { letters, cumulative, total };
  })();

  /** Buchstaben gewichtet mit dem (geseedeten) PRNG ziehen. */
  function drawLetter(rng) {
    const x = rngNext(rng) * LETTER_TABLE.total;
    const { letters, cumulative } = LETTER_TABLE;
    for (let i = 0; i < letters.length; i++) if (x < cumulative[i]) return letters[i];
    return letters[letters.length - 1];
  }

  /* ---------------------------------------------------------------------
   * BRETT-GEOMETRIE
   * ------------------------------------------------------------------- */

  const idx = (r, c) => r * N + c;
  const rowOf = (i) => Math.floor(i / N);
  const colOf = (i) => i % N;
  const GEO = { idx, rowOf, colOf, size: N };

  /** Alle 12 Linien (6 Zeilen, 6 Spalten) mit ihren Zellindizes. */
  const LINES = (() => {
    const lines = [];
    for (let r = 0; r < N; r++) lines.push({ axis: "row", index: r, cells: Array.from({ length: N }, (_, c) => idx(r, c)) });
    for (let c = 0; c < N; c++) lines.push({ axis: "col", index: c, cells: Array.from({ length: N }, (_, r) => idx(r, c)) });
    return lines;
  })();
  const lineCells = (axis, index) => LINES[axis === "row" ? index : N + index].cells;

  /** Zellen einer Linie (alle 6; Geschützte Buchstaben werden beim Schieben ganz normal mitbewegt). */
  function movableCells(axis, index) { return lineCells(axis, index).slice(); }

  /** Kann diese Linie geschoben werden? (Immer, solange das Level läuft – prüft der Aufrufer.) */
  function canSlide(/* state, axis, index */) { return true; }

  /**
   * slideLine – verschiebt eine Zeile/Spalte zyklisch um ein Feld.
   * @param dir +1 = rechts/runter, -1 = links/hoch
   * @returns neues Array (Original unverändert)
   */
  function slideLine(grid, axis, index, dir) {
    const next = grid.slice();
    const cells = lineCells(axis, index);
    const n = cells.length;
    for (let k = 0; k < n; k++) next[cells[k]] = grid[cells[((k - dir) % n + n) % n]];
    return next;
  }

  /* ---------------------------------------------------------------------
   * WORTSUCHE
   * ------------------------------------------------------------------- */

  /**
   * findWords – alle Wörterbuch-Wörter (>= 3) in Zeilen/Spalten. Treffer, die vollständig in
   * einem längeren Treffer derselben Linie liegen, werden verworfen (HAUS zählt nicht AUS).
   * @returns Array von { word, cells, axis, line, start, length }
   */
  function findWords(grid, dict = DICTIONARY) {
    const matches = [];
    for (const line of LINES) {
      const letters = line.cells.map((i) => grid[i]);
      const found = [];
      for (let start = 0; start < N; start++) {
        let word = "";
        for (let end = start; end < N; end++) {
          if (letters[end] == null) break;
          word += letters[end];
          if (word.length >= MIN_WORD_LENGTH && dict.has(word)) found.push({ start, length: word.length, word });
        }
      }
      for (const m of found) {
        const contained = found.some((o) => o !== m && o.length > m.length && o.start <= m.start && o.start + o.length >= m.start + m.length);
        if (contained) continue;
        matches.push({ word: m.word, axis: line.axis, line: line.index, start: m.start, length: m.length, cells: line.cells.slice(m.start, m.start + m.length) });
      }
    }
    return matches;
  }

  /** checkBoard – alle Wörter im Brett (Wrapper, wie im Prototyp). */
  function checkBoard(grid) { return findWords(grid, DICTIONARY); }

  /**
   * bestPartialRun – der aktuelle Zielwort-Fortschritt: längste zusammenhängende Folge im Brett
   * (waagerecht links→rechts bzw. senkrecht oben→unten), die ein Stück des Zielworts in der
   * richtigen Reihenfolge bildet (Länge >= PROTECT_MIN). Gleichstand: Anfang des Zielworts
   * bevorzugt, dann erste Linie (Zeilen vor Spalten, oben/links zuerst) – also eindeutig.
   * @returns { cells, axis, line, start, from, length } oder null
   *   from = Position im Zielwort, an der die Folge beginnt (0 = Präfix)
   */
  function bestPartialRun(grid, target) {
    if (!target || target.length < PROTECT_MIN) return null;
    let best = null;
    for (const line of LINES) {
      for (let s = 0; s < N; s++) for (let o = 0; o < target.length; o++) {
        let k = 0;
        while (s + k < N && o + k < target.length && grid[line.cells[s + k]] === target[o + k]) k++;
        if (k < PROTECT_MIN) continue;
        if (!best || k > best.length || (k === best.length && o < best.from)) {
          best = { cells: line.cells.slice(s, s + k), axis: line.axis, line: line.index, start: s, from: o, length: k };
        }
      }
    }
    return best;
  }

  /**
   * neededCells – Kacheln, die zum Bilden des Zielworts gebraucht werden:
   *   1. alle Felder der besten Teilfolge (bestPartialRun, ab PROTECT_MIN),
   *   2. plus weitere Felder in Leserichtung (oben links zuerst), bis für jeden
   *      Zielwort-Buchstaben die benötigte Anzahl gedeckt ist. Doppelbuchstaben
   *      (z. B. E in KAFFEE, S in WASSER) werden nur so oft geschützt, wie das Wort
   *      sie braucht; überzählige gleiche Buchstaben dürfen zerbröseln.
   * Diese Felder zerbröseln nie und bleiben bei der Gravitation stehen.
   * Ohne Zielwort: leeres Set. Alias: protectedCells (gleiche Menge, für Anzeige/Tests).
   */
  function neededCells(grid, target) {
    if (!target) return new Set();
    const need = {};
    for (const ch of target) need[ch] = (need[ch] || 0) + 1;
    const out = new Set();
    const run = bestPartialRun(grid, target);
    if (run) {
      for (const i of run.cells) {
        const ch = grid[i];
        if (ch && need[ch] > 0) { out.add(i); need[ch]--; }
      }
    }
    for (let i = 0; i < N * N; i++) {
      const ch = grid[i];
      if (ch && need[ch] > 0 && !out.has(i)) { out.add(i); need[ch]--; }
    }
    return out;
  }
  const protectedCells = neededCells;

  /**
   * findShortWords – kurze Wörter (SHORT_MIN..SHORT_MAX), die zerbröseln. Ausgenommen ist nur
   * das Zielwort selbst. Wörter, die durch geschützte Felder laufen, bleiben in der Liste:
   * gelöscht werden später nur die nicht geschützten Buchstaben (siehe clearWords).
   */
  function findShortWords(grid, opts = {}) {
    const { target = null } = opts;
    return findWords(grid).filter((m) => m.length >= SHORT_MIN && m.length <= SHORT_MAX && m.word !== target);
  }

  /**
   * checkTargetWord – steht das Zielwort waagerecht oder senkrecht als zusammenhängende Folge
   * im Brett, und zwar NICHT als Teil eines längeren Wörterbuch-Worts in derselben Linie?
   * @returns { word, cells, axis, line, start, length } oder null
   */
  function checkTargetWord(grid, target, dict = DICTIONARY) {
    if (!target) return null;
    const L = target.length;
    for (const line of LINES) {
      const str = line.cells.map((i) => grid[i] ?? "#").join("");
      for (let s = str.indexOf(target); s !== -1; s = str.indexOf(target, s + 1)) {
        let longer = false;
        for (let a = 0; a <= s && !longer; a++) for (let b = s + L; b <= N; b++) {
          if (b - a > L && dict.has(str.slice(a, b))) { longer = true; break; }
        }
        if (!longer) return { word: target, axis: line.axis, line: line.index, start: s, length: L, cells: line.cells.slice(s, s + L) };
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------------
   * LÖSCHEN, GRAVITATION, NACHFÜLLEN
   * ------------------------------------------------------------------- */

  /**
   * clearWords – leert alle Zellen aller Treffer gleichzeitig, außer geschützten
   * (neededCells): ein kurzes Wort, das durch Zielbuchstaben läuft, zerbröselt nur
   * die übrigen Felder.
   * @returns { grid, cleared }
   */
  function clearWords(grid, matches, protect = null) {
    const marked = new Set();
    for (const m of matches) for (const i of m.cells) if (!protect || !protect.has(i)) marked.add(i);
    const next = grid.slice();
    for (const i of marked) next[i] = null;
    return { grid: next, cleared: [...marked].sort((a, b) => a - b) };
  }

  /**
   * applyGravity – Buchstaben fallen in ihrer Spalte nach unten in Lücken.
   * Verankerte Felder (neededCells) bleiben stehen; andere Buchstaben fallen an ihnen
   * vorbei, Nachfüllen füllt die Lücken um sie herum. Schieben ist davon unabhängig.
   * @param anchored  Set von Indizes, die nicht fallen (oder null)
   * @returns { grid, fromRow } – fromRow[i] = Ursprungszeile des Buchstabens in Zelle i
   */
  function applyGravity(grid, anchored = null) {
    const next = grid.slice();
    const fromRow = new Array(grid.length).fill(null);
    const fixed = (i) => anchored && anchored.has(i) && grid[i] != null;
    for (let c = 0; c < N; c++) {
      const cells = [];
      for (let r = 0; r < N; r++) {
        const i = idx(r, c);
        if (fixed(i)) fromRow[i] = r;
        else cells.push(i);
      }
      const items = cells.filter((i) => grid[i] != null).map((i) => ({ v: grid[i], r: rowOf(i) }));
      for (const i of cells) next[i] = null;
      let k = items.length - 1;
      for (let j = cells.length - 1; j >= 0 && k >= 0; j--, k--) {
        const i = cells[j];
        next[i] = items[k].v;
        fromRow[i] = items[k].r;
      }
    }
    return { grid: next, fromRow };
  }

  /**
   * refill – füllt leere Zellen (nach der Gravitation oben) mit Buchstaben aus dem geseedeten
   * PRNG. Reihenfolge deterministisch: Spalte 0..5, je Spalte von oben nach unten.
   * @returns { grid, fromRow, added } (fromRow negativ = „fällt von oben herein“)
   */
  function refill(grid, rng, fromRow = null) {
    const next = grid.slice();
    const rows = fromRow ? fromRow.slice() : new Array(grid.length).fill(null);
    const added = [];
    for (let c = 0; c < N; c++) {
      let empty = 0;
      for (let r = 0; r < N; r++) if (next[idx(r, c)] == null) empty++;
      for (let r = 0; r < N; r++) {
        const i = idx(r, c);
        if (next[i] == null) { next[i] = drawLetter(rng); rows[i] = r - empty; added.push(i); }
      }
    }
    return { grid: next, fromRow: rows, added };
  }

  /* ---------------------------------------------------------------------
   * PUNKTE
   * ------------------------------------------------------------------- */

  /** Kaskaden-Multiplikator einer Stufe (Stufe 1 = ×1, 2 = ×1,5 …). */
  function comboMultiplier(level) { return 1 + COMBO_STEP * (level - 1); }

  /**
   * targetScore – Punkte fürs Zielwort.
   * Länge × POINTS_PER_LETTER × (1 + COMBO_STEP × cascades) × (1 − HINT_PENALTY × hints)
   */
  function targetScore(length, cascades = 0, hints = 0) {
    const factor = Math.max(0, 1 - HINT_PENALTY * hints);
    return Math.round(length * POINTS_PER_LETTER * (1 + COMBO_STEP * cascades) * factor);
  }

  /** Level gelöst: Punkte berechnen und Zustand einfrieren. */
  function solve(state, hit, cascades) {
    const points = targetScore(hit.length, cascades, state.hintsUsed);
    state.solved = {
      ...hit, cascades, cascadeMult: 1 + COMBO_STEP * cascades,
      hintsUsed: state.hintsUsed, points
    };
    state.levelPoints = points;
    state.score = state.baseScore + points;
    state.ended = true;
  }

  /* ---------------------------------------------------------------------
   * KASKADE
   * ------------------------------------------------------------------- */

  /**
   * cascade – nach einem Slide: Zielwort prüfen; sonst kurze Wörter löschen (nur ungeschützte
   * Felder), Gravitation um verankerte Zielbuchstaben, Nachfüllen – und wiederholen, bis
   * nichts mehr zerbröselt. Das Zielwort wird VOR jeder Löschrunde geprüft.
   * @returns Array von Schritten für die Animation
   */
  function cascade(state) {
    const steps = [];
    let level = 0;
    for (;;) {
      if (state.target) {
        const hit = checkTargetWord(state.grid, state.target);
        if (hit) { solve(state, hit, level); break; }
      }
      if (level >= MAX_CASCADE_LEVELS) break;
      const protect = neededCells(state.grid, state.target);
      const matches = findShortWords(state.grid, state).filter((m) => m.cells.some((i) => !protect.has(i)));
      if (!matches.length) break;
      level++;
      const gridBefore = state.grid;
      const cl = clearWords(state.grid, matches, protect);
      const fallen = applyGravity(cl.grid, protect);
      const filled = refill(fallen.grid, state.rng, fallen.fromRow);
      state.grid = filled.grid;
      steps.push({
        level, matches, cleared: cl.cleared, fromRow: filled.fromRow,
        gridBefore, gridFallen: filled.grid, gridAfter: state.grid.slice()
      });
    }
    state.combo = level;
    state.maxCombo = Math.max(state.maxCombo, level);
    return steps;
  }

  /* ---------------------------------------------------------------------
   * LEVEL / MODI
   * ------------------------------------------------------------------- */

  /** 6×6-Array (oder String-Zeilen) -> flaches Array mit Großbuchstaben. */
  function normalizeGrid(grid) {
    const rows = grid.map((row) => (Array.isArray(row) ? row : String(row).split("")));
    return rows.flat().map((x) => String(x).toUpperCase());
  }

  const levelById = (id) => LEVELS.find((l) => l.id === id) || null;

  /** Brett und Zähler auf den Anfang setzen (Hinweise bleiben erhalten). */
  function initBoard(state) {
    state.rng = createRng(state.seed);
    state.grid = state.level ? normalizeGrid(state.level.grid) : generateStartBoard(state.rng);
    state.moves = 0;
    state.score = state.baseScore;
    state.levelPoints = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.solved = null;
    state.ended = false;
    state.history = [];
    return state;
  }

  /**
   * loadLevel – Level-Zustand erzeugen.
   * @param ref  Level-Id (Zahl) oder Level-Objekt
   * @param opts { modeId = "level", totalScore = 0 } – totalScore = bisherige Gesamtpunkte
   * Nachfüll-Buchstaben kommen aus einem PRNG mit Seed aus der Level-Id -> Undo/Reset und
   * Lösungen sind reproduzierbar.
   */
  function loadLevel(ref, opts = {}) {
    const level = typeof ref === "object" && ref ? ref : levelById(Number(ref));
    if (!level) throw new Error(`Unbekanntes Level: ${ref}`);
    const state = {
      modeId: opts.modeId || "level", level, levelCount: LEVELS.length,
      target: level.target.toUpperCase(), hint: level.hint,
      seed: hashString(`wortgarten:${level.id}`),
      baseScore: opts.totalScore || 0,
      hintsUsed: 0, revealed: [], hints: []
    };
    return initBoard(state);
  }

  /** nextLevel – nächstes Level mit übernommener Gesamtpunktzahl (null nach dem letzten). */
  function nextLevel(state) {
    const i = LEVELS.indexOf(state.level);
    if (i < 0 || i + 1 >= LEVELS.length) return null;
    return loadLevel(LEVELS[i + 1], { totalScore: state.score });
  }

  /** Tagesrätsel: per Datum gewähltes Level aus der Liste (für alle gleich). */
  function dailyLevelIndex(dateKey) { return hashString(`wortgarten-daily:${dateKey}`) % LEVELS.length; }
  function startDaily(date = new Date()) {
    const dateKey = formatDateKey(date);
    const state = loadLevel(LEVELS[dailyLevelIndex(dateKey)], { modeId: "daily" });
    state.dateKey = dateKey;
    state.puzzleNumber = dailyPuzzleNumber(dateKey);
    return state;
  }

  /** Wortfreies Zufallsbrett (Freies Spiel). */
  function generateStartBoard(rng) {
    let grid;
    for (let attempt = 0; attempt < MAX_BOARD_ATTEMPTS; attempt++) {
      grid = Array.from({ length: N * N }, () => drawLetter(rng));
      if (findShortWords(grid).length === 0) return grid;
    }
    return grid;
  }

  /** Freies Spiel: Zufallsbrett, kein Zielwort. */
  function startFree(seed) {
    const state = {
      modeId: "free", level: null, levelCount: LEVELS.length, target: null, hint: null,
      seed: seed != null ? seed >>> 0 : randomSeed(), baseScore: 0, hintsUsed: 0, revealed: [], hints: []
    };
    return initBoard(state);
  }

  /* ---------------------------------------------------------------------
   * ZÜGE, UNDO, RESET
   * ------------------------------------------------------------------- */

  /** Snapshot: Grid, Punkte, Züge, Combo, PRNG-Zustand. */
  function takeSnapshot(state) {
    return {
      grid: state.grid.slice(),
      score: state.score, moves: state.moves, combo: state.combo, maxCombo: state.maxCombo,
      rngState: state.rng.state
    };
  }

  function restoreSnapshot(state, snap) {
    state.grid = snap.grid.slice();
    state.score = snap.score;
    state.moves = snap.moves;
    state.combo = snap.combo;
    state.maxCombo = snap.maxCombo;
    state.rng.state = snap.rngState;
  }

  /**
   * performSlide – EIN Zug: Snapshot, Linie verschieben, Kaskade, Zielwort-Prüfung.
   * @returns { gridBefore, gridAfterSlide, steps, solved } oder null (Level beendet)
   */
  function performSlide(state, axis, index, dir, opts = {}) {
    if (state.ended || !canSlide(state, axis, index)) return null;
    if (opts.record !== false) {
      state.history.push(takeSnapshot(state));
      if (state.history.length > HISTORY_LIMIT) state.history.shift();
    }
    const gridBefore = state.grid;
    state.grid = slideLine(gridBefore, axis, index, dir);
    state.moves++;
    const gridAfterSlide = state.grid.slice();
    const steps = cascade(state);
    return { gridBefore, gridAfterSlide, steps, solved: state.solved };
  }

  /** undo – Zustand vor dem letzten Zug exakt wiederherstellen (nicht nach dem Lösen). */
  function undo(state) {
    if (state.ended || state.history.length === 0) return false;
    restoreSnapshot(state, state.history.pop());
    return true;
  }

  /** reset – Level neu starten (gleiches Brett, gleicher Nachfüll-Strom). Hinweise bleiben verbraucht. */
  function reset(state) { return initBoard(state); }

  /* ---------------------------------------------------------------------
   * VORSCHAU
   * ------------------------------------------------------------------- */

  /** Unabhängige Kopie für Simulationen (PRNG-Zustand inklusive). */
  function cloneState(state) {
    return {
      ...state, grid: state.grid.slice(),
      rng: { state: state.rng.state }, history: [], revealed: state.revealed.slice()
    };
  }

  /** Alle möglichen Züge (Linie × Richtung). */
  function allMoves(state) {
    const moves = [];
    for (const axis of ["row", "col"]) for (let i = 0; i < N; i++) {
      if (!canSlide(state, axis, i)) continue;
      moves.push({ axis, index: i, dir: -1 }, { axis, index: i, dir: 1 });
    }
    return moves;
  }

  /* ---------------------------------------------------------------------
   * HINWEISE
   * ------------------------------------------------------------------- */

  /** Beste Ausrichtung des Zielworts im Brett: Linie/Position mit den meisten passenden Buchstaben. */
  function bestAlignment(grid, target) {
    let best = null;
    for (const line of LINES) for (let s = 0; s + target.length <= N; s++) {
      const cells = line.cells.slice(s, s + target.length);
      const matched = cells.map((i, k) => grid[i] === target[k]);
      const count = matched.filter(Boolean).length;
      if (!best || count > best.count) best = { axis: line.axis, line: line.index, start: s, cells, matched, count };
    }
    return best;
  }

  /** Lesbare ungefähre Position einer Zelle: „oben links“, „unten rechts“ … */
  function areaName(i) {
    return `${rowOf(i) < N / 2 ? "oberen" : "unteren"} Hälfte, ${colOf(i) < N / 2 ? "links" : "rechts"}`;
  }

  /**
   * useHint – zeigt einen fehlenden Buchstaben des Zielworts (in Wort-Reihenfolge) und seine
   * ungefähre Lage. Max. HINTS_PER_LEVEL pro Level, jeder kostet HINT_PENALTY der Level-Punkte.
   * @returns { index, letter, cell, text } oder null (keine Hinweise mehr / kein Zielwort)
   */
  function useHint(state) {
    if (!state.target || state.ended || state.hintsUsed >= HINTS_PER_LEVEL) return null;
    const t = state.target;
    const align = bestAlignment(state.grid, t);
    const order = [...t].map((_, k) => k);
    const k = order.find((j) => !align.matched[j] && !state.revealed.includes(j)) ??
              order.find((j) => !state.revealed.includes(j));
    if (k === undefined) return null;
    const letter = t[k];
    const slot = align.cells[k];
    const used = new Set(align.cells.filter((_, j) => align.matched[j]));
    let cell = null, bestD = Infinity;
    for (let i = 0; i < N * N; i++) {
      if (state.grid[i] !== letter || used.has(i)) continue;
      const d = Math.abs(rowOf(i) - rowOf(slot)) + Math.abs(colOf(i) - colOf(slot));
      if (d < bestD) { bestD = d; cell = i; }
    }
    const pos = k + 1;
    const text = cell != null
      ? `Das Wort enthält ein ${letter} (${pos}. Buchstabe). Ein ${letter} liegt in der ${areaName(cell)}.`
      : `Das Wort enthält ein ${letter} (${pos}. Buchstabe) – gerade liegt keins frei auf dem Brett.`;
    state.hintsUsed++;
    state.revealed.push(k);
    const hint = { index: k, letter, cell, text };
    state.hints.push(hint);
    return hint;
  }

  /* ---------------------------------------------------------------------
   * TEILEN
   * ------------------------------------------------------------------- */

  /** „Wortgarten Level X · Y Punkte · Z Züge“ (ohne Spoiler). */
  function buildShareText(state) {
    const tag = MODES[state.modeId].shareTag(state);
    const moves = `${state.moves} ${state.moves === 1 ? "Zug" : "Züge"}`;
    if (state.modeId === "free") return `Wortgarten ${tag} · ${moves}`;
    return `Wortgarten ${tag} · ${state.levelPoints} Punkte · ${moves}`;
  }

  /* ---------------------------------------------------------------------
   * LEVEL-PRÜFUNG (für Tests und tools/solve-level.js)
   * ------------------------------------------------------------------- */

  /** Liefert eine Liste von Problemen eines Level-Objekts (leer = in Ordnung). */
  function validateLevel(level) {
    const problems = [];
    const t = String(level.target || "");
    if (!/^[A-Z]+$/.test(t)) problems.push("Zielwort nur A–Z (keine Umlaute: Ä -> AE)");
    if (t.length < 3 || t.length > N) problems.push(`Zielwort-Länge 3–${N}`);
    if (level.length !== t.length) problems.push("length passt nicht zum Zielwort");
    if (!level.hint) problems.push("Hinweis fehlt");
    let grid = [];
    try { grid = normalizeGrid(level.grid); } catch (_) { problems.push("Grid fehlt"); }
    if (grid.length !== N * N || !grid.every((x) => /^[A-Z]$/.test(x))) problems.push("Grid muss 6×6 Buchstaben A–Z sein");
    else {
      if (checkTargetWord(grid, t)) problems.push("Zielwort steht schon im Start-Grid");
      const sw = findShortWords(grid, { target: t, protect: new Set() }); // Startbrett streng: gar keine kurzen Wörter
      if (sw.length) problems.push(`Start-Grid enthält kurze Wörter: ${sw.map((m) => m.word).join(", ")}`);
      const count = (s) => [...s].reduce((m, ch) => ((m[ch] = (m[ch] || 0) + 1), m), {});
      const have = count(grid.join("")), need = count(t);
      for (const [ch, n] of Object.entries(need)) if ((have[ch] || 0) < n) problems.push(`Buchstabe ${ch} fehlt im Grid`);
    }
    return problems;
  }

  const api = {
    CONFIG, LEVELS, GRID_SIZE, MODES, HISTORY_LIMIT, WORD_LIST, DICTIONARY, LINES, GEO,
    parseWordList, createRng, rngNext, hashString, randomSeed, formatDateKey, dailyPuzzleNumber, drawLetter,
    idx, rowOf, colOf, lineCells, movableCells, canSlide, slideLine,
    findWords, checkBoard, findShortWords, checkTargetWord, clearWords, applyGravity, refill,
    comboMultiplier, targetScore, cascade, normalizeGrid, levelById, loadLevel, nextLevel, dailyLevelIndex,
    startDaily, startFree, generateStartBoard, takeSnapshot, restoreSnapshot, performSlide, undo, reset,
    cloneState, allMoves, bestAlignment, bestPartialRun, neededCells, protectedCells, useHint, buildShareText, validateLevel
  };

  if (IS_NODE) module.exports = api;
  else root.LetterSlideLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
