/*
 * Wortgarten – LEVEL-WERKZEUGE (Node, nicht Teil des Spiels)
 * ==========================================================
 * Löser für Level unter den ECHTEN Spielregeln (logic.js: Kaskaden, Schutz, PRNG-Nachfüllen).
 * Wird von tests/levels.test.js und tools/solve-level.js benutzt.
 *
 *   replay(level, moves)           Referenzlösung abspielen -> Endzustand
 *   minSolution(level, maxDepth)   kürzeste Lösung per iterativer Tiefensuche (exakt, exhaustiv)
 *   beamSolve(level, opts)         schnelle Suche (Beam) für längere Lösungen / mit Bedingungen
 * Züge werden als Strings notiert: "R3+" = Zeile 3 nach rechts, "C1-" = Spalte 1 nach oben
 * (Zeilen/Spalten 1-basiert wie im Spiel).
 */
"use strict";
const L = require("../src/logic.js");

const encode = (m) => `${m.axis === "row" ? "R" : "C"}${m.index + 1}${m.dir > 0 ? "+" : "-"}`;
const decode = (s) => {
  const m = /^([RC])([1-6])([+-])$/.exec(s);
  if (!m) throw new Error(`Ungültiger Zug: ${s}`);
  return { axis: m[1] === "R" ? "row" : "col", index: Number(m[2]) - 1, dir: m[3] === "+" ? 1 : -1 };
};
const keyOf = (s) => s.grid.join("") + s.rng.state;
const isInverse = (a, b) => a && b && a.axis === b.axis && a.index === b.index && a.dir === -b.dir;

/** Referenzlösung abspielen. @returns { state, log: [{ move, placed, words, solved }] } */
function replay(level, moves, startState = null) {
  const state = startState || L.loadLevel(level); // optional: von einem Zwischenstand aus weiterspielen
  const log = [];
  for (const s of moves) {
    const mv = decode(s);
    const res = L.performSlide(state, mv.axis, mv.index, mv.dir);
    if (!res) { log.push({ move: s, blocked: true }); break; }
    log.push({
      move: s, words: res.steps.flatMap((st) => st.matches.map((m) => m.word)),
      solved: !!state.solved
    });
    if (state.solved) break;
  }
  return { state, log };
}

/**
 * minSolution – kürzeste Lösung bis maxDepth (iterative Tiefensuche, direkte Rückzüge werden
 * übersprungen, bereits gesehene Zustände auf gleicher oder geringerer Tiefe ebenso).
 * @returns { moves, depth } oder null, wenn es bis maxDepth keine Lösung gibt
 */
function minSolution(level, maxDepth, cond = null) {
  const start = L.loadLevel(level);
  for (let depth = 0; depth <= maxDepth; depth++) {
    const seen = new Map();
    const path = [];
    const dfs = (st, d, last) => {
      if (st.solved) return !cond || cond(st);
      if (d === depth) return false;
      const k = keyOf(st);
      const prev = seen.get(k);
      if (prev !== undefined && prev <= d) return false;
      seen.set(k, d);
      for (const mv of L.allMoves(st)) {
        if (isInverse(mv, last)) continue;
        const sim = L.cloneState(st);
        L.performSlide(sim, mv.axis, mv.index, mv.dir, { record: false });
        path.push(mv);
        if (dfs(sim, d + 1, mv)) return true;
        path.pop();
      }
      return false;
    };
    if (dfs(start, 0, null)) return { moves: path.map(encode), depth };
  }
  return null;
}

/**
 * beamSolve – Beam-Suche: behält pro Tiefe die `beam` vielversprechendsten Zustände
 * (meiste Zielwort-Buchstaben an der besten Position, Bonus wenn `bonus(state)` > 0).
 * @param opts { maxDepth = 12, beam = 1500, cond(state) -> bool, bonus(state) -> Zahl }
 */
function beamSolve(level, opts = {}) {
  const { maxDepth = 12, beam = 1500, cond = null, bonus = null } = opts;
  const t = (typeof level === "object" ? level.target : L.levelById(level).target).toUpperCase();
  let frontier = [{ st: L.loadLevel(level), path: [] }];
  const seen = new Set([keyOf(frontier[0].st)]);
  for (let d = 1; d <= maxDepth; d++) {
    const next = [];
    for (const node of frontier) {
      for (const mv of L.allMoves(node.st)) {
        if (isInverse(mv, node.path[node.path.length - 1])) continue;
        const sim = L.cloneState(node.st);
        L.performSlide(sim, mv.axis, mv.index, mv.dir, { record: false });
        const path = node.path.concat(mv);
        if (sim.solved) { if (!cond || cond(sim)) return { moves: path.map(encode), depth: d, state: sim }; continue; }
        const k = keyOf(sim);
        if (seen.has(k)) continue;
        seen.add(k);
        const h = L.bestAlignment(sim.grid, t).count + (bonus ? bonus(sim) : 0) + Math.random() * 0.5;
        next.push({ st: sim, path, h });
      }
    }
    next.sort((a, b) => b.h - a.h);
    frontier = next.slice(0, beam);
    if (!frontier.length) break;
  }
  return null;
}

module.exports = { L, encode, decode, replay, minSolution, beamSolve, keyOf };
