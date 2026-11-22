/*
 * Wortgarten – GEFÜHRTES TUTORIAL („Lehr-Level“)
 * ===============================================
 * Reine Daten + kleine Helfer (kein DOM, in Node ladbar). Die Anzeige (Sprechblase, Abdunkeln,
 * Puls) macht src/coach.js, den Ablauf steuert src/main.js.
 *
 * Ein Skript pro Lehr-Level: { covers, steps, afterSolve }
 *   covers      Tipp-Popups (main.js TIPS), die das Skript ersetzt – werden nach dem Durchlauf als gesehen markiert
 *   steps       Schritte beim Levelstart, nacheinander
 *   afterSolve  Schritte nach dem Lösen (vor dem Abschluss-Dialog)
 *
 * Schritt: { text, anchor, focus?, move?, tap?, button?, needs? }
 *   text    kurzer deutscher Text (HTML erlaubt); {words} = kurze Wörter des letzten Zugs
 *   anchor  worauf die Sprechblase zeigt (siehe ANCHORS unten)
 *   focus   weitere Bereiche, die NICHT abgedunkelt werden (Liste von Ankern)
 *   move    "R1-" | "C3+" …: nur genau dieser Slide ist erlaubt (Pfeil ODER Wischen), dann weiter
 *   tap     "whatif" | "hint" | "preview": nur dieser Knopf ist erlaubt, danach weiter
 *   button  Beschriftung des Weiter-Knopfs bei Info-Schritten (Standard „Weiter“)
 *   needs   Bedingung, die beim Erreichen des Schritts gelten muss (prüft tests/tutorial.test.js):
 *           "protected" | "words" | "solved"
 *
 * ANCHORS: target, hint-text, slots, score, board, center, letters, protected,
 *          arrow:R1- (Randpfeil des Zugs), row:0, col:5, tile:r,c, btn:hint
 * Züge: R = Zeile, C = Spalte, Nummer 1–6, "+" = rechts/unten, "-" = links/oben.
 * Alle Züge sind Präfixe der Referenzlösungen in src/levels.js -> deterministisch (geseedetes Nachfüllen).
 */
(function (root) {
  "use strict";

  const SCRIPTS = {
    1: {
      covers: ["intro1"],
      steps: [
        { anchor: "hint-text", text: "Willkommen im <b>Wortgarten</b>! Hier steht dein Hinweis: <b>„etwas Warmes“</b> – und wie lang das gesuchte Wort ist: <b>6 Buchstaben</b>." },
        { anchor: "slots", text: "Jeder Strich ist ein Buchstabe des Zielworts. Stehen schon richtige Buchstaben am Stück im Brett, erscheinen sie hier zart – das ist dein Fortschritt." },
        { anchor: "arrow:R1-", focus: ["row:0", "arrow:R1+"], text: "So schiebst du: Ein Pfeil am Rand rückt die ganze <b>Zeile</b> um ein Feld. Was hinausfällt, kommt auf der anderen Seite wieder herein." },
        { anchor: "row:0", text: "Oder du <b>wischst</b> direkt auf einer Kachel nach links oder rechts. Nach oben oder unten wischen schiebt die <b>Spalte</b>." },
        { anchor: "arrow:R1-", focus: ["row:0"], move: "R1-", text: "Schau dir Zeile 1 an: <b>E W A E R M</b>. Schieb sie <b>nach links</b> – tippe auf ← oder wische nach links." }
      ],
      afterSolve: [
        { anchor: "row:0", needs: "solved", text: "Geschafft! <b>WAERME</b> steht am Stück – das Zielwort blüht auf. 🌸" },
        { anchor: "score", text: "Punkte: <b>6 Buchstaben × 10 = 60</b>. Kaskaden erhöhen sie, jeder Hinweis kostet 20 %.", button: "Super!" }
      ]
    },
    2: {
      covers: ["protect"],
      steps: [
        { anchor: "col:5", text: "Neues Ziel, 4 Buchstaben. Wörter zählen auch <b>senkrecht</b> – von oben nach unten gelesen, wie in dieser Spalte." },
        { anchor: "arrow:R1+", focus: ["row:0"], move: "R1+", text: "Los geht's: Schieb <b>Zeile 1 nach rechts</b> (Pfeil → oder nach rechts wischen)." },
        { anchor: "board", needs: "words", text: "Hoppla: Dabei sind kurze Wörter entstanden (<b>{words}</b>). Kurze Wörter (3–5 Buchstaben) <b>zerbröseln</b>, von oben fällt Neues nach – das Brett verändert sich." },
        { anchor: "protected", focus: ["slots"], needs: "protected", text: "Die hellen, <b>lila unterstrichenen</b> Kacheln gehören zu deinem Zielwort. <b>Zielwort-Buchstaben zerbröseln nie und bleiben stehen</b> – auch einzelne. In den Slots siehst du den Fortschritt am Stück zart." },
        { anchor: "arrow:C1-", focus: ["col:0"], move: "C1-", text: "Jetzt <b>Spalte 1 nach oben</b> (Pfeil ↑ oder nach oben wischen)." },
        { anchor: "arrow:R3-", focus: ["row:2", "col:5"], move: "R3-", text: "Und zum Schluss <b>Zeile 3 nach links</b> – achte auf die rechte Spalte!" }
      ],
      afterSolve: [
        { anchor: "col:5", needs: "solved", text: "<b>MOND</b> – senkrecht gelöst! Merke: Schützen, schieben, und kurze Wörter bewusst einsetzen.", button: "Weiter" }
      ]
    },
    3: {
      covers: [],
      steps: [
        { anchor: "letters", text: "Diesmal sind die Buchstaben <b>verstreut</b>. Die hellen Kacheln gehören zum Zielwort (je einer pro Buchstabe)." },
        { anchor: "arrow:R5+", focus: ["row:4"], move: "R5+", text: "Ein kleiner Schubs: <b>Zeile 5 nach rechts</b>." },
        { anchor: "arrow:R4+", focus: ["row:3"], move: "R4+", text: "Und <b>Zeile 4 nach rechts</b> – sieh danach oben in die Slots." },
        { anchor: "slots", focus: ["protected"], needs: "protected", text: "Die zarten Buchstaben in den Slots sind dein Fortschritt am Stück – und im Brett lila unterstrichen." },
        { anchor: "btn:hint", text: "Hängst du fest? Der <b>Hinweis</b> verrät einen fehlenden Buchstaben und wo er ungefähr liegt – kostet aber 20 % der Punkte. Ab jetzt bist du dran!", button: "Los geht's" }
      ]
    },
  };

  /** "R1-" -> { axis, index, dir } */
  function decodeMove(s) {
    const m = /^([RC])([1-6])([+-])$/.exec(s);
    if (!m) throw new Error("Ungültiger Zug: " + s);
    return { axis: m[1] === "R" ? "row" : "col", index: Number(m[2]) - 1, dir: m[3] === "+" ? 1 : -1 };
  }
  const scriptFor = (levelId) => SCRIPTS[levelId] || null;
  const levelIds = () => Object.keys(SCRIPTS).map(Number);
  /** Alle geforderten Züge eines Skripts (in Reihenfolge). */
  const scriptedMoves = (levelId) => (SCRIPTS[levelId] ? SCRIPTS[levelId].steps.filter((s) => s.move).map((s) => s.move) : []);
  /** Kurze Wörter des letzten Zugs (für {words}). */
  const wordsOf = (result) => (result ? [...new Set(result.steps.flatMap((st) => st.matches.map((m) => m.word)))] : []);
  function fillText(text, ctx) {
    return text.replace("{words}", wordsOf(ctx && ctx.lastResult).join(", ") || "–");
  }

  /** Prüft eine `needs`-Bedingung am Spielzustand (gemeinsam für Spiel und Tests). */
  function needsMet(Logic, need, state, lastResult) {
    if (!need) return true;
    if (need === "solved") return !!state.solved;
    if (need === "words") return wordsOf(lastResult).length > 0;
    if (need === "protected") return Logic.neededCells(state.grid, state.target).size > 0;
    return false;
  }

  /**
   * replay – spielt das Skript eines Levels mit der echten Logik durch (für Tests/Validierung).
   * @returns { state, problems[], phase } – problems leer = Skript ist stimmig
   */
  function replay(Logic, levelId) {
    const script = SCRIPTS[levelId];
    const state = Logic.loadLevel(levelId);
    const problems = [];
    let lastResult = null;
    const check = (step, k, where) => {
      if (!needsMet(Logic, step.needs, state, lastResult)) problems.push(`${where} Schritt ${k + 1}: Bedingung ${step.needs} nicht erfüllt`);
    };
    script.steps.forEach((step, k) => {
      check(step, k, "steps");
      if (step.move) {
        if (state.solved) { problems.push(`Schritt ${k + 1}: Level schon gelöst`); return; }
        const mv = decodeMove(step.move);
        if (!Logic.canSlide(state, mv.axis, mv.index)) problems.push(`Schritt ${k + 1}: Zug ${step.move} nicht möglich`);
        lastResult = Logic.performSlide(state, mv.axis, mv.index, mv.dir);
      }
    });
    (script.afterSolve || []).forEach((step, k) => {
      if (!state.solved) { problems.push("afterSolve ohne gelöstes Level"); return; }
      check(step, k, "afterSolve");
    });
    return { state, problems };
  }

  const api = { SCRIPTS, decodeMove, scriptFor, levelIds, scriptedMoves, wordsOf, fillText, needsMet, replay };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LetterSlideTutorial = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
