// Tests für das geführte Tutorial (src/tutorial.js): jedes Skript wird mit der echten Logik
// (geseedetes Nachfüllen, Schutz-Regel, Kaskaden) Schritt für Schritt nachgespielt.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/logic.js");
const Tut = require("../src/tutorial.js");
const T = require("../tools/level-tools.js");

const ANCHOR = /^(target|hint-text|slots|score|board|center|letters|protected|btn:(hint|preview|whatif)|mod:(stein|brunnen|trieb)|arrow:[RC][1-6][+-]|row:[0-5]|col:[0-5]|tile:[0-5],[0-5])$/;
const FEATURE = { 4: "stein", 7: "brunnen", 10: "trieb" };

test("Lehr-Level 1, 2, 3, 4, 7, 10 haben ein Skript; Anker und Züge sind gültig", () => {
  assert.deepEqual(Tut.levelIds(), [1, 2, 3, 4, 7, 10]);
  for (const id of Tut.levelIds()) {
    const s = Tut.scriptFor(id);
    for (const step of [...s.steps, ...(s.afterSolve || [])]) {
      assert.match(step.anchor, ANCHOR, `Level ${id}: Anker ${step.anchor}`);
      for (const f of step.focus || []) assert.match(f, ANCHOR);
      assert.ok(step.text && step.text.length < 260, "kurzer Text");
      if (step.move) assert.equal(step.anchor, "arrow:" + step.move, "Zug-Schritt zeigt auf seinen Pfeil");
      assert.ok(!(step.move && step.tap));
    }
  }
});

test("geforderte Züge sind ein Präfix der Referenzlösung (deterministisch, Level bleibt lösbar)", () => {
  for (const id of Tut.levelIds()) {
    const moves = Tut.scriptedMoves(id);
    assert.deepEqual(moves, L.levelById(id).solution.slice(0, moves.length), `Level ${id}`);
  }
});

test("jedes Skript läuft stimmig durch (alle Bedingungen erfüllt)", () => {
  for (const id of Tut.levelIds()) assert.deepEqual(Tut.replay(L, id).problems, [], `Level ${id}`);
});

test("Level 1: Skript löst WAERME mit 1 Zug, 60 Punkte", () => {
  const { state } = Tut.replay(L, 1);
  assert.equal(state.solved.word, "WAERME");
  assert.equal(state.moves, 1);
  assert.equal(state.levelPoints, 60);
});

test("Level 2: Skript führt jeden Zug der Referenzlösung bis zum senkrechten MOND", () => {
  const { state } = Tut.replay(L, 2);
  assert.equal(state.solved.word, "MOND");
  assert.equal(state.solved.axis, "col");
  assert.equal(state.moves, L.levelById(2).solution.length);
});

test("Level 2: erster Zug lässt kurze Wörter zerbröseln, danach ist Fortschritt geschützt", () => {
  const st = L.loadLevel(2);
  const mv = Tut.decodeMove(Tut.scriptedMoves(2)[0]);
  const r = L.performSlide(st, mv.axis, mv.index, mv.dir);
  assert.ok(Tut.wordsOf(r).length >= 1);
  assert.ok(L.protectedCells(st.grid, st.target).size >= 2);
});

test("Level 3: 1–2 Schubser, dann freies Spiel – Rest der Referenzlösung löst", () => {
  const moves = Tut.scriptedMoves(3);
  assert.ok(moves.length >= 1 && moves.length <= 2);
  const { state } = Tut.replay(L, 3);
  assert.ok(!state.solved);
  const rest = T.replay(L.levelById(3), L.levelById(3).solution.slice(moves.length), state);
  assert.ok(rest.state.solved, "nach den Schubsern noch lösbar");
});

for (const [id, type] of Object.entries(FEATURE)) {
  test(`Level ${id}: geführter Zug erzeugt den ersten ${type}, Level bleibt lösbar`, () => {
    const { state } = Tut.replay(L, Number(id));
    assert.ok(state.created[type] >= 1, `${type} entstanden`);
    assert.ok(!state.solved);
    const lv = L.levelById(Number(id));
    const rest = T.replay(lv, lv.solution.slice(Tut.scriptedMoves(Number(id)).length), state);
    assert.ok(rest.state.solved, "Rest der Referenzlösung löst");
  });
}

test("Level 4: Skript zeigt Vorschau-Auge und verlangt „Was passiert?“", () => {
  const steps = Tut.scriptFor(4).steps;
  assert.ok(steps.some((s) => s.anchor === "btn:preview"));
  assert.ok(steps.some((s) => s.tap === "whatif"));
  // Vorschau sagt den Stein vor dem Zug voraus (gleiche Regel wie das Spiel)
  const st = L.loadLevel(4);
  const [m1, m2] = Tut.scriptedMoves(4).map(Tut.decodeMove);
  L.performSlide(st, m1.axis, m1.index, m1.dir);
  const pv = L.previewModifiers(st, m2.axis, m2.index, m2.dir);
  assert.ok(pv.placements.some((p) => p.type === "stein"));
});

test("{words} wird durch die kurzen Wörter des letzten Zugs ersetzt", () => {
  const st = L.loadLevel(2);
  const mv = Tut.decodeMove("R1+");
  const r = L.performSlide(st, mv.axis, mv.index, mv.dir);
  const txt = Tut.fillText("Wörter: {words}", { lastResult: r });
  assert.match(txt, /^Wörter: [A-Z]+(, [A-Z]+)*$/);
});
