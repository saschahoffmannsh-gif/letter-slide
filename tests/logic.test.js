// Logik-Tests (keine Abhängigkeiten): `npm test` bzw. `node --test tests/logic.test.js`
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/logic.js");
const C = require("../src/config.js");

const N = L.GRID_SIZE;
const at = (g, r, c) => g[r * N + c];
const toGrid = (rows) => rows.join("").split("");
/** Füllbrett ohne Vokale -> bildet garantiert keine Wörter. */
const filler = () => toGrid(["QXJQXJ", "XJQXJQ", "JQXJQX", "QXJQXJ", "XJQXJQ", "JQXJQX"]);
const plantRow = (g, r, c0, word) => word.split("").forEach((ch, k) => (g[r * N + c0 + k] = ch));
const plantCol = (g, c, r0, word) => word.split("").forEach((ch, k) => (g[(r0 + k) * N + c] = ch));
const snap = (st) => JSON.stringify(L.takeSnapshot(st));

test.describe("Wortliste", () => {
  test("keine Duplikate, nur A–Z, Länge 3–6, 600–1000 Wörter", () => {
    const raw = C.WORD_LIST_RAW.split("\n").filter((l) => !l.trim().startsWith("//")).join(" ").trim().split(/\s+/);
    assert.equal(new Set(raw).size, raw.length, "Duplikate im Rohtext");
    for (const w of raw) assert.match(w, /^[A-Z]{3,6}$/);
    assert.equal(L.WORD_LIST.length, raw.length);
    assert.ok(raw.length >= 600 && raw.length <= 1000, `Anzahl ${raw.length}`);
    assert.ok(L.DICTIONARY instanceof Set);
  });
  test("parseWordList bereinigt Eingaben", () => {
    assert.deepEqual(L.parseWordList("// Kommentar\nhaus Haus AB  STRASSEN BÄR auto\n"), ["HAUS", "AUTO"]);
  });
});

test.describe("Modi / Seeds", () => {
  test("gleiches Datum -> identisches Startbrett", () => {
    const a = L.startDaily(new Date(2026, 10, 22, 8)), b = L.startDaily(new Date(2026, 10, 22, 23, 59));
    assert.deepEqual(a.grid, b.grid);
    assert.equal(a.seed, L.hashString("2026-11-22"));
    assert.equal(a.puzzleNumber, 326);
    assert.equal(L.dailyPuzzleNumber("2026-01-01"), 1);
  });
  test("anderes Datum -> anderes Brett", () => {
    assert.notDeepEqual(L.startDaily(new Date(2026, 10, 22)).grid, L.startDaily(new Date(2026, 10, 23)).grid);
  });
  test("Endlos unterscheidet sich, fester Seed ist reproduzierbar", () => {
    const d = L.startDaily(new Date(2026, 10, 22));
    const e1 = L.startEndless(), e2 = L.startEndless();
    assert.notDeepEqual(e1.grid, d.grid);
    assert.notDeepEqual(e1.grid, e2.grid);
    assert.deepEqual(L.startEndless(1234).grid, L.startEndless(1234).grid);
  });
  test("Startbrett: 36 Großbuchstaben, keine Wörter", () => {
    for (let s = 0; s < 200; s++) {
      const g = L.startEndless(s).grid;
      assert.equal(g.length, 36);
      assert.ok(g.every((x) => /^[A-Z]$/.test(x)));
      assert.equal(L.findWords(g).length, 0);
    }
  });
  test("unbekannter Modus wirft Fehler", () => {
    assert.throws(() => L.startMode("gibtsnicht"));
  });
});

test("slideLine ist zyklisch in alle 4 Richtungen", () => {
  const g = Array.from({ length: 36 }, (_, i) => "c" + i); // eindeutige Marker
  const right = L.slideLine(g, "row", 2, +1);
  assert.equal(at(right, 2, 0), at(g, 2, 5)); assert.equal(at(right, 2, 1), at(g, 2, 0));
  const left = L.slideLine(g, "row", 2, -1);
  assert.equal(at(left, 2, 5), at(g, 2, 0)); assert.equal(at(left, 2, 0), at(g, 2, 1));
  const down = L.slideLine(g, "col", 4, +1);
  assert.equal(at(down, 0, 4), at(g, 5, 4)); assert.equal(at(down, 1, 4), at(g, 0, 4));
  const up = L.slideLine(g, "col", 4, -1);
  assert.equal(at(up, 5, 4), at(g, 0, 4)); assert.equal(at(up, 0, 4), at(g, 1, 4));
  for (let c = 0; c < N; c++) assert.equal(at(right, 3, c), at(g, 3, c)); // andere Linien unverändert
  for (let r = 0; r < N; r++) assert.equal(at(down, r, 3), at(g, r, 3));
  assert.equal(g[0], "c0"); // Original unverändert
  assert.deepEqual(L.slideLine(right, "row", 2, -1), g);
  assert.deepEqual(L.slideLine(up, "col", 4, +1), g);
  let x = g; for (let k = 0; k < 6; k++) x = L.slideLine(x, "col", 1, +1);
  assert.deepEqual(x, g);
});

test.describe("findWords", () => {
  test("findet waagerechtes Wort", () => {
    const g = filler(); plantRow(g, 1, 1, "HAUS");
    const m = L.findWords(g);
    assert.equal(m.length, 1); assert.equal(m[0].word, "HAUS"); assert.equal(m[0].axis, "row");
    assert.deepEqual(m[0].cells, [7, 8, 9, 10]);
  });
  test("findet senkrechtes Wort", () => {
    const g = filler(); plantCol(g, 3, 2, "BAUM");
    const m = L.findWords(g);
    assert.equal(m.length, 1); assert.equal(m[0].word, "BAUM"); assert.equal(m[0].axis, "col");
    assert.deepEqual(m[0].cells, [15, 21, 27, 33]);
  });
  test("HAUS zählt nicht zusätzlich AUS", () => {
    assert.ok(L.DICTIONARY.has("AUS") && L.DICTIONARY.has("HAUS"));
    const g = filler(); plantRow(g, 0, 0, "HAUS");
    assert.deepEqual(L.findWords(g).map((m) => m.word), ["HAUS"]);
  });
  test("Kreuzung Zeile/Spalte: beide Treffer, geteilte Zelle einmal gelöscht", () => {
    const g = filler(); plantRow(g, 0, 0, "HAUS"); plantCol(g, 0, 0, "HUND");
    const m = L.findWords(g);
    assert.deepEqual(m.map((x) => x.word).sort(), ["HAUS", "HUND"]);
    const { cleared } = L.clearWords(g, m);
    assert.deepEqual(cleared, [0, 1, 2, 3, 6, 12, 18]);
  });
  test("Überlappung in einer Linie (TEE + EIS) wird gemeinsam gelöscht", () => {
    const g = filler(); plantRow(g, 3, 0, "TEEIS");
    const w = L.findWords(g).map((x) => x.word);
    assert.ok(w.includes("TEE") && w.includes("EIS"), w.join(","));
    assert.deepEqual(L.clearWords(g, L.findWords(g)).cleared, [18, 19, 20, 21, 22]);
  });
});

test.describe("Gravitation & Nachfüllen", () => {
  test("applyGravity lässt fallen, refill füllt von oben", () => {
    const g = filler(); plantRow(g, 3, 1, "HAUS");
    const { grid: cleared } = L.clearWords(g, L.findWords(g));
    const fallen = L.applyGravity(cleared);
    for (let c = 1; c <= 4; c++) {
      assert.equal(at(fallen.grid, 0, c), null);
      assert.equal(at(fallen.grid, 3, c), at(g, 2, c));
      assert.equal(fallen.fromRow[3 * N + c], 2);
      assert.equal(at(fallen.grid, 5, c), at(g, 5, c));
    }
    const filled = L.refill(fallen.grid, L.createRng(42), fallen.fromRow);
    assert.ok(filled.grid.every((x) => /^[A-Z]$/.test(x)));
    assert.equal(filled.added.length, 4);
    for (let c = 1; c <= 4; c++) assert.equal(filled.fromRow[c], -1);
  });
  test("nach beliebigen Zügen ist jede Zelle gefüllt und wortfrei", () => {
    for (let s = 0; s < 100; s++) {
      const st = L.startEndless(s);
      for (let k = 0; k < 40; k++) {
        L.performSlide(st, k % 2 ? "row" : "col", (k * 7 + s) % 6, k % 3 ? 1 : -1);
        assert.ok(st.grid.length === 36 && st.grid.every((x) => /^[A-Z]$/.test(x)));
        assert.equal(L.findWords(st.grid).length, 0);
      }
    }
  });
});

test.describe("Punkte & Kaskade", () => {
  test("Basispunkte und Multiplikator", () => {
    assert.deepEqual([3, 4, 5, 6].map(L.baseWordScore), [10, 25, 60, 150]);
    assert.deepEqual([1, 2, 3, 4].map(L.comboMultiplier), [1, 1.5, 2, 2.5]);
  });
  test("cascade-Punkte entsprechen der Formel (unabhängig nachgerechnet)", () => {
    let multi = 0;
    for (let s = 0; s < 400; s++) {
      const st = L.startEndless(s);
      for (let k = 0; k < 30; k++) {
        const before = st.score;
        const res = L.performSlide(st, k % 2 ? "row" : "col", (s + k) % 6, k % 2 ? -1 : 1);
        let expected = 0;
        res.steps.forEach((step, i) => {
          assert.equal(step.level, i + 1);
          const base = step.matches.reduce((a, m) => a + ({ 3: 10, 4: 25, 5: 60, 6: 150 })[m.length], 0);
          const pts = Math.round(base * (1 + 0.5 * (step.level - 1)));
          assert.equal(step.points, pts);
          expected += pts;
        });
        assert.equal(st.score - before, expected);
        assert.equal(st.combo, res.steps.length);
        if (res.steps.length >= 2) multi++;
      }
    }
    assert.ok(multi > 0, "keine mehrstufige Kaskade erreicht");
  });
  test("geplante Kaskade: TEE (x1 = 10) löst ROT aus (x1,5 = 15)", () => {
    const st = L.startEndless(7);
    const g = filler();
    plantCol(g, 0, 3, "TEE"); g[2 * N] = "R"; g[5 * N + 1] = "O"; g[5 * N + 2] = "T";
    assert.deepEqual(L.findWords(g).map((m) => m.word), ["TEE"]);
    st.grid = g;
    const steps = L.cascade(st);
    assert.ok(steps.length >= 2);
    assert.deepEqual(steps[0].matches.map((m) => m.word), ["TEE"]);
    assert.equal(steps[0].points, 10);
    assert.deepEqual(steps[1].matches.map((m) => m.word), ["ROT"]);
    assert.equal(steps[1].points, 15);
    assert.equal(st.maxCombo, steps.length);
  });
});

test.describe("Undo / Reset", () => {
  test("Undo stellt Grid, Score, Züge, Combo und PRNG-Zustand exakt wieder her", () => {
    for (let s = 0; s < 200; s++) {
      const st = L.startEndless(s);
      const snaps = [];
      for (let k = 0; k < 25; k++) {
        snaps.push(snap(st));
        L.performSlide(st, k % 2 ? "row" : "col", (s + 2 * k) % 6, k % 2 ? 1 : -1);
      }
      for (let k = 24; k >= 0; k--) {
        assert.ok(L.undo(st));
        assert.equal(snap(st), snaps[k]);
      }
      assert.equal(L.undo(st), false);
    }
  });
  test("Undo + gleicher Zug -> identisches Ergebnis (PRNG wirklich zurückgesetzt)", () => {
    const st = L.startDaily(new Date(2026, 10, 22));
    let found = false;
    for (let k = 0; k < 300 && !found; k++) {
      const axis = k % 2 ? "row" : "col";
      const res = L.performSlide(st, axis, k % 6, 1);
      if (!res.steps.length) continue;
      const after = snap(st);
      L.undo(st);
      L.performSlide(st, axis, k % 6, 1);
      assert.equal(snap(st), after);
      found = true;
    }
    assert.ok(found);
  });
  test("History hält >= 20 Schritte", () => {
    const st = L.startEndless(5);
    for (let k = 0; k < 80; k++) L.performSlide(st, "row", k % 6, 1);
    assert.ok(L.HISTORY_LIMIT >= 20);
    assert.equal(st.history.length, L.HISTORY_LIMIT);
  });
  test("Reset -> gleiches Startbrett, alles auf 0", () => {
    const st = L.startDaily(new Date(2026, 10, 22));
    const start = st.grid.slice();
    for (let k = 0; k < 10; k++) L.performSlide(st, "col", k % 6, -1);
    L.reset(st);
    assert.deepEqual(st.grid, start);
    assert.equal(st.score + st.moves + st.combo + st.maxCombo, 0);
    assert.equal(st.history.length, 0);
  });
});

test.describe("Teilen / Runde beenden", () => {
  test("Share-Text-Format, Endlos-Label, kein Brett-Spoiler", () => {
    const st = L.startDaily(new Date(2026, 10, 22));
    st.moves = 4; st.score = 62; st.maxCombo = 3;
    assert.equal(L.buildShareText(st), "Letter Slide #326 · 4 Züge · 62 Punkte · 🔥🔥🔥");
    const e = L.startEndless(1); e.moves = 1; e.score = 10; e.maxCombo = 1;
    assert.equal(L.buildShareText(e), "Letter Slide Endlos · 1 Zug · 10 Punkte · 🔥");
    assert.ok(!/[A-Z]{3,}/.test(L.buildShareText(st).replace("Letter Slide", "")));
  });
  test("Runde beenden friert ein (keine Züge, kein Undo)", () => {
    const st = L.startEndless(3);
    L.performSlide(st, "row", 0, 1);
    const before = snap(st);
    L.endRound(st);
    assert.equal(L.performSlide(st, "row", 1, 1), null);
    assert.equal(L.undo(st), false);
    assert.equal(snap(st), before);
  });
});
