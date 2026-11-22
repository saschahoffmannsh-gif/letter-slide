// Tests für das geführte Tutorial (src/tutorial.js): jedes Skript wird mit der echten Logik
// (geseedetes Nachfüllen, Schutz-Regel, Kaskaden) Schritt für Schritt nachgespielt.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/logic.js");
const Tut = require("../src/tutorial.js");
const T = require("../tools/level-tools.js");

const ANCHOR = /^(target|hint-text|slots|score|board|center|letters|protected|btn:hint|arrow:[RC][1-6][+-]|row:[0-5]|col:[0-5]|tile:[0-5],[0-5])$/;

test("Lehr-Level 1, 2, 3 haben ein Skript; Anker und Züge sind gültig", () => {
  assert.deepEqual(Tut.levelIds(), [1, 2, 3]);
  for (const id of Tut.levelIds()) {
    const s = Tut.scriptFor(id);
    for (const step of [...s.steps, ...(s.afterSolve || [])]) {
      assert.match(step.anchor, ANCHOR, `Level ${id}: Anker ${step.anchor}`);
      for (const f of step.focus || []) assert.match(f, ANCHOR);
      assert.ok(step.text && step.text.length < 280, "kurzer Text");
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

test("Level 1: Skript löst WAERME mit 1 Zug, 60 Punkte; Score-Text ohne Brunnen", () => {
  const { state } = Tut.replay(L, 1);
  assert.equal(state.solved.word, "WAERME");
  assert.equal(state.moves, 1);
  assert.equal(state.levelPoints, 60);
  const scoreStep = Tut.scriptFor(1).afterSolve.find((s) => s.anchor === "score");
  assert.ok(scoreStep && !/Brunnen|Stein|Trieb/i.test(scoreStep.text));
});

test("Level 2: Skript führt jeden Zug der Referenzlösung bis zum senkrechten MOND", () => {
  const { state } = Tut.replay(L, 2);
  assert.equal(state.solved.word, "MOND");
  assert.equal(state.solved.axis, "col");
  assert.equal(state.moves, L.levelById(2).solution.length);
});

test("Level 2: erster Zug lässt kurze Wörter zerbröseln; Zielbuchstaben bleiben, Text erklärt den Schutz", () => {
  const st = L.loadLevel(2);
  const before = L.neededCells(st.grid, st.target);
  assert.equal(before.size, st.target.length);
  const mv = Tut.decodeMove(Tut.scriptedMoves(2)[0]);
  const r = L.performSlide(st, mv.axis, mv.index, mv.dir);
  assert.ok(Tut.wordsOf(r).length >= 1);
  assert.ok(L.neededCells(st.grid, st.target).size >= st.target.length);
  const prot = Tut.scriptFor(2).steps.find((s) => s.anchor === "protected");
  assert.match(prot.text, /zerbröseln nie und bleiben stehen/);
});

test("Level 3: 1–2 Schubser, dann freies Spiel – Rest der Referenzlösung löst", () => {
  const moves = Tut.scriptedMoves(3);
  assert.ok(moves.length >= 1 && moves.length <= 2);
  const { state } = Tut.replay(L, 3);
  assert.ok(!state.solved);
  const rest = T.replay(L.levelById(3), L.levelById(3).solution.slice(moves.length), state);
  assert.ok(rest.state.solved, "nach den Schubsern noch lösbar");
});

test("{words} wird durch die kurzen Wörter des letzten Zugs ersetzt", () => {
  const st = L.loadLevel(2);
  const mv = Tut.decodeMove("R1+");
  const r = L.performSlide(st, mv.axis, mv.index, mv.dir);
  const txt = Tut.fillText("Wörter: {words}", { lastResult: r });
  assert.match(txt, /^Wörter: [A-Z]+(, [A-Z]+)*$/);
});
