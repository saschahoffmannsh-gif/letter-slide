/*
 * Wortgarten – Level-Generator (Entwickler-Hilfe, Node)
 * =====================================================
 * Baut Kandidaten-Grids für vorgegebene Zielwörter/Hinweise: Zielwort in ein Zufallsbrett setzen,
 * mit zufälligen Rück-Zügen verwürfeln, dann mit dem Löser (echte Spielregeln) prüfen, dass
 * die Bedingungen des Levels erfüllt sind (Lösungslänge).
 * Ausgabe: JSON der gefundenen Level -> von Hand geprüft und in src/levels.js übernommen.
 *   node tools/generate-levels.js 4      # nur Level 4
 */
"use strict";
const T = require("./level-tools.js");
const L = T.L;

const SPECS = [
  { id: 1, hint: "etwas Warmes", target: "WAERME", kind: "rotate" },
  { id: 2, hint: "leuchtet in der Nacht", target: "MOND", kind: "exact", scramble: [3, 4], min: [3, 4] },
  { id: 3, hint: "ein Tier", target: "KATZE", kind: "exact", scramble: [6, 7], min: [6, 8], touch: true, tries: 60 },
  { id: 4, hint: "wächst im Garten", target: "BLUME", scramble: [4, 5], len: [4, 7] },
  { id: 5, hint: "macht den Garten nass", target: "REGEN", scramble: [5, 6], len: [5, 7] },
  { id: 6, hint: "hat Wurzeln und Blätter", target: "BAUM", scramble: [5, 6], len: [5, 8] },
  { id: 7, hint: "ein Getränk", target: "WASSER", scramble: [4, 5], len: [4, 8] },
  { id: 8, hint: "scheint am Himmel", target: "SONNE", scramble: [5, 6], len: [5, 8] },
  { id: 9, hint: "ein Getränk am Morgen", target: "KAFFEE", scramble: [5, 7], len: [5, 9] },
  { id: 10, hint: "ein Ort voller Pflanzen", target: "GARTEN", scramble: [5, 6], len: [5, 9] },
  { id: 11, hint: "ein schlaues Tier", target: "FUCHS", scramble: [6, 7], len: [6, 10] },
  { id: 12, hint: "eine Jahreszeit", target: "WINTER", scramble: [6, 8], len: [6, 10] }
];

const rng = L.createRng(Number(process.env.SEED || 20261122));
const rnd = (n) => Math.floor(L.rngNext(rng) * n);
const FILL = "EEEENNNIIISSSRRRAAATTTDDHHUULLCGGMOOBWFKZP"; // gängige Buchstaben, keine seltenen

function randomGrid(target, axis, line, start) {
  const g = Array.from({ length: 36 }, () => FILL[rnd(FILL.length)]);
  const cells = L.lineCells(axis, line).slice(start, start + target.length);
  cells.forEach((c, k) => { g[c] = target[k]; });
  return g;
}
const toRows = (g) => Array.from({ length: 6 }, (_, r) => g.slice(r * 6, r * 6 + 6).join(""));
function scramble(g, k) {
  let last = null, moves = [];
  for (let n = 0; n < k; n++) {
    let mv;
    do { mv = { axis: rnd(2) ? "row" : "col", index: rnd(6), dir: rnd(2) ? 1 : -1 }; }
    while (last && mv.axis === last.axis && mv.index === last.index);
    g = L.slideLine(g, mv.axis, mv.index, mv.dir);
    moves.push(mv); last = mv;
  }
  return { g, moves };
}
/** Verwürfeln mit Zügen, die jeweils eine Linie mit Zielwort-Buchstaben treffen (verschiedene Linien). */
function scrambleTouching(g, k, targetCells) {
  let cells = targetCells.slice(), moves = [], used = new Set();
  for (let n = 0; n < k; n++) {
    let mv, tries = 0;
    do {
      const c = cells[rnd(cells.length)];
      const axis = rnd(2) ? "row" : "col";
      mv = { axis, index: axis === "row" ? L.rowOf(c) : L.colOf(c), dir: rnd(2) ? 1 : -1 };
    } while (used.has(mv.axis + mv.index) && ++tries < 50);
    used.add(mv.axis + mv.index);
    // Zielwort-Zellen mitverfolgen
    const line = L.lineCells(mv.axis, mv.index);
    cells = cells.map((c) => { const p = line.indexOf(c); return p < 0 ? c : line[(p + mv.dir + 6) % 6]; });
    g = L.slideLine(g, mv.axis, mv.index, mv.dir);
    moves.push(mv);
  }
  return { g, moves };
}
const mk = (spec, g) => ({ id: spec.id, hint: spec.hint, length: spec.target.length, target: spec.target, grid: toRows(g) });

function attempt(spec) {
  const t = spec.target;
  if (spec.kind === "rotate") {
    const g = randomGrid(t, "row", 0, 0);
    const row = [t[t.length - 1], ...t.slice(0, -1)]; // eins nach rechts rotiert -> 1× nach links schieben
    row.forEach((ch, c) => { g[c] = ch; });
    const lv = mk(spec, g);
    if (L.validateLevel(lv).length) return null;
    const sol = T.minSolution(lv, 1);
    return sol && sol.depth === 1 ? { level: lv, solution: sol.moves, minimal: 1 } : null;
  }
  const axis = rnd(2) ? "row" : "col", line = rnd(6), start = rnd(6 - t.length + 1);
  const [a, b] = spec.scramble;
  const solvedG = randomGrid(t, axis, line, start);
  const { g, moves } = spec.touch ? scrambleTouching(solvedG, a + rnd(b - a + 1), L.lineCells(axis, line).slice(start, start + t.length)) : scramble(solvedG, a + rnd(b - a + 1));
  const lv = mk(spec, g);
  if (L.validateLevel(lv).length) return null;
  if (spec.kind === "exact") {
    const [lo, hi] = spec.min;
    if (T.minSolution(lv, lo - 1)) return null;                 // nichts Kürzeres als lo
    // Referenzlösung = Verwürfel-Züge rückwärts (per replay unter echten Regeln geprüft)
    const inverse = moves.slice().reverse().map((m) => T.encode({ ...m, dir: -m.dir }));
    const rp = T.replay(lv, inverse);
    const sol = rp.state.solved ? { moves: rp.log.map((x) => x.move), depth: rp.log.length }
      : lo - 1 >= 5 ? T.beamSolve(lv, { maxDepth: hi, beam: 4000 }) : T.minSolution(lv, hi);
    return sol && sol.depth >= lo && sol.depth <= hi ? { level: lv, solution: sol.moves, minimal: `>= ${lo}` } : null;
  }
  // spätere Level: nicht trivial, Lösung in der gewünschten Zugspanne
  if (T.minSolution(lv, 2)) return null;
  const sol = T.beamSolve(lv, { maxDepth: spec.len[1], beam: 1500 });
  return sol && sol.depth >= spec.len[0] ? { level: lv, solution: sol.moves } : null;
}

const only = process.argv[2] ? Number(process.argv[2]) : null;
const out = [];
for (const spec of SPECS) {
  if (only && spec.id !== only) continue;
  let res = null, tries = 0;
  const t0 = Date.now();
  while (!res && tries < (spec.tries || 400)) { tries++; res = attempt(spec); }
  console.error(`Level ${spec.id}: ${res ? "OK" : "nicht gefunden"} nach ${tries} Versuchen, ${((Date.now() - t0) / 1000).toFixed(1)} s` + (res ? ` – Lösung ${res.solution.length} Züge` : ""));
  if (res) out.push(res);
}
console.log(JSON.stringify(out, null, 1));
