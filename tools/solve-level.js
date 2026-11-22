/*
 * Wortgarten – Level prüfen und lösen (Node)
 *   node tools/solve-level.js 4          # Level 4 prüfen, Referenzlösung abspielen, Lösung suchen
 *   node tools/solve-level.js 4 --min 5  # zusätzlich: gibt es eine Lösung mit <= 5 Zügen? (exhaustiv, kann dauern)
 */
"use strict";
const T = require("./level-tools.js");
const L = T.L;

const id = Number(process.argv[2]);
const minArg = process.argv.indexOf("--min");
const level = L.levelById(id);
if (!level) { console.error("Aufruf: node tools/solve-level.js <level-id> [--min N]"); process.exit(1); }

console.log(`Level ${id}: ${level.target} („${level.hint}“), Modifikatoren: ${Object.entries(level.modifiersEnabled).filter(([, v]) => v).map(([k]) => k).join(", ") || "keine"}`);
const problems = L.validateLevel(level);
console.log(problems.length ? "Probleme:\n  - " + problems.join("\n  - ") : "Grid ok (kein Zielwort, keine kurzen Wörter, alle Buchstaben vorhanden)");
if (level.solution) {
  const r = T.replay(level, level.solution);
  console.log(`Referenzlösung ${level.solution.join(" ")}: ${r.state.solved ? `gelöst in ${r.state.moves} Zügen, ${r.state.levelPoints} Punkte` : "LÖST DAS LEVEL NICHT"}`);
  for (const step of r.log) if (step.words && step.words.length) console.log(`  ${step.move}: ${step.words.join(", ")} -> ${step.placed.map((p) => p.type).join(", ") || "kein Modifikator"}`);
}
const found = T.beamSolve(level, { maxDepth: 12, beam: 1500 });
console.log(found ? `Gefundene Lösung (${found.depth} Züge): ${found.moves.join(" ")}` : "Keine Lösung bis 12 Züge gefunden");
if (minArg > 0) {
  const n = Number(process.argv[minArg + 1]);
  const m = T.minSolution(level, n);
  console.log(m ? `Kürzeste Lösung: ${m.depth} Züge (${m.moves.join(" ")})` : `Keine Lösung mit <= ${n} Zügen`);
}
