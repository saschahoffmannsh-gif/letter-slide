/*
 * Wortgarten – LEVEL  >>> HIER NEUE LEVEL ANHÄNGEN <<<
 * =====================================================
 * Jedes Level-Objekt:
 *   id               fortlaufende Nummer (1, 2, 3 …)
 *   hint             Hinweis-Thema, z. B. "etwas Warmes"
 *   length           Länge des Zielworts
 *   target           Zielwort, nur A–Z (Umlaute ausschreiben: WÄRME -> WAERME)
 *   grid             6 Zeilen à 6 Buchstaben (Zeile 1 = oben)
 *   modifiersEnabled { stein, brunnen, trieb } – welche Modifikatoren in diesem Level entstehen
 *   solution         Referenzlösung (nur für Tests): "R1-" = Zeile 1 nach links, "C3+" = Spalte 3 nach unten
 *
 * Regeln für ein gutes Level (prüft tests/levels.test.js automatisch):
 *   - Start-Grid enthält weder das Zielwort noch kurze Wörter (3–5 Buchstaben).
 *   - Alle Buchstaben des Zielworts kommen im Grid vor.
 *   - Die Referenzlösung löst das Level unter den echten Spielregeln (inkl. Kaskaden).
 * Neues Level prüfen/lösen lassen: node tools/solve-level.js <id>
 *
 * Progression (Spec): 1–3 nur Zielwort (1 / 3 / 6 Züge), 4–6 Stein, 7–9 Stein + Brunnen,
 * 10–12 alle drei. Die Referenzlösungen ab Level 4 benutzen den jeweils neuen Modifikator.
 */
(function (root) {
  "use strict";

  const LEVELS = [
    // Level 1 – Tutorial: Zielwort fast fertig in Zeile 1 – genau 1 Slide
    {
      id: 1, hint: "etwas Warmes", length: 6, target: "WAERME",
      grid: [
        ["E", "W", "A", "E", "R", "M"],
        ["R", "A", "U", "A", "O", "C"],
        ["N", "C", "L", "N", "G", "D"],
        ["I", "P", "N", "S", "R", "L"],
        ["A", "S", "C", "I", "S", "H"],
        ["B", "R", "B", "K", "I", "R"]
      ],
      modifiersEnabled: { stein: false, brunnen: false, trieb: false },
      solution: ["R1-"]
    },
    // Level 2 – Tutorial: Zielwort auf zwei Reihen verteilt – mindestens 3 Slides
    {
      id: 2, hint: "leuchtet in der Nacht", length: 4, target: "MOND",
      grid: [
        ["E", "E", "H", "S", "M", "S"],
        ["A", "I", "B", "I", "E", "O"],
        ["C", "E", "S", "S", "G", "E"],
        ["N", "Z", "L", "O", "C", "D"],
        ["U", "O", "K", "E", "G", "E"],
        ["E", "L", "R", "L", "H", "L"]
      ],
      modifiersEnabled: { stein: false, brunnen: false, trieb: false },
      solution: ["R1+", "C1-", "R3-"]
    },
    // Level 3 – Tutorial: Zielwort zerstreut – mindestens 6 Slides
    {
      id: 3, hint: "ein Tier", length: 5, target: "KATZE",
      grid: [
        ["L", "I", "T", "E", "R", "E"],
        ["I", "S", "U", "K", "U", "E"],
        ["R", "L", "R", "G", "D", "T"],
        ["E", "A", "E", "E", "R", "G"],
        ["D", "T", "D", "D", "B", "H"],
        ["D", "U", "T", "Z", "O", "S"]
      ],
      modifiersEnabled: { stein: false, brunnen: false, trieb: false },
      solution: ["R5+", "R4+", "R6-", "R1-", "C3-", "R2-"]
    },
    // Level 4 – Stein einführen
    {
      id: 4, hint: "wächst im Garten", length: 5, target: "BLUME",
      grid: [
        ["L", "I", "L", "D", "B", "C"],
        ["U", "L", "C", "Z", "S", "T"],
        ["U", "H", "G", "H", "U", "G"],
        ["O", "N", "A", "M", "M", "L"],
        ["E", "I", "E", "E", "R", "M"],
        ["S", "C", "U", "N", "L", "K"]
      ],
      modifiersEnabled: { stein: true, brunnen: false, trieb: false },
      solution: ["C1+", "R2-", "R5+", "R2-"]
    },
    // Level 5
    {
      id: 5, hint: "macht den Garten nass", length: 5, target: "REGEN",
      grid: [
        ["E", "N", "I", "A", "E", "A"],
        ["O", "H", "M", "R", "N", "T"],
        ["R", "I", "N", "H", "D", "S"],
        ["A", "R", "Z", "I", "R", "O"],
        ["S", "E", "N", "O", "P", "E"],
        ["N", "S", "R", "G", "T", "U"]
      ],
      modifiersEnabled: { stein: true, brunnen: false, trieb: false },
      solution: ["R1-", "C3+", "R1-", "R2-", "C4+"]
    },
    // Level 6
    {
      id: 6, hint: "hat Wurzeln und Blätter", length: 4, target: "BAUM",
      grid: [
        ["O", "Z", "M", "N", "R", "R"],
        ["R", "S", "R", "T", "I", "R"],
        ["U", "B", "S", "I", "C", "A"],
        ["A", "B", "H", "R", "G", "A"],
        ["N", "S", "D", "N", "F", "O"],
        ["U", "R", "L", "I", "H", "U"]
      ],
      modifiersEnabled: { stein: true, brunnen: false, trieb: false },
      solution: ["C6-", "R1-", "R6+", "C2-", "R4+"]
    },
    // Level 7 – Brunnen einführen
    {
      id: 7, hint: "ein Getränk", length: 6, target: "WASSER",
      grid: [
        ["W", "D", "T", "R", "S", "T"],
        ["D", "D", "Z", "H", "K", "A"],
        ["D", "O", "N", "I", "S", "A"],
        ["N", "N", "G", "R", "T", "S"],
        ["K", "I", "F", "Z", "E", "L"],
        ["T", "K", "T", "P", "L", "R"]
      ],
      modifiersEnabled: { stein: true, brunnen: true, trieb: false },
      solution: ["C2-", "R1-", "R5+", "R3+"]
    },
    // Level 8
    {
      id: 8, hint: "scheint am Himmel", length: 5, target: "SONNE",
      grid: [
        ["U", "S", "O", "A", "N", "K"],
        ["D", "G", "F", "E", "A", "W"],
        ["N", "R", "R", "D", "D", "G"],
        ["C", "E", "C", "S", "B", "S"],
        ["I", "P", "G", "T", "C", "Z"],
        ["O", "S", "A", "N", "E", "B"]
      ],
      modifiersEnabled: { stein: true, brunnen: true, trieb: false },
      solution: ["R3+", "R2+", "C2+", "C6+", "R1-", "C5+"]
    },
    // Level 9
    {
      id: 9, hint: "ein Getränk am Morgen", length: 6, target: "KAFFEE",
      grid: [
        ["R", "N", "C", "L", "N", "G"],
        ["C", "I", "P", "N", "S", "R"],
        ["D", "K", "A", "K", "F", "E"],
        ["E", "R", "F", "B", "I", "H"],
        ["B", "R", "D", "G", "R", "H"],
        ["R", "I", "K", "U", "U", "K"]
      ],
      modifiersEnabled: { stein: true, brunnen: true, trieb: false },
      solution: ["C5+", "C3-", "R4-", "R2-", "C3-", "R5-", "C4-"]
    },
    // Level 10 – Trieb einführen
    {
      id: 10, hint: "ein Ort voller Pflanzen", length: 6, target: "GARTEN",
      grid: [
        ["E", "R", "A", "R", "A", "N"],
        ["C", "N", "C", "U", "N", "G"],
        ["A", "D", "I", "L", "N", "S"],
        ["A", "S", "P", "I", "R", "L"],
        ["H", "B", "R", "C", "K", "T"],
        ["R", "D", "G", "B", "E", "R"]
      ],
      modifiersEnabled: { stein: true, brunnen: true, trieb: true },
      solution: ["R4+", "R6+", "C5+", "C6-", "R2+"]
    },
    // Level 11
    {
      id: 11, hint: "ein schlaues Tier", length: 5, target: "FUCHS",
      grid: [
        ["M", "U", "N", "I", "F", "M"],
        ["N", "T", "L", "F", "R", "N"],
        ["F", "T", "F", "N", "D", "A"],
        ["G", "C", "R", "U", "A", "E"],
        ["K", "E", "E", "E", "C", "R"],
        ["D", "D", "S", "H", "R", "G"]
      ],
      modifiersEnabled: { stein: true, brunnen: true, trieb: true },
      solution: ["C2-", "R4+", "R6+", "C5-", "R6+", "R2+"]
    },
    // Level 12
    {
      id: 12, hint: "eine Jahreszeit", length: 6, target: "WINTER",
      grid: [
        ["E", "A", "N", "D", "S", "U"],
        ["I", "E", "N", "R", "T", "M"],
        ["W", "M", "T", "E", "I", "I"],
        ["R", "I", "S", "E", "N", "H"],
        ["E", "I", "W", "F", "N", "A"],
        ["N", "R", "I", "T", "T", "Z"]
      ],
      modifiersEnabled: { stein: true, brunnen: true, trieb: true },
      solution: ["R2-", "R3-", "C3+", "R5+", "R5+", "R2-"]
    }
  ];

  if (typeof module !== "undefined" && module.exports) module.exports = LEVELS;
  else root.LetterSlideLevels = LEVELS;
})(typeof globalThis !== "undefined" ? globalThis : this);
