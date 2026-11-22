// Tests für src/logic.js (Wortgarten) – reine Logik, keine Abhängigkeiten.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/logic.js");

const { idx } = L;
/** Grid aus 6 Zeilen-Strings; "." = Füllbuchstabe Q (bildet keine Wörter). */
const G = (...rows) => rows.join("").replace(/\./g, "Q").split("");
/** Test-Level aus Zeilen, Zielwort und aktiven Modifikatoren. */
const lvl = (rows, target = "ZZZZ", mods = { stein: true, brunnen: true, trieb: true }, id = 99) =>
  ({ id, hint: "Test", length: target.length, target, grid: rows.map((r) => r.replace(/\./g, "Q").split("")), modifiersEnabled: mods });
const json = (x) => JSON.parse(JSON.stringify(x));

test.describe("Wortliste & Grundlagen", () => {
  test("Wortliste: keine Duplikate, nur A–Z, Länge 3–6", () => {
    assert.equal(new Set(L.WORD_LIST).size, L.WORD_LIST.length);
    assert.ok(L.WORD_LIST.every((w) => /^[A-Z]{3,6}$/.test(w)));
    assert.ok(L.WORD_LIST.length >= 600);
  });
  test("PRNG ist deterministisch, Zustand ist eine Zahl", () => {
    const a = L.createRng(42), b = L.createRng(42);
    const xs = Array.from({ length: 5 }, () => L.rngNext(a));
    assert.deepEqual(xs, Array.from({ length: 5 }, () => L.rngNext(b)));
    assert.equal(typeof a.state, "number");
  });
  test("slideLine ist zyklisch in alle 4 Richtungen (ohne Steine)", () => {
    const g = G("ABCDEF", "......", "......", "......", "......", "......");
    assert.equal(L.slideLine(g, "row", 0, 1).slice(0, 6).join(""), "FABCDE");
    assert.equal(L.slideLine(g, "row", 0, -1).slice(0, 6).join(""), "BCDEFA");
    const v = G("A.....", "B.....", "C.....", "D.....", "E.....", "F.....");
    const col = (x) => [0, 1, 2, 3, 4, 5].map((r) => x[idx(r, 0)]).join("");
    assert.equal(col(L.slideLine(v, "col", 0, 1)), "FABCDE");
    assert.equal(col(L.slideLine(v, "col", 0, -1)), "BCDEFA");
  });
  test("findWords: HAUS zählt nicht zusätzlich AUS; senkrecht wird gefunden", () => {
    assert.deepEqual(L.findWords(G("HAUS..", "......", "......", "......", "......", "......")).map((m) => m.word), ["HAUS"]);
    const v = L.findWords(G("T.....", "O.....", "R.....", "......", "......", "......"));
    assert.equal(v.length, 1);
    assert.equal(v[0].axis, "col");
  });
});

test.describe("Steine: Slides und Gravitation", () => {
  test("Slide überspringt Stein-Felder, der Stein-Buchstabe bleibt stehen", () => {
    const g = G("ABCDEF", "......", "......", "......", "......", "......");
    const mod = new Array(36).fill(null);
    mod[idx(0, 2)] = "stein";
    assert.equal(L.slideLine(g, "row", 0, 1, mod).slice(0, 6).join(""), "FACBDE");
    assert.equal(L.slideLine(g, "row", 0, -1, mod).slice(0, 6).join(""), "BDCEFA");
  });
  test("Linie aus (fast) nur Steinen kann nicht geschoben werden", () => {
    const st = L.loadLevel(lvl(["......", "......", "......", "......", "......", "......"]));
    for (let c = 0; c < 5; c++) st.cellMod[idx(0, c)] = "stein";
    assert.equal(L.canSlide(st, "row", 0), false);
    assert.equal(L.performSlide(st, "row", 0, 1), null);
    assert.equal(L.canSlide(st, "col", 5), true);
    assert.ok(!L.allMoves(st).some((m) => m.axis === "row" && m.index === 0));
  });
  test("Gravitation: Buchstaben fallen an Steinen vorbei, Stein bleibt", () => {
    const g = G("A.....", "B.....", "C.....", "S.....", "X.....", "F.....");
    const mod = new Array(36).fill(null);
    mod[idx(3, 0)] = "stein";
    const cl = L.clearWords(g, [{ cells: [idx(4, 0), idx(3, 0)] }], mod);
    assert.deepEqual(cl.cleared, [idx(4, 0)], "Stein-Feld wird nicht geleert");
    const f = L.applyGravity(cl.grid, mod);
    const col = [0, 1, 2, 3, 4, 5].map((r) => f.grid[idx(r, 0)]);
    assert.deepEqual(col, [null, "A", "B", "S", "C", "F"]);
    assert.equal(f.fromRow[idx(4, 0)], 2);
  });
  test("Trieb-Flag wandert mit dem Buchstaben (Slide und Fallen)", () => {
    const sp = new Array(36).fill(false);
    sp[idx(0, 0)] = true;
    const moved = L.slideLine(sp, "row", 0, 1);
    assert.equal(moved[idx(0, 1)], true);
    const g = G("A.....", "......", "......", "......", "......", "......");
    g[idx(5, 0)] = null;
    const f = L.applyGravity(g, null, sp);
    assert.equal(f.sprout[idx(1, 0)], true);
  });
});

test.describe("Modifikatoren entstehen an der richtigen Stelle", () => {
  const first = (st, axis, index, dir) => L.performSlide(st, axis, index, dir).steps[0].placed;

  test("Stein: waagerecht untere Hälfte -> Feld rechts vom letzten Buchstaben", () => {
    const st = L.loadLevel(lvl(["......", "......", "......", "......", "ORQ..T", "......"]));
    const p = first(st, "row", 4, 1); // -> TOR... in Zeile 5
    assert.deepEqual(json(p), [{ type: "stein", cell: idx(4, 3), desired: idx(4, 3), word: "TOR" }]);
    assert.equal(st.cellMod[idx(4, 3)], "stein");
  });
  test("Stein: senkrecht linke Hälfte -> Feld unter dem letzten Buchstaben", () => {
    const st = L.loadLevel(lvl([".O....", ".R....", "......", "......", "......", ".T...."]));
    const p = first(st, "col", 1, 1); // Spalte 2: T,O,R oben
    assert.equal(p[0].type, "stein");
    assert.equal(p[0].cell, idx(3, 1));
  });
  test("Brunnen: waagerecht obere Hälfte -> rechts daneben; senkrecht rechte Hälfte -> darunter", () => {
    const a = L.loadLevel(lvl(["......", "ORQ..T", "......", "......", "......", "......"]));
    const p = first(a, "row", 1, 1);
    assert.equal(p[0].type, "brunnen");
    assert.equal(p[0].cell, idx(1, 3));
    const b = L.loadLevel(lvl(["....O.", "....R.", "......", "......", "......", "....T."]));
    const q = first(b, "col", 4, 1);
    assert.equal(q[0].type, "brunnen");
    assert.equal(q[0].cell, idx(3, 4));
  });
  test("Trieb: Wort in der Mitte -> erstes freies Feld im Uhrzeigersinn bekommt Q/X/Y/J", () => {
    const st = L.loadLevel(lvl(["......", "......", "ORQQQT", "......", "......", "......"]));
    const p = first(st, "row", 2, 1); // Zeile 3 -> TOR auf Spalten 1–3, berührt Mittelfeld (3,3)
    assert.equal(p[0].type, "trieb");
    assert.equal(p[0].cell, idx(1, 0), "Ring startet oben links vom Wort");
    assert.ok(L.CONFIG.RARE_LETTERS.includes(p[0].letter));
    assert.equal(st.grid[idx(1, 0)], p[0].letter);
    assert.equal(st.sprout[idx(1, 0)], true);
  });
  test("Ring im Uhrzeigersinn: Start oben links, nur Felder im Brett", () => {
    const ring = L.clockwiseRing({ cells: [idx(2, 1), idx(2, 2), idx(2, 3)] });
    assert.deepEqual(ring.slice(0, 6), [idx(1, 0), idx(1, 1), idx(1, 2), idx(1, 3), idx(1, 4), idx(2, 4)]);
    assert.equal(ring.length, 12);
    const corner = L.clockwiseRing({ cells: [idx(0, 0), idx(0, 1), idx(0, 2)] });
    assert.deepEqual(corner, [idx(0, 3), idx(1, 3), idx(1, 2), idx(1, 1), idx(1, 0)]);
  });
  test("Regel-Vorrang: Mitte (Trieb) vor Stein/Brunnen; deaktivierter Typ -> nichts", () => {
    const w = { axis: "row", line: 2, start: 1, length: 3, cells: [idx(2, 1), idx(2, 2), idx(2, 3)] };
    assert.equal(L.modifierTypeFor(w), "trieb");
    const st = L.loadLevel(lvl(["......", "......", "ORQQQT", "......", "......", "......"], "ZZZZ", { stein: true }));
    const res = L.performSlide(st, "row", 2, 1);
    assert.deepEqual(res.steps[0].placed, []);
    assert.equal(res.steps[0].plan.length, 0);
  });
  test("Zielfeld außerhalb des Bretts -> nächstes gültiges Feld (geklemmt)", () => {
    const st = L.loadLevel(lvl(["......", "......", "......", "......", "RQQQTO", "......"]));
    const p = first(st, "row", 4, -1); // -> QQQTOR: TOR am rechten Rand
    assert.equal(p[0].type, "stein");
    assert.equal(p[0].desired, idx(4, 5));
    assert.equal(p[0].cell, idx(4, 5));
  });
  test("Belegtes Zielfeld -> nächstes freies Feld (kein Überschreiben)", () => {
    const st = L.loadLevel(lvl(["......", "......", "......", "......", "ORQ..T", "......"]));
    st.cellMod[idx(4, 3)] = "brunnen";
    const p = L.performSlide(st, "row", 4, 1).steps[0].placed;
    assert.equal(st.cellMod[idx(4, 3)], "brunnen", "alter Modifikator bleibt");
    assert.equal(p[0].type, "stein");
    assert.equal(p[0].cell, idx(3, 3), "Abstand 1, Lesereihenfolge");
  });
  test("Wörter nur aus Steinen werden ignoriert (keine Endlos-Kaskade)", () => {
    const g = G("TOR...", "......", "......", "......", "......", "......");
    const mod = new Array(36).fill(null);
    [0, 1, 2].forEach((c) => { mod[idx(0, c)] = "stein"; });
    assert.equal(L.findShortWords(g, { cellMod: mod }).length, 0);
  });
});

test.describe("Zielwort", () => {
  test("checkTargetWord: waagerecht, senkrecht, nicht Teil eines längeren Worts", () => {
    assert.ok(L.checkTargetWord(G("..MOND", "......", "......", "......", "......", "......"), "MOND"));
    assert.ok(L.checkTargetWord(G("M.....", "O.....", "N.....", "D.....", "......", "......"), "MOND"));
    assert.equal(L.checkTargetWord(G("HAUS..", "......", "......", "......", "......", "......"), "AUS"), null);
    assert.equal(L.checkTargetWord(G("DNOM..", "......", "......", "......", "......", "......"), "MOND"), null, "nicht rückwärts");
  });
  test("Zielwort wird nicht als kurzes Wort gelöscht, sondern löst das Level", () => {
    const st = L.loadLevel(lvl(["ORQ..T", "......", "......", "......", "......", "......"], "TOR"));
    const res = L.performSlide(st, "row", 0, 1);
    assert.equal(res.steps.length, 0);
    assert.ok(st.solved && st.ended);
    assert.equal(st.levelPoints, 30);
    assert.equal(L.performSlide(st, "row", 1, 1), null, "nach dem Lösen keine Züge mehr");
    assert.equal(L.undo(st), false);
  });
  test("Punkte: Länge × 10 × 2^Brunnen × Kaskade × Hinweis-Abzug", () => {
    assert.equal(L.targetScore(6), 60);
    assert.equal(L.targetScore(6, 1), 120);
    assert.equal(L.targetScore(6, 3), 480);
    assert.equal(L.targetScore(5, 0, 1), 75);
    assert.equal(L.targetScore(5, 0, 0, 1), 40);
    assert.equal(L.targetScore(5, 0, 0, 5), 0);
  });
  test("Brunnen im Pfad verdoppelt (mehrere multiplikativ)", () => {
    const st = L.loadLevel(lvl(["ONDQQM", "......", "......", "......", "......", "......"], "MOND"));
    st.cellMod[idx(0, 1)] = "brunnen";
    st.cellMod[idx(0, 2)] = "brunnen";
    L.performSlide(st, "row", 0, 1);
    assert.equal(st.solved.brunnen, 2);
    assert.equal(st.levelPoints, 4 * 10 * 4);
  });
  test("Zielwort durch Kaskade: Multiplikator ×1,5", () => {
    // Zeile 1 nach rechts bildet TEE senkrecht? -> einfacher: Zielwort entsteht nach Löschen von TOR darunter
    const rows = ["M.....", "O.....", "N.....", "TOR...", "D.....", "......"];
    // TOR liegt schon da; ein beliebiger Zug, der TOR nicht zerstört, löst die Kaskade aus:
    const st = L.loadLevel(lvl(rows, "MOND", {}));
    L.performSlide(st, "row", 5, 1);
    // TOR (Zeile 4) wird gelöscht, M O N fallen eins nach unten -> M O N D in Spalte 1
    assert.ok(st.solved, "Zielwort nach Kaskade gebildet");
    assert.equal(st.solved.cascades, 1);
    assert.equal(st.levelPoints, 60);
  });
});

test.describe("Zielwort-Fortschritt ist geschützt", () => {
  test("bestPartialRun: längste richtige Teilfolge (>= 2), Präfix bevorzugt", () => {
    const g = G("MO....", "......", "...ND.", "......", "......", "......");
    const run = L.bestPartialRun(g, "MOND");
    assert.deepEqual(run.cells, [idx(0, 0), idx(0, 1)]);
    assert.equal(run.from, 0);
    assert.equal(L.bestPartialRun(G("M.....", "......", "......", "......", "......", "......"), "MOND"), null, "1 Buchstabe ist kein Fortschritt");
    assert.equal(L.protectedCells(g, null).size, 0, "ohne Zielwort nichts geschützt");
  });

  test("kreuzendes kurzes Wort durch ein geschütztes Feld wird NICHT gelöscht (und pflanzt nichts)", () => {
    // MO steht in Zeile 1; Zeile 3 nach rechts -> senkrecht OHR in Spalte 2 durch das geschützte O
    const rows = ["MO....", ".H....", "R.....", "......", "......", "......"];
    const st = L.loadLevel(lvl(rows, "MOND"));
    const r = L.performSlide(st, "row", 2, 1);
    assert.equal(r.steps.length, 0, "OHR bleibt stehen");
    assert.deepEqual([idx(0, 0), idx(0, 1), idx(1, 1), idx(2, 1)].map((i) => st.grid[i]).join(""), "MOHR");
    assert.equal(L.countModifiers(st).stein + L.countModifiers(st).brunnen + L.countModifiers(st).trieb, 0);
    // Gegenprobe ohne Zielwort-Fortschritt: OHR wird gelöscht
    const free = L.loadLevel(lvl(rows, "ZZZZ"));
    const r2 = L.performSlide(free, "row", 2, 1);
    assert.equal(r2.steps.length, 1);
    assert.deepEqual(r2.steps[0].matches.map((m) => m.word), ["OHR"]);
  });

  test("kurzes Wort, das selbst Präfix des Zielworts in derselben Linie ist, bleibt als Fortschritt stehen", () => {
    const st = L.loadLevel(lvl(["ORQQQT", "......", "......", "......", "......", "......"], "TORAX"));
    const r = L.performSlide(st, "row", 0, 1); // -> TOR.. = Präfix von TORAX
    assert.equal(r.steps.length, 0);
    assert.equal(st.grid.slice(0, 3).join(""), "TOR");
    assert.deepEqual([...L.protectedCells(st.grid, "TORAX")], [idx(0, 0), idx(0, 1), idx(0, 2)]);
    // Vorschau / „Was passiert?“ benutzen dieselbe Regel: kein Modifikator angekündigt
    const st2 = L.loadLevel(lvl(["ORQQQT", "......", "......", "......", "......", "......"], "TORAX"));
    assert.equal(L.previewModifiers(st2, "row", 0, 1).placements.length, 0);
    assert.ok(!L.whatIf(st2).some((m) => m.axis === "row" && m.index === 0 && m.dir === 1));
  });

  test("Zielwort wird nie zerstört – auch wenn gleichzeitig ein kreuzendes kurzes Wort entsteht", () => {
    // Zeile 1 nach links -> MOND, gleichzeitig OHR senkrecht durch das O
    const st = L.loadLevel(lvl(["QMONDQ", ".H....", ".R....", "......", "......", "......"], "MOND"));
    const r = L.performSlide(st, "row", 0, -1);
    assert.ok(st.solved, "gelöst");
    assert.equal(r.steps.length, 0, "nichts gelöscht");
    assert.equal(st.grid.slice(0, 4).join(""), "MOND");
    assert.ok(L.findWords(st.grid).some((m) => m.word === "OHR"), "OHR kreuzt wirklich");
  });

  test("geschützter Fortschritt übersteht Kaskaden", () => {
    // M/O senkrecht in Spalte 1 (Zeilen 5–6) = Präfix MO. Runde 1 löscht TOR in Zeile 6,
    // H und R fallen nach -> Runde 2 sähe OHR durch das geschützte O: wird nicht gelöscht.
    const st = L.loadLevel(lvl(["......", "......", "......", "......", "MHR...", "OTOR.."], "MOND"));
    const steps = L.cascade(st);
    assert.ok(steps.length >= 1);
    assert.deepEqual(steps[0].matches.map((m) => m.word), ["TOR"]);
    assert.equal([idx(4, 0), idx(5, 0), idx(5, 1), idx(5, 2)].map((i) => st.grid[i]).join(""), "MOHR");
    for (const s of steps) assert.ok(!s.cleared.includes(idx(4, 0)) && !s.cleared.includes(idx(5, 0)), "M und O nie gelöscht");
    assert.ok(!steps.slice(1).some((s) => s.matches.some((m) => m.word === "OHR")));
  });

  test("Eigenschaft (Zufallsspiel in allen 12 Leveln): geschützte Felder und Zielwort werden nie gelöscht", () => {
    const rng = L.createRng(7);
    let rounds = 0;
    for (const lv of L.LEVELS) {
      const st = L.loadLevel(lv);
      for (let k = 0; k < 150; k++) {
        if (st.solved) L.reset(st);
        const axis = L.rngNext(rng) < 0.5 ? "row" : "col", index = Math.floor(L.rngNext(rng) * 6), dir = L.rngNext(rng) < 0.5 ? 1 : -1;
        if (!L.canSlide(st, axis, index)) continue;
        const r = L.performSlide(st, axis, index, dir);
        for (const s of r.steps) {
          rounds++;
          const prot = L.protectedCells(s.gridBefore, st.target);
          assert.ok(!s.cleared.some((i) => prot.has(i)), `Level ${lv.id}: geschütztes Feld gelöscht`);
          assert.equal(L.checkTargetWord(s.gridBefore, st.target), null, `Level ${lv.id}: Zielwort gelöscht`);
        }
      }
    }
    assert.ok(rounds > 50, "genug Lösch-Runden geprüft: " + rounds);
  });
});

test.describe("Vorschau", () => {
  test("previewModifiers entspricht exakt dem echten Zug und verändert nichts", () => {
    const st = L.startFree(1234);
    let checked = 0;
    for (let k = 0; k < 120 && checked < 15; k++) {
      const moves = L.allMoves(st);
      const mv = moves[(k * 7) % moves.length];
      const before = json(L.takeSnapshot(st));
      const pre = L.previewModifiers(st, mv.axis, mv.index, mv.dir);
      assert.deepEqual(json(L.takeSnapshot(st)), before, "Vorschau ändert den Zustand nicht");
      const res = L.performSlide(st, mv.axis, mv.index, mv.dir);
      const real = res.steps.flatMap((s) => s.placed.map((p) => ({ ...p, level: s.level })));
      assert.deepEqual(json(pre.placements), json(real));
      if (real.length) checked++;
    }
    assert.ok(checked >= 5, `genug Züge mit Modifikatoren geprüft (${checked})`);
  });
  test("whatIf listet nur Züge mit Modifikatoren", () => {
    const st = L.loadLevel(lvl(["......", "......", "......", "......", "ORQ..T", "......"]));
    const list = L.whatIf(st);
    assert.ok(list.length >= 1);
    assert.ok(list.every((m) => m.placements.length > 0));
    assert.ok(list.some((m) => m.axis === "row" && m.index === 4 && m.dir === 1));
  });
});

test.describe("Hinweise", () => {
  test("3 Hinweise pro Level, jeder deckt einen anderen Buchstaben auf, dann keiner mehr", () => {
    const st = L.loadLevel(1);
    const hs = [L.useHint(st), L.useHint(st), L.useHint(st)];
    assert.ok(hs.every(Boolean));
    assert.equal(new Set(hs.map((h) => h.index)).size, 3);
    for (const h of hs) assert.equal(h.letter, st.target[h.index]);
    assert.match(hs[0].text, /Das Wort enthält ein [A-Z]/);
    assert.match(hs[0].text, /(oberen|unteren) Hälfte/);
    assert.equal(L.useHint(st), null);
    assert.equal(st.hintsUsed, 3);
  });
  test("Hinweis nennt einen fehlenden Buchstaben (nicht schon richtig liegende)", () => {
    const st = L.loadLevel(1); // Zeile 1: EWAERM -> beste Ausrichtung nach Verschieben
    const al = L.bestAlignment(st.grid, st.target);
    const h = L.useHint(st);
    assert.equal(al.matched[h.index], false);
  });
  test("−20 % pro Hinweis; Hinweise bleiben bei Reset und Undo verbraucht", () => {
    const st = L.loadLevel(1);
    L.useHint(st);
    L.performSlide(st, "row", 1, 1);
    L.undo(st);
    L.reset(st);
    assert.equal(st.hintsUsed, 1);
    L.performSlide(st, "row", 0, -1);
    assert.ok(st.solved);
    assert.equal(st.levelPoints, 48);
  });
  test("kein Hinweis im Freien Spiel", () => {
    assert.equal(L.useHint(L.startFree(1)), null);
  });
});

test.describe("Undo / Reset", () => {
  test("Undo stellt Grid, Punkte, Züge, Modifikatoren, Triebe und PRNG exakt wieder her", () => {
    const st = L.startFree(77);
    let undone = 0;
    for (let k = 0; k < 200 && undone < 5; k++) {
      const moves = L.allMoves(st);
      const mv = moves[(k * 5) % moves.length];
      const before = json(L.takeSnapshot(st));
      const res = L.performSlide(st, mv.axis, mv.index, mv.dir);
      if (!res.steps.some((s) => s.placed.length)) continue;
      assert.ok(L.undo(st));
      assert.deepEqual(json(L.takeSnapshot(st)), before);
      // gleicher Zug nach Undo -> identisches Ergebnis
      const again = L.performSlide(st, mv.axis, mv.index, mv.dir);
      assert.deepEqual(json(again.steps.map((s) => s.placed)), json(res.steps.map((s) => s.placed)));
      undone++;
    }
    assert.equal(undone, 5);
  });
  test("History hält >= 20 Schritte", () => {
    const st = L.startFree(5);
    for (let k = 0; k < 30; k++) { const m = L.allMoves(st); const mv = m[k % m.length]; L.performSlide(st, mv.axis, mv.index, mv.dir); }
    assert.ok(st.history.length >= 20);
  });
  test("Reset -> Level-Grid, keine Modifikatoren, 0 Züge", () => {
    const st = L.loadLevel(4);
    for (const s of L.levelById(4).solution.slice(0, 2)) { const mv = require("../tools/level-tools.js").decode(s); L.performSlide(st, mv.axis, mv.index, mv.dir); }
    L.reset(st);
    assert.deepEqual(st.grid, L.normalizeGrid(L.levelById(4).grid));
    assert.ok(st.cellMod.every((x) => x === null) && st.sprout.every((x) => !x));
    assert.equal(st.moves, 0);
    assert.equal(st.history.length, 0);
  });
});

test.describe("Level, Modi, Teilen", () => {
  test("loadLevel / nextLevel: Gesamtpunkte werden übernommen, nach dem letzten Level null", () => {
    const st = L.loadLevel(1, { totalScore: 100 });
    assert.equal(st.score, 100);
    L.performSlide(st, "row", 0, -1);
    assert.equal(st.score, 160);
    const nx = L.nextLevel(st);
    assert.equal(nx.level.id, 2);
    assert.equal(nx.score, 160);
    assert.equal(L.nextLevel(L.loadLevel(L.LEVELS.length)), null);
    assert.throws(() => L.loadLevel(999));
  });
  test("Tagesrätsel: gleiches Datum -> gleiches Level, Nummer ab 2026-01-01", () => {
    const a = L.startDaily(new Date(2026, 10, 22)), b = L.startDaily(new Date(2026, 10, 22));
    assert.equal(a.level.id, b.level.id);
    assert.equal(a.puzzleNumber, 326);
    const ids = new Set(Array.from({ length: 40 }, (_, d) => L.startDaily(new Date(2026, 0, 1 + d)).level.id));
    assert.ok(ids.size >= 6, "über die Tage wechseln die Level");
  });
  test("Freies Spiel: wortfreies Zufallsbrett, alle Modifikatoren, kein Zielwort, Seed reproduzierbar", () => {
    const a = L.startFree(9), b = L.startFree(9);
    assert.deepEqual(a.grid, b.grid);
    assert.equal(L.findShortWords(a.grid).length, 0);
    assert.equal(a.target, null);
    assert.deepEqual(a.enabled, { stein: true, brunnen: true, trieb: true });
  });
  test("Teilen-Text: „Wortgarten Level X · Y Punkte · Z Züge“", () => {
    const st = L.loadLevel(1);
    L.performSlide(st, "row", 0, -1);
    assert.equal(L.buildShareText(st), "Wortgarten Level 1 · 60 Punkte · 1 Zug");
    const d = L.startDaily(new Date(2026, 10, 22));
    assert.match(L.buildShareText(d), /^Wortgarten Tagesrätsel #326 · Level \d+ · 0 Punkte · 0 Züge$/);
    assert.ok(!L.buildShareText(st).includes(st.target), "kein Spoiler");
  });
  test("Modifikator-Zähler „Stein | Brunnen | Trieb“", () => {
    const st = L.startFree(3);
    st.cellMod[0] = "stein"; st.cellMod[1] = "brunnen"; st.sprout[2] = true; st.cellMod[3] = "stein";
    assert.deepEqual(L.countModifiers(st), { stein: 2, brunnen: 1, trieb: 1 });
  });
});
