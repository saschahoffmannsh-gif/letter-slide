/*
 * Wortgarten – SPIELLOGIK
 * =======================
 * Reine Logik ohne DOM-Zugriff: PRNG, Brett-Operationen, Wortsuche, Modifikatoren
 * (Stein/Brunnen/Trieb), Zielwort-Prüfung, Kaskaden, Punkte, Hinweise, Vorschau,
 * Level laden, Undo/Reset, Teilen-Text.
 *
 * DATENMODELL (Zustand `state`)
 *   grid[36]     Buchstaben, Index = Zeile * 6 + Spalte (null nur kurz während Löschen/Fallen)
 *   cellMod[36]  Modifikator des FELDES: null | "stein" | "brunnen"
 *                  stein   – Feld UND sein Buchstabe sind fest: Slides überspringen das Feld,
 *                            die Gravitation lässt Buchstaben daran vorbeifallen, beim Löschen
 *                            bleibt der Stein-Buchstabe stehen.
 *                  brunnen – Eigenschaft der Position: Buchstaben gleiten normal hindurch;
 *                            verläuft das Zielwort über das Feld, zählt es ×2.
 *   sprout[36]   true = der Buchstabe in dieser Zelle ist ein TRIEB (seltener Buchstabe).
 *                  Der Trieb gehört zum BUCHSTABEN: er wandert bei Slides und beim Fallen mit
 *                  (Spec: „normaler Buchstabe mit grünem Hintergrund“). Wird er Teil eines
 *                  kurzen Worts, wird er mit gelöscht.
 *   Ein Feld trägt höchstens EINEN Modifikator: neue Modifikatoren weichen auf das nächste
 *   freie Feld aus (kein Überschreiben).
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
    SHORT_MIN, SHORT_MAX, PROTECT_MIN, POINTS_PER_LETTER, BRUNNEN_FACTOR, COMBO_STEP, HINTS_PER_LEVEL, HINT_PENALTY,
    MODIFIER_RULES, RARE_LETTERS, HISTORY_LIMIT, MAX_CASCADE_LEVELS, MAX_BOARD_ATTEMPTS, DAILY_EPOCH, MODES
  } = CONFIG;
  const N = GRID_SIZE;
  const MOD_TYPES = ["stein", "brunnen", "trieb"];

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
  /** Zentrales Feld: |r − 2,5| < 1 und |c − 2,5| < 1 (die 4 mittleren Felder). */
  const isCenter = (i) => Math.abs(rowOf(i) - 2.5) < 1 && Math.abs(colOf(i) - 2.5) < 1;
  const GEO = { idx, rowOf, colOf, isCenter, size: N };

  /** Alle 12 Linien (6 Zeilen, 6 Spalten) mit ihren Zellindizes. */
  const LINES = (() => {
    const lines = [];
    for (let r = 0; r < N; r++) lines.push({ axis: "row", index: r, cells: Array.from({ length: N }, (_, c) => idx(r, c)) });
    for (let c = 0; c < N; c++) lines.push({ axis: "col", index: c, cells: Array.from({ length: N }, (_, r) => idx(r, c)) });
    return lines;
  })();
  const lineCells = (axis, index) => LINES[axis === "row" ? index : N + index].cells;

  /** Zellen einer Linie, die sich bewegen dürfen (alles außer Steinen). */
  function movableCells(cellMod, axis, index) {
    const cells = lineCells(axis, index);
    return cellMod ? cells.filter((i) => cellMod[i] !== "stein") : cells.slice();
  }

  /** Kann diese Linie geschoben werden? (Mind. 2 Nicht-Stein-Felder, sonst ist der Pfeil aus.) */
  function canSlide(state, axis, index) {
    return movableCells(state.cellMod, axis, index).length >= 2;
  }

  /**
   * slideLine – verschiebt eine Zeile/Spalte zyklisch um ein Feld.
   * Steine bleiben stehen; der Rest der Linie rückt um sie herum (überspringt sie).
   * Funktioniert für jedes Array (Buchstaben, Trieb-Flags, …).
   * @param dir +1 = rechts/runter, -1 = links/hoch
   * @returns neues Array (Original unverändert)
   */
  function slideLine(grid, axis, index, dir, cellMod = null) {
    const next = grid.slice();
    const cells = movableCells(cellMod, axis, index);
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

  /** protectedCells – Felder des Zielwort-Fortschritts (Set von Indizes; leer ohne Zielwort). */
  function protectedCells(grid, target) {
    const run = bestPartialRun(grid, target);
    return new Set(run ? run.cells : []);
  }

  /**
   * findShortWords – kurze Wörter (SHORT_MIN..SHORT_MAX), die gelöscht werden und Modifikatoren
   * pflanzen. Ausgenommen:
   *   - das Zielwort selbst,
   *   - Wörter, die nur aus Stein-Feldern bestehen (sonst Endlos-Kaskade),
   *   - Wörter, die ein GESCHÜTZTES Feld (Zielwort-Fortschritt, siehe bestPartialRun) enthalten:
   *     sie werden nicht gelöscht und pflanzen nichts. Das gilt auch für ein kurzes Wort, das
   *     selbst ein Präfix des Zielworts in derselben Linie ist – das ist einfach Fortschritt.
   * opts.protect: Set geschützter Felder; fehlt es, wird es aus opts.target berechnet.
   */
  function findShortWords(grid, opts = {}) {
    const { target = null, cellMod = null } = opts;
    const protect = opts.protect || protectedCells(grid, target);
    return findWords(grid).filter((m) => m.length >= SHORT_MIN && m.length <= SHORT_MAX && m.word !== target &&
      !(cellMod && m.cells.every((i) => cellMod[i] === "stein")) &&
      !m.cells.some((i) => protect.has(i)));
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
   * LÖSCHEN, GRAVITATION, NACHFÜLLEN (mit Steinen)
   * ------------------------------------------------------------------- */

  /**
   * clearWords – leert alle Zellen aller Treffer gleichzeitig. Stein-Felder bleiben stehen.
   * @returns { grid, sprout, cleared }
   */
  function clearWords(grid, matches, cellMod = null, sprout = null) {
    const marked = new Set();
    for (const m of matches) for (const i of m.cells) if (!cellMod || cellMod[i] !== "stein") marked.add(i);
    const next = grid.slice();
    const sp = sprout ? sprout.slice() : null;
    for (const i of marked) { next[i] = null; if (sp) sp[i] = false; }
    return { grid: next, sprout: sp, cleared: [...marked].sort((a, b) => a - b) };
  }

  /**
   * applyGravity – Buchstaben fallen in ihrer Spalte nach unten in Lücken. Stein-Felder sind fest:
   * sie fallen nicht und Buchstaben fallen an ihnen vorbei. Trieb-Flags fallen mit.
   * @returns { grid, sprout, fromRow } – fromRow[i] = Ursprungszeile des Buchstabens in Zelle i
   */
  function applyGravity(grid, cellMod = null, sprout = null) {
    const next = grid.slice();
    const sp = sprout ? sprout.slice() : null;
    const fromRow = new Array(grid.length).fill(null);
    for (let c = 0; c < N; c++) {
      const cells = [];
      for (let r = 0; r < N; r++) {
        const i = idx(r, c);
        if (cellMod && cellMod[i] === "stein") fromRow[i] = r; // Stein bleibt, wo er ist
        else cells.push(i);
      }
      const items = cells.filter((i) => grid[i] != null).map((i) => ({ v: grid[i], s: sprout ? sprout[i] : false, r: rowOf(i) }));
      for (const i of cells) { next[i] = null; if (sp) sp[i] = false; }
      let k = items.length - 1;
      for (let j = cells.length - 1; j >= 0 && k >= 0; j--, k--) {
        const i = cells[j];
        next[i] = items[k].v;
        if (sp) sp[i] = items[k].s;
        fromRow[i] = items[k].r;
      }
    }
    return { grid: next, sprout: sp, fromRow };
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
   * MODIFIKATOREN
   * ------------------------------------------------------------------- */

  /** Welcher Modifikator-Typ gehört zu diesem Wort? (erste passende Regel aus MODIFIER_RULES) */
  function modifierTypeFor(word) {
    for (const rule of MODIFIER_RULES) if (rule.when(word, GEO)) return rule.type;
    return null;
  }

  /**
   * Gewünschtes Zielfeld für Stein/Brunnen: rechts vom letzten Buchstaben (waagerecht) bzw.
   * darunter (senkrecht). Liegt es außerhalb des Bretts, wird auf das nächste gültige Feld
   * geklemmt (= der letzte Buchstabe des Worts).
   */
  function targetCellFor(word) {
    const end = Math.min(word.start + word.length, N - 1);
    return word.axis === "row" ? idx(word.line, end) : idx(end, word.line);
  }

  /** Ring der Felder um das Wort, im Uhrzeigersinn ab der Ecke oben links (nur Felder im Brett). */
  function clockwiseRing(word) {
    const rs = word.cells.map(rowOf), cs = word.cells.map(colOf);
    const r0 = Math.min(...rs) - 1, r1 = Math.max(...rs) + 1, c0 = Math.min(...cs) - 1, c1 = Math.max(...cs) + 1;
    const ring = [];
    for (let c = c0; c <= c1; c++) ring.push([r0, c]);          // oben: links -> rechts
    for (let r = r0 + 1; r <= r1; r++) ring.push([r, c1]);      // rechts: oben -> unten
    for (let c = c1 - 1; c >= c0; c--) ring.push([r1, c]);      // unten: rechts -> links
    for (let r = r1 - 1; r > r0; r--) ring.push([r, c0]);       // links: unten -> oben
    return ring.filter(([r, c]) => r >= 0 && r < N && c >= 0 && c < N).map(([r, c]) => idx(r, c));
  }

  /** Feld schon belegt (Stein, Brunnen oder Trieb-Buchstabe)? */
  const occupied = (state, i) => state.cellMod[i] != null || state.sprout[i];

  /** Nächstes freies Feld zu `from` (Manhattan-Abstand, bei Gleichstand Lesereihenfolge). */
  function nearestFree(state, from, exclude = null) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < N * N; i++) {
      if (occupied(state, i) || (exclude && exclude.has(i))) continue;
      const d = Math.abs(rowOf(i) - rowOf(from)) + Math.abs(colOf(i) - colOf(from));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /**
   * placeModifier – setzt EINEN Modifikator für ein Wort (Geometrie = Position VOR dem Löschen)
   * auf das aktuelle Brett (nach Gravitation/Nachfüllen).
   *   stein/brunnen: Zielfeld laut targetCellFor; belegt -> nächstes freies Feld
   *   trieb:         erstes freies Feld im Uhrzeigersinn um das Wort; der Buchstabe dort wird
   *                  durch einen seltenen Buchstaben (PRNG) ersetzt und wird zum Trieb
   * @returns { type, cell, desired, word, letter? } oder null (kein freies Feld)
   */
  function placeModifier(state, type, word) {
    if (type === "trieb") {
      const ring = clockwiseRing(word);
      let cell = ring.find((i) => !occupied(state, i));
      if (cell === undefined) cell = nearestFree(state, word.cells[0], new Set(word.cells));
      if (cell == null) return null;
      const letter = RARE_LETTERS[Math.floor(rngNext(state.rng) * RARE_LETTERS.length)];
      state.grid[cell] = letter;
      state.sprout[cell] = true;
      return { type, cell, desired: ring[0] ?? cell, word: word.word, letter };
    }
    const desired = targetCellFor(word);
    const cell = occupied(state, desired) ? nearestFree(state, desired) : desired;
    if (cell == null) return null;
    state.cellMod[cell] = type;
    return { type, cell, desired, word: word.word };
  }

  /** Plan: welcher Modifikator entsteht für welches Wort (nur aktive Typen). */
  function planModifiers(state, matches) {
    const plan = [];
    for (const m of matches) {
      const type = modifierTypeFor(m);
      if (type && state.enabled[type]) plan.push({ type, word: m });
    }
    return plan;
  }

  /** applyModifiers – Plan einer Kaskadenstufe ausführen (in Wort-Reihenfolge). @returns Platzierungen */
  function applyModifiers(state, plan) {
    const placed = [];
    for (const p of plan) {
      const res = placeModifier(state, p.type, p.word);
      if (res) { placed.push(res); state.created[res.type]++; }
    }
    return placed;
  }

  /** Aktuell sichtbare Modifikatoren zählen (für „Stein: 2 | Brunnen: 1 | Trieb: 0“). */
  function countModifiers(state) {
    const out = { stein: 0, brunnen: 0, trieb: 0 };
    for (let i = 0; i < N * N; i++) {
      if (state.cellMod[i]) out[state.cellMod[i]]++;
      if (state.sprout[i]) out.trieb++;
    }
    return out;
  }

  /* ---------------------------------------------------------------------
   * PUNKTE
   * ------------------------------------------------------------------- */

  /** Kaskaden-Multiplikator einer Stufe (Stufe 1 = ×1, 2 = ×1,5 …). */
  function comboMultiplier(level) { return 1 + COMBO_STEP * (level - 1); }

  /**
   * targetScore – Punkte fürs Zielwort.
   * Länge × POINTS_PER_LETTER × BRUNNEN_FACTOR^brunnen × (1 + COMBO_STEP × cascades) × (1 − HINT_PENALTY × hints)
   */
  function targetScore(length, brunnen = 0, cascades = 0, hints = 0) {
    const factor = Math.max(0, 1 - HINT_PENALTY * hints);
    return Math.round(length * POINTS_PER_LETTER * Math.pow(BRUNNEN_FACTOR, brunnen) * (1 + COMBO_STEP * cascades) * factor);
  }

  /** Level gelöst: Punkte berechnen und Zustand einfrieren. */
  function solve(state, hit, cascades) {
    const brunnen = hit.cells.filter((i) => state.cellMod[i] === "brunnen").length;
    const points = targetScore(hit.length, brunnen, cascades, state.hintsUsed);
    state.solved = {
      ...hit, brunnen, cascades, cascadeMult: 1 + COMBO_STEP * cascades,
      brunnenMult: Math.pow(BRUNNEN_FACTOR, brunnen), hintsUsed: state.hintsUsed, points
    };
    state.levelPoints = points;
    state.score = state.baseScore + points;
    state.ended = true;
  }

  /* ---------------------------------------------------------------------
   * KASKADE
   * ------------------------------------------------------------------- */

  /**
   * cascade – nach einem Slide: Zielwort prüfen; sonst kurze Wörter löschen, Gravitation,
   * Nachfüllen, Modifikatoren pflanzen – und wiederholen, bis nichts mehr passiert.
   * Das Zielwort wird VOR jeder Löschrunde geprüft (es wird nie als kurzes Wort zerstört).
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
      const matches = findShortWords(state.grid, state);
      if (!matches.length) break;
      level++;
      const plan = planModifiers(state, matches);
      const gridBefore = state.grid, cellModBefore = state.cellMod.slice(), sproutBefore = state.sprout.slice();
      const cl = clearWords(state.grid, matches, state.cellMod, state.sprout);
      const fallen = applyGravity(cl.grid, state.cellMod, cl.sprout);
      const filled = refill(fallen.grid, state.rng, fallen.fromRow);
      state.grid = filled.grid.slice();
      state.sprout = fallen.sprout;
      const gridFallen = filled.grid, sproutFallen = fallen.sprout.slice();
      const placed = applyModifiers(state, plan);
      steps.push({
        level, matches, plan, placed, cleared: cl.cleared, fromRow: filled.fromRow,
        gridBefore, cellModBefore, sproutBefore,
        gridFallen, sproutFallen,                       // nach Fallen/Nachfüllen, vor dem Pflanzen
        gridAfter: state.grid.slice(), cellModAfter: state.cellMod.slice(), sproutAfter: state.sprout.slice()
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

  /** Brett, Zähler, Modifikatoren auf den Anfang setzen (Hinweise bleiben erhalten). */
  function initBoard(state) {
    state.rng = createRng(state.seed);
    state.grid = state.level ? normalizeGrid(state.level.grid) : generateStartBoard(state.rng);
    state.cellMod = new Array(N * N).fill(null);
    state.sprout = new Array(N * N).fill(false);
    state.moves = 0;
    state.score = state.baseScore;
    state.levelPoints = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.solved = null;
    state.ended = false;
    state.history = [];
    state.created = { stein: 0, brunnen: 0, trieb: 0 };
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
    const enabled = { stein: false, brunnen: false, trieb: false, ...(level.modifiersEnabled || {}) };
    const state = {
      modeId: opts.modeId || "level", level, levelCount: LEVELS.length,
      target: level.target.toUpperCase(), hint: level.hint, enabled,
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

  /** Freies Spiel: Zufallsbrett, alle Modifikatoren aktiv, kein Zielwort. */
  function startFree(seed) {
    const state = {
      modeId: "free", level: null, levelCount: LEVELS.length, target: null, hint: null,
      enabled: { stein: true, brunnen: true, trieb: true },
      seed: seed != null ? seed >>> 0 : randomSeed(), baseScore: 0, hintsUsed: 0, revealed: [], hints: []
    };
    return initBoard(state);
  }

  /* ---------------------------------------------------------------------
   * ZÜGE, UNDO, RESET
   * ------------------------------------------------------------------- */

  /** Snapshot: Grid, Modifikatoren, Triebe, Punkte, Züge, Combo, PRNG-Zustand. */
  function takeSnapshot(state) {
    return {
      grid: state.grid.slice(), cellMod: state.cellMod.slice(), sprout: state.sprout.slice(),
      score: state.score, moves: state.moves, combo: state.combo, maxCombo: state.maxCombo,
      created: { ...state.created }, rngState: state.rng.state
    };
  }

  function restoreSnapshot(state, snap) {
    state.grid = snap.grid.slice();
    state.cellMod = snap.cellMod.slice();
    state.sprout = snap.sprout.slice();
    state.score = snap.score;
    state.moves = snap.moves;
    state.combo = snap.combo;
    state.maxCombo = snap.maxCombo;
    state.created = { ...snap.created };
    state.rng.state = snap.rngState;
  }

  /**
   * performSlide – EIN Zug: Snapshot, Linie verschieben (Steine bleiben), Kaskade, Zielwort-Prüfung.
   * @returns { gridBefore, sproutBefore, cellMod, gridAfterSlide, sproutAfterSlide, steps, solved }
   *          oder null (Level beendet oder Linie blockiert)
   */
  function performSlide(state, axis, index, dir, opts = {}) {
    if (state.ended || !canSlide(state, axis, index)) return null;
    if (opts.record !== false) {
      state.history.push(takeSnapshot(state));
      if (state.history.length > HISTORY_LIMIT) state.history.shift();
    }
    const gridBefore = state.grid, sproutBefore = state.sprout, cellMod = state.cellMod.slice();
    state.grid = slideLine(gridBefore, axis, index, dir, state.cellMod);
    state.sprout = slideLine(sproutBefore, axis, index, dir, state.cellMod);
    state.moves++;
    const gridAfterSlide = state.grid.slice(), sproutAfterSlide = state.sprout.slice();
    const steps = cascade(state);
    return { gridBefore, sproutBefore, cellMod, gridAfterSlide, sproutAfterSlide, steps, solved: state.solved };
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
      ...state, grid: state.grid.slice(), cellMod: state.cellMod.slice(), sprout: state.sprout.slice(),
      rng: { state: state.rng.state }, history: [], created: { ...state.created }, revealed: state.revealed.slice()
    };
  }

  /**
   * previewModifiers – simuliert einen Zug (inkl. Kaskaden, exakt mit demselben PRNG-Strom)
   * und liefert, welche Modifikatoren wo entstehen würden. Verändert `state` nicht.
   * @returns { blocked, placements: [{ type, cell, word, level, letter? }], words }
   */
  function previewModifiers(state, axis, index, dir) {
    if (state.ended || !canSlide(state, axis, index)) return { blocked: true, placements: [], words: [] };
    const sim = cloneState(state);
    const res = performSlide(sim, axis, index, dir, { record: false });
    const placements = [], words = [];
    for (const s of res.steps) {
      for (const m of s.matches) words.push(m.word);
      for (const p of s.placed) placements.push({ ...p, level: s.level });
    }
    return { blocked: false, placements, words };
  }

  /** Alle möglichen Züge (Linie × Richtung), die gerade erlaubt sind. */
  function allMoves(state) {
    const moves = [];
    for (const axis of ["row", "col"]) for (let i = 0; i < N; i++) {
      if (!canSlide(state, axis, i)) continue;
      moves.push({ axis, index: i, dir: -1 }, { axis, index: i, dir: 1 });
    }
    return moves;
  }

  /** „Was passiert, wenn?“ – alle Züge, die JETZT Modifikatoren erzeugen würden. */
  function whatIf(state) {
    const out = [];
    for (const mv of allMoves(state)) {
      const p = previewModifiers(state, mv.axis, mv.index, mv.dir);
      if (p.placements.length) out.push({ ...mv, ...p });
    }
    return out;
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
    if (state.modeId === "free") {
      const c = state.created;
      return `Wortgarten ${tag} · ${moves} · Stein ${c.stein} · Brunnen ${c.brunnen} · Trieb ${c.trieb}`;
    }
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
    CONFIG, LEVELS, GRID_SIZE, MODES, MOD_TYPES, HISTORY_LIMIT, WORD_LIST, DICTIONARY, LINES, GEO,
    parseWordList, createRng, rngNext, hashString, randomSeed, formatDateKey, dailyPuzzleNumber, drawLetter,
    idx, rowOf, colOf, isCenter, lineCells, movableCells, canSlide, slideLine,
    findWords, checkBoard, findShortWords, checkTargetWord, clearWords, applyGravity, refill,
    modifierTypeFor, targetCellFor, clockwiseRing, placeModifier, planModifiers, applyModifiers, countModifiers,
    comboMultiplier, targetScore, cascade, normalizeGrid, levelById, loadLevel, nextLevel, dailyLevelIndex,
    startDaily, startFree, generateStartBoard, takeSnapshot, restoreSnapshot, performSlide, undo, reset,
    cloneState, previewModifiers, allMoves, whatIf, bestAlignment, bestPartialRun, protectedCells, useHint, buildShareText, validateLevel
  };

  if (IS_NODE) module.exports = api;
  else root.LetterSlideLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
