// Tests für src/levels.js: Datenqualität, Progression und LÖSBARKEIT unter den echten Spielregeln.
// Löser/Replay: tools/level-tools.js. Vollständiger Beweis „Level 3 braucht >= 6 Züge“ (dauert ~1 min):
//   FULL=1 npm test
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../tools/level-tools.js");
const L = T.L;

const FEATURE = (id) => (id <= 3 ? null : id <= 6 ? "stein" : id <= 9 ? "brunnen" : "trieb");
const ENABLED = (id) => ({ stein: id >= 4, brunnen: id >= 7, trieb: id >= 10 });

test("12 Level, Ids fortlaufend, alle Daten gültig", () => {
  assert.equal(L.LEVELS.length, 12);
  L.LEVELS.forEach((lv, k) => {
    assert.equal(lv.id, k + 1);
    assert.deepEqual(L.validateLevel(lv), [], `Level ${lv.id}`);
    assert.ok(lv.length >= 4 && lv.length <= 6, "Länge 4–6 (7 passt nicht in ein 6×6-Brett)");
    assert.match(lv.target, /^[A-Z]+$/, "keine Umlaute");
  });
  assert.equal(new Set(L.LEVELS.map((l) => l.hint)).size, 12, "Hinweise abwechslungsreich");
  assert.ok(new Set(L.LEVELS.map((l) => l.length)).size >= 3, "verschiedene Längen");
});

test("Progression: 1–3 keine, 4–6 Stein, 7–9 Stein + Brunnen, 10–12 alle", () => {
  for (const lv of L.LEVELS) assert.deepEqual(lv.modifiersEnabled, ENABLED(lv.id), `Level ${lv.id}`);
});

test("jede Referenzlösung löst ihr Level unter den echten Regeln (inkl. Kaskaden)", () => {
  for (const lv of L.LEVELS) {
    const { state, log } = T.replay(lv, lv.solution);
    assert.ok(state.solved, `Level ${lv.id} gelöst`);
    assert.equal(log.length, lv.solution.length, `Level ${lv.id}: erst mit dem letzten Zug gelöst`);
    assert.ok(lv.solution.length <= 10, "vernünftige Zugzahl");
    assert.ok(state.levelPoints >= lv.length * 10);
  }
});

test("Level 4–12 nutzen in der Referenzlösung den neu eingeführten Modifikator", () => {
  for (const lv of L.LEVELS.filter((l) => l.id >= 4)) {
    const { state } = T.replay(lv, lv.solution);
    const f = FEATURE(lv.id);
    assert.ok(state.created[f] > 0, `Level ${lv.id}: ${f} entsteht`);
    if (f === "brunnen") assert.ok(state.solved.brunnen > 0, `Level ${lv.id}: Zielwort läuft durch einen Brunnen`);
  }
});

test("Level 1: genau 1 Slide (Löser)", () => {
  const lv = L.levelById(1);
  assert.equal(T.minSolution(lv, 0), null);
  assert.equal(T.minSolution(lv, 1).depth, 1);
});

test("Level 2: kürzeste Lösung 3–4 Slides (Löser, exhaustiv)", () => {
  const lv = L.levelById(2);
  const m = T.minSolution(lv, 4);
  assert.ok(m && m.depth >= 3 && m.depth <= 4, `kürzeste Lösung: ${m && m.depth}`);
});

test("Level 3: zerstreut – keine Lösung unter 4 Zügen (schnell), Referenz 6–8 Züge", () => {
  const lv = L.levelById(3);
  assert.equal(T.minSolution(lv, 3), null);
  assert.ok(lv.solution.length >= 6 && lv.solution.length <= 8);
});

test("Level 3: keine Lösung mit <= 5 Zügen (vollständiger Beweis, nur mit FULL=1)", { skip: !process.env.FULL }, () => {
  assert.equal(T.minSolution(L.levelById(3), 5), null);
});

test("Level 4–12 sind nicht trivial (keine Lösung mit <= 2 Zügen)", () => {
  for (const lv of L.LEVELS.filter((l) => l.id >= 4)) assert.equal(T.minSolution(lv, 2), null, `Level ${lv.id}`);
});

test("Undo während einer Lösung stellt Modifikatoren wieder her (Level 12)", () => {
  const lv = L.levelById(12);
  const st = L.loadLevel(lv);
  const snaps = [];
  for (const s of lv.solution.slice(0, -1)) {
    snaps.push(JSON.stringify(L.takeSnapshot(st)));
    const mv = T.decode(s);
    L.performSlide(st, mv.axis, mv.index, mv.dir);
  }
  assert.ok(L.countModifiers(st).stein + L.countModifiers(st).trieb > 0);
  while (snaps.length) { assert.ok(L.undo(st)); assert.equal(JSON.stringify(L.takeSnapshot(st)), snaps.pop()); }
});
