# Wortgarten

Ein deutsches Wort-Schiebepuzzle mit **Zielwort pro Level** und **Modifikatoren** (Stein, Brunnen,
Trieb). Reines HTML/CSS/JavaScript, **keine Abhängigkeiten, kein Build-Schritt, keine Bilddateien**.
Optimiert fürs iPhone (hochkant, Touch), läuft genauso am Desktop. Live:
<https://saschahoffmannsh-gif.github.io/letter-slide/>

Hervorgegangen aus dem Prototyp *Letter Slide* (Stand eingefroren als Git-Tag `letter-slide-v1`).
Das Design (Pastell-Candy, weiße Kacheln, Zerbröseln mit Rieselgeräusch, Touch-Optimierung) ist
unverändert übernommen; neue Elemente nutzen dieselben Komponenten und Theme-Variablen.

## Spielidee & Regeln

- 6×6-Gitter mit Großbuchstaben. **Einzige Aktion:** eine Zeile oder Spalte zyklisch um ein Feld
  schieben (= 1 Zug). Wischen auf einer Kachel, Randpfeile oder Tastatur.
- Jedes Level hat ein **Zielwort** mit Hinweis, z. B. *„etwas Warmes – 6 Buchstaben“* und Slots
  `_ _ _ _ _ _`. Steht das Zielwort waagerecht (links→rechts) oder senkrecht (oben→unten) **exakt**
  als zusammenhängende Folge im Gitter (nicht nur als Teil eines längeren Worts), ist das Level
  gelöst: das Wort blüht auf, Dialog *„Level X gelöst! Y Punkte. Züge: N.“* → **Nächstes Level**.
- **Kurze Wörter** (3–5 Buchstaben aus der Wortliste, nicht das Zielwort) werden wie bisher
  gelöscht (Zerbröseln), geben **0 Punkte**, aber **pflanzen einen Modifikator** – je nach Lage:

| Lage des kurzen Worts | Modifikator | Wirkung |
|---|---|---|
| berührt eines der 4 Mittelfelder | **Trieb** (grün, Blatt) | ein freies Nachbarfeld bekommt einen seltenen Buchstaben (Q/X/Y/J) |
| waagerecht in der unteren Hälfte (Zeile 4–6) oder senkrecht links (Spalte 1–3) | **Stein** (grau, Stein) | Buchstabe ist fixiert: wird beim Schieben übersprungen, fällt nicht |
| senkrecht rechts (Spalte 4–6) oder waagerecht oben (Zeile 1–3) | **Brunnen** (blau, Tropfen) | Zielwort-Buchstaben auf Brunnen **verdoppeln** die Punkte |

- **Zielwort-Fortschritt ist geschützt:** Die längste richtige Teilfolge des Zielworts im Brett
  (mindestens 2 Buchstaben am Stück in Leserichtung, z. B. `WAERM` für WAERME) ist zart lila
  unterstrichen. Ein kurzes Wort, das eines dieser Felder benutzt, wird **nicht** gelöscht und
  pflanzt nichts – auch nicht, wenn es selbst ein Präfix des Zielworts in derselben Linie ist
  (z. B. TOR bei TORTE: das ist einfach Fortschritt).
- Danach fallen Buchstaben nach unten, oben wird nachgefüllt; neue Wörter lösen **Kaskaden** aus.
- **Punkte fürs Zielwort:** `Länge × 10 × 2^(Brunnen im Wort) × (1 + 0,5 × Kaskaden) × (1 − 0,2 × Hinweise)`.
  Gesamtpunkte = Summe der besten Ergebnisse aller Level.
- **Vorschau** (Schalter mit Auge, standardmäßig an): vor jedem Zug blitzen die Felder, auf denen
  ein Modifikator entstehen würde, 800 ms gelb auf (mit Typ-Icon). Zusätzlich listet
  **„Was passiert?“** alle Züge, die gerade Modifikatoren pflanzen würden (Felder A–F / 1–6).
- **Hinweis** (3 pro Level, kostet je 20 % der Level-Punkte): zeigt einen fehlenden Buchstaben des
  Zielworts, seine Position im Wort und die ungefähre Lage im Gitter; der Slot wird aufgedeckt.
- **Undo** (bis 50 Schritte, stellt auch Steine, Brunnen, Triebe und den Zufallszustand wieder her),
  **Reset** (Level neu, gleiches Brett), **Teilen** (`Wortgarten Level 7 · 120 Punkte · 4 Züge`).

### Modi (Startseite)

| Knopf | Verhalten |
|---|---|
| **Level N spielen** | 12 handgebaute Level, Fortschritt in `localStorage` (Schlüssel `wortgartenStats.v1`) |
| **Tagesrätsel #N** | ein Level pro Tag, gleich für alle (Seed aus dem lokalen Datum → Level `n mod 12` + eigene Nachfüll-Buchstaben) |
| **Freies Spiel** | Zufallsbrett ohne Zielwort, alle Modifikatoren aktiv – zum Ausprobieren |
| **So geht's** | Regeln, Modifikator-Tabelle, Punkteformel |

### Lehr-Level (geführtes Tutorial)

Beim ersten **„Level 1 spielen“** startet das Tutorial Schritt für Schritt: Eine kurze Sprechblase im
Karten-Stil zeigt auf das passende Element (Hinweis, Slots, Pfeil, Kachel, Knopf), der Rest des
Spiels wird leicht abgedunkelt, die geforderte Steuerung pulsiert sanft in Lavendel. **Nur die
richtige Aktion ist erlaubt** – alles andere wackelt kurz und passiert nicht; danach geht es weiter.

| Level | Inhalt |
|---|---|
| 1 | Hinweis, Länge und Slots; Schieben per Pfeil **und** Wischen; der eine Zug zu WAERME; Jubel + Punkte |
| 2 | senkrechte Wörter; jeder Zug der Lösung geführt (Pfeil + Richtung); kurze Wörter zerbröseln; Fortschritt ist geschützt (lila) |
| 3 | wo die Zielbuchstaben liegen, 2 Schubser, Slots als Fortschritt, Hinweis-Knopf – dann frei |
| 4 / 7 / 10 | erster Stein / Brunnen / Trieb mit geführtem Zug, Karte auf der neuen Kachel, Vorschau-Auge und „Was passiert?“ |

- **„Überspringen“** in jeder Blase schaltet das ganze Tutorial ab; dann übernehmen die bisherigen
  kurzen Tipp-Popups als Rückfall. **„Tutorial wiederholen“** auf der Startseite und in „So geht's“.
- Gespeichert in `localStorage` (`tutorial.done` je Level, `tutorial.skipped`). Ein geführtes Level
  ersetzt seine Tipp-Popups (`covers`).
- Alle geforderten Züge sind ein Präfix der Referenzlösung → deterministisch (geseedetes Nachfüllen);
  `tests/tutorial.test.js` spielt jedes Skript bis „gelöst“ bzw. „Modifikator entstanden“ nach und
  prüft, dass das Level danach lösbar bleibt.
- Skripte ändern: `src/tutorial.js` (reine Daten: Text, Anker, geforderter Zug/Knopf, Bedingung).
  Anzeige: `src/coach.js`, Ablauf: `src/main.js` (`runTutorial`, `gate`).

### Live-Slots und Combo

- Die Slots zeigen den eigenen Fortschritt: Buchstaben der aktuellen richtigen Teilfolge (dieselbe
  wie die geschützten Felder) erscheinen **zart in Lavendel**; Hinweis-Buchstaben bleiben kräftig.
- Die **Combo-Wolke** ist mit Zielwort (Level, Tagesrätsel) versteckt und springt nur während einer
  echten Kaskade kurz ins HUD. Im Freien Spiel bleibt sie sichtbar.

### Level-Progression

| Level | Modifikatoren | Zielwörter |
|---|---|---|
| 1–3 | keine (Tutorial: 1 / 3 / 6 Züge) | WAERME, MOND, KATZE |
| 4–6 | Stein | BLUME, REGEN, BAUM |
| 7–9 | Stein + Brunnen | WASSER, SONNE, KAFFEE |
| 10–12 | Stein + Brunnen + Trieb | GARTEN, FUCHS, WINTER |

Jedes Level ist **beweisbar lösbar** (Referenzlösung in `src/levels.js`, geprüft von
`tests/levels.test.js` unter den echten Regeln inkl. Kaskaden). Per Löser bewiesen: Level 1 braucht
genau 1 Zug, Level 2 mindestens 3, Level 3 mindestens 6 (`FULL=1 npm test`).

## Design-Entscheidungen (Spec-Lücken)

- **Stein beim Schieben:** Steine bleiben stehen, die übrigen Felder der Linie rotieren zyklisch um
  sie herum. Besteht eine Linie nur aus Steinen, sind ihre Pfeile deaktiviert.
- **Kurze Wörter** werden gelöscht (Zerbröseln, 0 Punkte); ihr Modifikator wird **nach** Fallen +
  Nachfüllen gepflanzt, die Position wird aus den Koordinaten **vor** dem Löschen berechnet.
- **Vorrang**, wenn mehrere Regeln passen: Mitte/Trieb vor Stein vor Brunnen; ist der passende Typ
  im Level nicht aktiv, entsteht nichts (kein Ersatz-Typ).
- **Zielfeld:** liegt es außerhalb des Bretts, wird das nächste gültige Feld genommen (geklemmt);
  ist es schon belegt (Modifikator), das nächstgelegene freie Feld (`nearestFree`).
- **Schwerkraft** überspringt Steine (sie schweben fest). **Brunnen** ist eine Eigenschaft des
  Feldes (bleibt liegen, Buchstaben laufen durch). **Trieb** gehört zum Buchstaben und fällt mit.
- **Trieb:** ersetzt den Buchstaben des nächsten freien Feldes im Uhrzeigersinn um das Wort
  (Start oben links) durch Q/X/Y/J – Auswahl per geseedetem Zufall (Mulberry32).
- **Schutz des Fortschritts:** „Fortschritt“ = `bestPartialRun()` in `logic.js`: längste
  zusammenhängende Folge (waagerecht links→rechts bzw. senkrecht oben→unten), die ein Stück des
  Zielworts in richtiger Reihenfolge bildet, ab `PROTECT_MIN` = 2 Buchstaben (`config.js`).
  Gleichstand: Anfang des Zielworts bevorzugt, dann erste Linie – es gibt also genau eine
  geschützte Folge. Sie wird **in jeder Lösch-Runde neu** bestimmt (auch mitten in Kaskaden).
  Kurze Wörter, die ein geschütztes Feld enthalten, werden nicht gelöscht und pflanzen keinen
  Modifikator. Spiel, Vorschau, „Was passiert?“, Löser, Level-Tests und Brett-Markierung benutzen
  dieselbe Funktion. Nicht verhindert wird, dass geschützte Buchstaben durch Schwerkraft
  nachrutschen, wenn **darunter** ein anderes kurzes Wort gelöscht wird (sie bleiben erhalten,
  die Folge kann sich aber verschieben). Das Startbrett eines Levels muss weiterhin ganz ohne kurze
  Wörter sein (die Prüfung ignoriert den Schutz).
- **Zielwort** zählt nur exakt (nicht als Teil eines längeren Worts) und wird nie als kurzes Wort
  gelöscht. Geprüft wird vor jeder Lösch-Runde, also auch mitten in einer Kaskade.
- **Nachfüllen** ist deterministisch (Seed `wortgarten:<id>` bzw. `wortgarten-daily:<datum>`):
  gleiche Züge → gleiches Ergebnis, Undo/Reset exakt.
- **Zielwortlänge 4–6:** 7 Buchstaben passen nicht in ein 6×6-Gitter (Spec-Beispiele mit 7 wurden
  ersetzt). Umlaute werden ausgeschrieben (WÄRME → WAERME).
- Das Level-1-Beispiel der Spec enthielt das Zielwort schon im Startbrett; Zeile 1 ist daher um ein
  Feld verdreht (Lösung: Zeile 1 nach links).
- Abweichend von der Spec bleibt es beim bestehenden Multi-Datei-Projekt mit dem fertigen Design
  statt „eine HTML-Datei mit Platzhaltergrafik“.

## iPhone-/Touch-Optimierung

- `viewport` mit `width=device-width, initial-scale=1, viewport-fit=cover`; Abstände über
  `env(safe-area-inset-*)` (Notch, Home-Indikator).
- Brettgröße passt sich Breite **und** Höhe an (`100vw`/`100dvh`), auf 375–430 px breiten
  iPhones bleiben die Kacheln ≥ 44 px; Titel, Modus und HUD werden auf schmalen Displays kompakt.
- Alle Touch-Ziele (Randpfeile, Buttons) mindestens 44 × 44 px; die Randpfeile füllen ihre
  ganze Zelle als Trefferfläche.
- Wischgesten per **Pointer Events** (Touch, Maus, Stift) mit Pointer-Capture; pro Geste genau
  ein Slide. `touch-action: none` auf dem Brett, `touch-action: manipulation` global
  (kein Doppeltipp-Zoom), keine Textauswahl, kein Tap-Highlight, kein Long-Press-Menü,
  `overscroll-behavior: none` (kein Bounce/Pull-to-Refresh).
- iOS-WebAudio-Unlock: Bei der ersten Berührung wird der AudioContext gestartet und ein
  stiller Puffer gespielt (`src/audio.js`).
- `apple-mobile-web-app-capable`, Statusleisten-/Titel-Metas und `manifest.webmanifest`
  (Icon als Inline-SVG, keine Bilddatei). Hinweis: iOS nutzt für das Home-Icon kein SVG –
  dort erscheint ein Screenshot, bis ein PNG-`apple-touch-icon` ergänzt wird.

## Zerbröseln (Auflösen von oben nach unten)

Kurze Wörter (3–5 Buchstaben) leuchten kurz golden, dann lösen sie sich **von oben nach unten**
auf (`src/particles.js`). Die DOM-Kachel wird ausgeblendet und auf einer Vollbild-`<canvas>`
(pointer-events: none) weitergezeichnet. Eine waagerechte Front läuft in ~550 ms (ease-in-out)
von der Oberkante bis zur Unterkante:

- jede Kachel zerfällt in ~850–900 Körner (1–2,5 px, ein paar 3 px) in den Farben ihrer Kachel (weiß bzw. Stein-grau, Brunnen-blau, Trieb-grün – gelesen aus `--c/--s/--d` der Kachel), hellgrau, warmgrau,
  viele dunkelbraune Buchstaben-Körner und goldene Funken; fast die Hälfte der hellen Körner hat
  eine 1-px-Schattenseite, damit sie auf dem Cremegrund sichtbar bleiben;
- oberhalb der Front rieseln die Körner als dichter Sand-Strahl nach unten, über das Brett hinaus
  (individuelle Schwerkraft, leichte Seitwärts-Streuung, Lebensdauer 1,2–1,6 s);
- unterhalb der Front bleibt die Kachel intakt und scharf (abgeschnitten), an der Front ein
  dichter, ausgefranster Körner-Rand;
- pro Buchstabe in Wortreihenfolge um 50 ms versetzt; die Gravitation des Bretts startet, wenn
  die Front der letzten Kachel unten angekommen ist.

Dazu ein granulares **Rieselgeräusch** wie Sand/Zucker (`Sound.trickle` in `src/audio.js`): pro
Kachel ein leiser, bandpassgefilterter Rausch-Teppich plus viele winzige Rausch-Körner und feines
Knistern mit zufälligem Timing, Tonhöhe und Filterfrequenz. Die Kornzahl wächst mit der
Partikeldichte (gesamt gedeckelt), die Lautstärke nicht. Die Hüllkurve folgt dem Auflösen und
überlappt pro Buchstabe. Respektiert Stumm und die iOS-Audio-Freigabe.

- Performance: Typed-Array-Pool, max. 10 000 Körner. Die Körner werden direkt in einen
  ImageData-Pixelpuffer geschrieben und pro Frame mit einem `putImageData` + `drawImage` (nur
  Schmutz-Rechteck) übertragen; rAF-Schleife nur solange etwas lebt.
  `tests/perf-dissolve.js` (iPhone-14-Profil, 4× CPU-Drosselung, 5-Buchstaben-Wort + Kaskade mit
  6 Kacheln = ~9400 Körner): Median 16,7 ms, p95 16,8 ms (60 fps).
- `prefers-reduced-motion: reduce` → keine Partikel, einfaches Ausblenden.
- Undo, Reset und Menü entfernen sofort alle Körner.
- Stellschrauben oben in `src/particles.js` (`MAX_PARTICLES`, `GRAINS_PER_ROW`, `DISSOLVE_S`,
  `STAGGER_S`, `EDGE_BAND`, `GRAVITY`, `DRAG`, `LIFE_MIN/MAX`, `SPARKLE_RATE`, `INK_DUST_RATE`,
  `SHADOW_RATE`), Timing in `ANIM` (`src/render.js`). `LetterSlideParticles.timeScale = 0.25` =
  Zeitlupe (nur für Tests/Screenshots).

## Design: „Pastell-Candy“ (unverändert)

Cremefarbener Hintergrund, Bonbon-Titel (**WORT** koralle, **GARTEN** lavendel), **weiße Kacheln**
mit dunkelbraunen Buchstaben, Pfeile, HUD und Knöpfe in Pastell, Combo-Wolke, eigene In-Game-Dialoge.
Neu, aber im selben Stil: Zielwort-Karte mit Slots und Hinweiszeile, Modifikator-Status
(„Stein: 2 | Brunnen: 1 | Trieb: 0“, inaktive Typen ausgegraut), Vorschau-Schalter, Hinweis-Knopf.

- **Modifikator-Kacheln** behalten die Kachelform, nur Tönung, Muster und Icon ändern sich:
  Stein grau mit Stein-Icon, Brunnen blau mit Wellenmuster + Tropfen, Trieb grün mit Sprossenmuster
  + Blatt (Muster als Inline-SVG-Data-URI). Farben als CSS-Variablen `--stein-*`, `--brunnen-*`,
  `--trieb-*`, `--preview` oben in `css/style.css`.
- Icons als `<symbol>` in `index.html` (`i-stone`, `i-drop`, `i-sprout`, `i-bulb`, `i-eye`, …).

## Ordnerstruktur

```
letter-slide/                # Repo-Name bleibt (GitHub Pages-URL)
├── index.html               # Markup + Script-Reihenfolge
├── manifest.webmanifest
├── css/style.css            # Theme-Variablen, Layout, Animationen, Modifikator-Optik
├── src/
│   ├── config.js            # Wortliste, Gewichtung, Punkte, MODIFIER_RULES, Hinweise, MODES
│   ├── levels.js            # die 12 Level (Zielwort, Hinweis, Grid, Modifikatoren, Referenzlösung)
│   ├── tutorial.js          # Lehr-Level-Skripte (Daten, in Node ladbar)
│   ├── coach.js             # Coach Marks: Sprechblase, Abdunkeln, Puls, Wackeln
│   ├── logic.js             # reine Spiellogik (kein DOM, in Node ladbar)
│   ├── stats.js             # Fortschritt, Bestwerte, Tagesrätsel, Tipps (localStorage)
│   ├── audio.js             # WebAudio: Klick, Wort, Rieseln, Pflanzen, Vorschau-Ping, Aufblühen
│   ├── particles.js         # Canvas-Partikel fürs Zerbröseln
│   ├── render.js            # DOM-Rendering, HUD, Zielwort, Animationen, Vorschau, Dialoge
│   ├── input.js             # Buttons, Wischgesten, Tastatur
│   └── main.js              # Ablauf, Startseite, Level-Abschluss, Hinweis, Tutorial-Popups
├── tools/
│   ├── level-tools.js       # Replay, exhaustiver Löser (IDDFS), Beam-Suche
│   ├── solve-level.js       # CLI: node tools/solve-level.js <id> [--min N]
│   └── generate-levels.js   # Entwickler-Generator für neue Level
├── tests/
│   ├── logic.test.js        # Regeln, Modifikatoren, Vorschau, Zielwort, Hinweise, Undo
│   ├── levels.test.js       # Level-Daten, Progression, Lösbarkeit (Löser)
│   ├── tutorial.test.js     # Lehr-Level-Skripte nachspielen
│   ├── stats.test.js        # localStorage: Fortschritt, Tagesrätsel
│   ├── browser-smoke.js     # optional: Headless-Chrome (Desktop + iPhone 14)
│   └── perf-dissolve.js     # optional: fps beim Zerbröseln
├── docs/SPEC.md             # ursprüngliche Letter-Slide-Spezifikation
└── .github/workflows/test.yml
```

Ladereihenfolge: `config → levels → tutorial → logic → stats → audio → particles → render → coach → input → main`.
Die globalen Objekte heißen aus Kompatibilitätsgründen weiter `LetterSlideConfig`,
`LetterSlideLevels`, `LetterSlideLogic`, … (`config`, `levels`, `logic`, `stats` auch per
`module.exports` in Node).

Kernfunktionen in `src/logic.js`: `slideLine`, `findWords`, `checkTargetWord`, `findShortWords`,
`placeModifier`, `planModifiers`, `applyModifiers`, `applyGravity`, `refill`, `cascade`,
`targetScore`, `previewModifiers`, `whatIf`, `useHint`, `performSlide`, `undo`, `reset`,
`loadLevel`, `nextLevel`, `startDaily`, `startFree`, `validateLevel`.

## Anpassen (Kurzanleitung)

### Neue Level hinzufügen

1. In **`src/levels.js`** ein Objekt an das Array `LEVELS` anhängen:
   ```js
   {
     id: 13, hint: "fliegt im Herbst", length: 6, target: "DRACHE",
     grid: [["D","R","A","C","H","E"], /* … 6 Zeilen à 6 Buchstaben … */],
     modifiersEnabled: { stein: true, brunnen: true, trieb: true },
     solution: ["R2-", "C4+"]   // R = Zeile, C = Spalte, 1–6, + = rechts/unten, - = links/oben
   }
   ```
2. Regeln: nur A–Z (Umlaute ausschreiben), Länge 4–6, Startbrett ohne Zielwort und ohne kurze
   Wörter, alle Zielbuchstaben im Grid. `node tools/solve-level.js 13` prüft das Level und sucht eine
   Lösung; Ein Brett aus einem Zielwort erzeugen: Eintrag in `SPECS` in `tools/generate-levels.js` ergänzen und `node tools/generate-levels.js 13` aufrufen (`SEED=…` für andere Kandidaten).
3. `npm test` – `tests/levels.test.js` prüft automatisch Daten, Lösbarkeit und Referenzlösung
   (bei mehr als 12 Leveln die Zahl im ersten Test anpassen). Startseite, Kopfzeile
   „Level X von N“ und Tagesrätsel richten sich nach `LEVELS.length`.

### Modifikator-Regeln ändern

In **`src/config.js`** → `MODIFIER_RULES`. Die Liste wird von oben nach unten geprüft, die erste
passende Regel gewinnt (Reihenfolge = Vorrang). `w` ist das kurze Wort mit `axis` (`"row"`/`"col"`),
`line` (0–5), `cells` (Feld-Indizes), `g` bietet Helfer wie `isCenter`:
```js
{ type: "brunnen", when: (w) => (w.axis === "col" && w.line >= 3) || (w.axis === "row" && w.line <= 2) }
```
Wo der Modifikator landet, steht in `targetCellFor()` (`logic.js`), die Trieb-Buchstaben in
`RARE_LETTERS`, die Länge kurzer Wörter in `SHORT_MIN`/`SHORT_MAX`, die Vorschau-Dauer in
`PREVIEW_MS`. Welche Typen ein Level erlaubt, steht pro Level in `modifiersEnabled`.

### Punkteformel anpassen

In **`src/config.js`**: `POINTS_PER_LETTER` (10), `BRUNNEN_FACTOR` (2 = Verdopplung pro
Brunnen-Feld), `COMBO_STEP` (0,5 pro Kaskadenstufe), `HINTS_PER_LEVEL` (3), `HINT_PENALTY`
(0,2 = −20 % pro Hinweis). Die Formel selbst steht in `targetScore()` in `src/logic.js`;
Tests in `tests/logic.test.js` („targetScore …“) entsprechend anpassen.

### Weiteres

- **Wortliste:** `WORD_LIST_RAW` in `config.js` (993 Beispielwörter; vor einem Release prüfen).
- **Buchstaben-Gewichtung fürs Nachfüllen:** `LETTER_WEIGHTS`, `USE_UNIFORM_LETTERS`.
- **Tutorial:** Lehr-Level-Skripte in `src/tutorial.js`; Rückfall-Tipps (`TIPS`) oben in `src/main.js`.
- **Theme:** CSS-Variablen oben in `css/style.css`.

## Tests

```bash
npm test          # node:test, Node ≥ 20, keine Abhängigkeiten (~1 s)
FULL=1 npm test   # zusätzlich: vollständiger Beweis „Level 3 braucht ≥ 6 Züge“ (~1 min)
```

Geprüft u. a.: Schieben um Steine, Stein-Linien gesperrt, kurze Wörter → richtiger Modifikator je
Lage, Vorrang, Klemmen/Belegt-Regel, Trieb-Ring + seltene Buchstaben, Schwerkraft mit Steinen,
Brunnen bleibt / Trieb fällt mit, exakter Zielwort-Treffer (nicht in längerem Wort), Zielwort in der
Kaskade, Punkteformel inkl. Brunnen/Kaskade/Hinweise, Vorschau = tatsächliches Ergebnis ohne
Zustandsänderung, Hinweise, Undo/Reset stellen Modifikatoren exakt wieder her, Determinismus,
Tagesrätsel, Teilen-Text; alle 12 Level gültig, Progression, jede Referenzlösung löst ihr Level,
Mindestzugzahlen per Löser, Fortschritt in `localStorage`; Fortschritts-Schutz: kreuzendes kurzes
Wort durch ein geschütztes Feld bleibt stehen, Präfix in derselben Linie bleibt stehen, Zielwort
wird nie zerstört, Schutz übersteht Kaskaden, plus Zufallsspiel in allen 12 Leveln
(kein geschütztes Feld und kein Zielwort wird je gelöscht).

Optionaler Browser-Test (lokales Chrome, nicht in CI):

```bash
npm i --no-save puppeteer-core
CHROME_PATH=/usr/bin/google-chrome SCREENSHOTS=./screenshots npm run test:browser
```

Desktop + iPhone 14 (Touch): Startseite, Level 1 per Pfeil und per Wischen lösen, Abschluss-Dialog,
„Nächstes Level“, Fortschritt, Hinweis, „Was passiert?“, Vorschau-Aufblitzen, Undo entfernt
Modifikator, Brett mit allen drei Modifikatoren, Theme-Variablen unverändert, alles passt in den
Bildschirm, Touch-Ziele ≥ 44 px, keine JS-Fehler. Lehr-Level (frischer Spieler, iPhone 14): Blasen
auf dem Bildschirm, Abdunkeln, falsche Aktion blockiert + Wackeln, richtige Aktion (Wischen/Pfeil)
führt weiter, Jubel + Abschluss-Dialog, L2-Zugführung, Geister-Slots, Überspringen, Wiederholen
(Startseite und „So geht's“), L4 erster Stein mit Vorschau und „Was passiert?“, Combo versteckt.

CI: `.github/workflows/test.yml` führt bei Push/PR die Syntaxprüfung und `npm test` (Node 20) aus.
