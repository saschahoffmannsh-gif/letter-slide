# Wortgarten

Ein deutsches Wort-Schiebepuzzle mit **Zielwort pro Level**. Reines HTML/CSS/JavaScript,
**keine Abhängigkeiten, kein Build-Schritt, keine Bilddateien**.
Optimiert fürs iPhone (hochkant, Touch), läuft genauso am Desktop. Live:
<https://saschahoffmannsh-gif.github.io/letter-slide/>

Hervorgegangen aus dem Prototyp *Letter Slide* (Stand eingefroren als Git-Tag `letter-slide-v1`).
Das Design (Pastell-Candy, weiße Kacheln, Zerbröseln mit Rieselgeräusch, Touch-Optimierung) ist
unverändert übernommen.

## Spielidee & Regeln

- 6×6-Gitter mit Großbuchstaben. **Einzige Aktion:** eine Zeile oder Spalte zyklisch um ein Feld
  schieben (= 1 Zug). Wischen auf einer Kachel, Randpfeile oder Tastatur.
- Jedes Level hat ein **Zielwort** mit Hinweis, z. B. *„etwas Warmes – 6 Buchstaben“* und Slots
  `_ _ _ _ _ _`. Steht das Zielwort waagerecht (links→rechts) oder senkrecht (oben→unten) **exakt**
  als zusammenhängende Folge im Gitter (nicht nur als Teil eines längeren Worts), ist das Level
  gelöst: das Wort blüht auf, Dialog *„Level X gelöst! Y Punkte. Züge: N.“* → **Nächstes Level**.
- **Kurze Wörter** (3–5 Buchstaben aus der Wortliste, nicht das Zielwort) **zerbröseln**
  (0 Punkte); von oben fällt Neues nach. Das kann **Kaskaden** auslösen.
- **Zielbuchstaben sind geschützt:** Die Kacheln, die zum Bilden des Zielworts gebraucht werden
  (`neededCells` in `logic.js`), sind hell und zart lila unterstrichen. Sie **zerbröseln nie**
  und **bleiben bei der Gravitation stehen** (Nachfüll-Buchstaben füllen um sie herum). Schieben
  bewegt sie ganz normal mit der Zeile oder Spalte.
  - Zur Menge gehören alle Felder der besten Teilfolge am Stück (`bestPartialRun`, ab 2 Buchstaben)
    plus weitere Felder in Leserichtung, bis für jeden Zielwort-Buchstaben die benötigte Anzahl
    gedeckt ist. Doppelbuchstaben (z. B. E in KAFFEE, S in WASSER) werden nur so oft geschützt,
    wie das Wort sie braucht; überzählige gleiche Buchstaben dürfen zerbröseln.
  - Läuft ein kurzes Wort durch eine geschützte Kachel, zerbröseln nur die übrigen Buchstaben.
- Die **Slots** zeigen den Fortschritt am Stück: Buchstaben der aktuellen Teilfolge erscheinen
  **zart in Lavendel**; Hinweis-Buchstaben bleiben kräftig.
- **Punkte fürs Zielwort:** `Länge × 10 × (1 + 0,5 × Kaskaden) × (1 − 0,2 × Hinweise)`.
  Gesamtpunkte = Summe der besten Ergebnisse aller Level.
- **Hinweis** (3 pro Level, kostet je 20 % der Level-Punkte): zeigt einen fehlenden Buchstaben des
  Zielworts, seine Position im Wort und die ungefähre Lage im Gitter; der Slot wird aufgedeckt.
- **Undo** (bis 50 Schritte, stellt Grid, Punkte, Züge und den Zufallszustand wieder her),
  **Reset** (Level neu, gleiches Brett), **Teilen** (`Wortgarten Level 7 · 120 Punkte · 4 Züge`).

### Modi (Startseite)

| Knopf | Verhalten |
|---|---|
| **Level N spielen** | 12 handgebaute Level, Fortschritt in `localStorage` (Schlüssel `wortgartenStats.v1`) |
| **Tagesrätsel #N** | ein Level pro Tag, gleich für alle (Seed aus dem lokalen Datum → Level `n mod 12` + eigene Nachfüll-Buchstaben) |
| **Freies Spiel** | Zufallsbrett ohne Zielwort – kurze Wörter zerbröseln, zum Ausprobieren |
| **So geht's** | Regeln und Punkteformel |

### Lehr-Level (geführtes Tutorial)

Beim ersten **„Level 1 spielen“** startet das Tutorial Schritt für Schritt: Eine kurze Sprechblase im
Karten-Stil zeigt auf das passende Element (Hinweis, Slots, Pfeil, Kachel, Knopf), der Rest des
Spiels wird leicht abgedunkelt, die geforderte Steuerung pulsiert sanft in Lavendel. **Nur die
richtige Aktion ist erlaubt** – alles andere wackelt kurz und passiert nicht; danach geht es weiter.

| Level | Inhalt |
|---|---|
| 1 | Hinweis, Länge und Slots; Schieben per Pfeil **und** Wischen; der eine Zug zu WAERME; Jubel + Punkte |
| 2 | senkrechte Wörter; jeder Zug der Lösung geführt; kurze Wörter zerbröseln; Zielwort-Buchstaben zerbröseln nie und bleiben stehen |
| 3 | wo die Zielbuchstaben liegen, 2 Schubser, Slots als Fortschritt, Hinweis-Knopf – dann frei |

- **„Überspringen“** in jeder Blase schaltet das ganze Tutorial ab; dann übernehmen die bisherigen
  kurzen Tipp-Popups als Rückfall. **„Tutorial wiederholen“** auf der Startseite und in „So geht's“.
- Gespeichert in `localStorage` (`tutorial.done` je Level, `tutorial.skipped`). Ein geführtes Level
  ersetzt seine Tipp-Popups (`covers`).
- Alle geforderten Züge sind ein Präfix der Referenzlösung → deterministisch (geseedetes Nachfüllen);
  `tests/tutorial.test.js` spielt jedes Skript nach und prüft, dass das Level danach lösbar bleibt.
- Skripte ändern: `src/tutorial.js` (reine Daten: Text, Anker, geforderter Zug/Knopf, Bedingung).
  Anzeige: `src/coach.js`, Ablauf: `src/main.js` (`runTutorial`, `gate`).

### Live-Slots und Combo

- Die Slots zeigen den eigenen Fortschritt: Buchstaben der aktuellen richtigen Teilfolge erscheinen
  **zart in Lavendel**; Hinweis-Buchstaben bleiben kräftig.
- Die **Combo-Wolke** ist mit Zielwort (Level, Tagesrätsel) versteckt und springt nur während einer
  echten Kaskade kurz ins HUD. Im Freien Spiel bleibt sie sichtbar.

### Level-Progression

12 Level mit steigender Schwierigkeit, Zielwörter: WAERME, MOND, KATZE, BLUME, REGEN, BAUM,
WASSER, SONNE, KAFFEE, GARTEN, FUCHS, WINTER. Level 1 braucht genau 1 Zug, Level 2 etwa 3–4 Züge,
Level 3 ist zerstreut (Referenz 6 Züge). Jedes Level ist **beweisbar lösbar** (Referenzlösung in
`src/levels.js`, geprüft von `tests/levels.test.js` unter den echten Regeln inkl. Kaskaden).

## Design-Entscheidungen (Spec-Lücken)

- **Schutz der Zielbuchstaben:** `neededCells()` in `logic.js` – zuerst die Felder von
  `bestPartialRun()` (längste zusammenhängende Folge des Zielworts in Leserichtung, ab
  `PROTECT_MIN` = 2 in `config.js`; Gleichstand: Anfang des Zielworts, dann erste Linie),
  danach weitere Felder in Leserichtung, bis die Buchstaben-Anzahlen des Zielworts gedeckt sind.
  Spiel, Anzeige, Löser und Tests benutzen dieselbe Funktion. Ein vollständig geschütztes kurzes
  Wort (z. B. ein Präfix des Zielworts) zerbröselt nicht und löst keine Endlos-Kaskade aus.
- **Gravitation:** geschützte Kacheln bleiben stehen, andere Buchstaben fallen an ihnen vorbei,
  Nachfüllen füllt die Lücken um sie herum. Schieben ist davon unabhängig.
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

- jede Kachel zerfällt in ~850–900 Körner (1–2,5 px, ein paar 3 px) in den Farben ihrer Kachel (weiß, gelesen aus `--c/--s/--d` der Kachel), hellgrau, warmgrau,
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
Zielwort-Karte mit Slots, Hinweiszeile und Hinweis-Knopf. Benötigte Zielbuchstaben tragen einen
zarten Lavendel-Schimmer und einen feinen Unterstrich (gleiche Kachelform).

- Icons als `<symbol>` in `index.html` (`i-bulb`, `i-star`, `i-leaf`, …).

## Ordnerstruktur

```
letter-slide/                # Repo-Name bleibt (GitHub Pages-URL)
├── index.html               # Markup + Script-Reihenfolge
├── manifest.webmanifest
├── css/style.css            # Theme-Variablen, Layout, Animationen
├── src/
│   ├── config.js            # Wortliste, Gewichtung, Punkte, Hinweise, MODES
│   ├── levels.js            # die 12 Level (Zielwort, Hinweis, Grid, Referenzlösung)
│   ├── tutorial.js          # Lehr-Level-Skripte (Daten, in Node ladbar)
│   ├── coach.js             # Coach Marks: Sprechblase, Abdunkeln, Puls, Wackeln
│   ├── logic.js             # reine Spiellogik (kein DOM, in Node ladbar)
│   ├── stats.js             # Fortschritt, Bestwerte, Tagesrätsel, Tipps (localStorage)
│   ├── audio.js             # WebAudio: Klick, Wort, Rieseln, Aufblühen
│   ├── particles.js         # Canvas-Partikel fürs Zerbröseln
│   ├── render.js            # DOM-Rendering, HUD, Zielwort, Animationen, Dialoge
│   ├── input.js             # Buttons, Wischgesten, Tastatur
│   └── main.js              # Ablauf, Startseite, Level-Abschluss, Hinweis, Tutorial-Popups
├── tools/
│   ├── level-tools.js       # Replay, exhaustiver Löser (IDDFS), Beam-Suche
│   ├── solve-level.js       # CLI: node tools/solve-level.js <id> [--min N]
│   └── generate-levels.js   # Entwickler-Generator für neue Level
├── tests/
│   ├── logic.test.js        # Regeln, Schutz, Zielwort, Hinweise, Undo
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
`neededCells`, `bestPartialRun`, `clearWords`, `applyGravity`, `refill`, `cascade`,
`targetScore`, `useHint`, `performSlide`, `undo`, `reset`,
`loadLevel`, `nextLevel`, `startDaily`, `startFree`, `validateLevel`.

## Anpassen (Kurzanleitung)

### Neue Level hinzufügen

1. In **`src/levels.js`** ein Objekt an das Array `LEVELS` anhängen:
   ```js
   {
     id: 13, hint: "fliegt im Herbst", length: 6, target: "DRACHE",
     grid: [["D","R","A","C","H","E"], /* … 6 Zeilen à 6 Buchstaben … */],
     solution: ["R2-", "C4+"]   // R = Zeile, C = Spalte, 1–6, + = rechts/unten, - = links/oben
   }
   ```
2. Regeln: nur A–Z (Umlaute ausschreiben), Länge 4–6, Startbrett ohne Zielwort und ohne kurze
   Wörter, alle Zielbuchstaben im Grid. `node tools/solve-level.js 13` prüft das Level und sucht eine
   Lösung; Ein Brett aus einem Zielwort erzeugen: Eintrag in `SPECS` in `tools/generate-levels.js` ergänzen und `node tools/generate-levels.js 13` aufrufen (`SEED=…` für andere Kandidaten).
3. `npm test` – `tests/levels.test.js` prüft automatisch Daten, Lösbarkeit und Referenzlösung
   (bei mehr als 12 Leveln die Zahl im ersten Test anpassen). Startseite, Kopfzeile
   „Level X von N“ und Tagesrätsel richten sich nach `LEVELS.length`.

### Punkteformel anpassen

In **`src/config.js`**: `POINTS_PER_LETTER` (10), `COMBO_STEP` (0,5 pro Kaskadenstufe),
`HINTS_PER_LEVEL` (3), `HINT_PENALTY` (0,2 = −20 % pro Hinweis). Die Länge kurzer Wörter steht in
`SHORT_MIN`/`SHORT_MAX`. Die Formel selbst steht in `targetScore()` in `src/logic.js`;
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

Geprüft u. a.: zyklisches Schieben, exakter Zielwort-Treffer (nicht in längerem Wort),
Punkteformel inkl. Kaskade/Hinweise, Hinweise, Undo/Reset und PRNG, Determinismus, Tagesrätsel,
Teilen-Text; alle 12 Level gültig, jede Referenzlösung löst ihr Level, Mindestzugzahlen per Löser,
Fortschritt in `localStorage` (auch ältere Stände mit Modifikator-Tipps laden ohne Fehler);
Schutz: benötigte Zielbuchstaben inkl. Einzelbuchstaben und Doppelbuchstaben (KAFFEE, WASSER),
kurze Wörter zerbröseln nur ungeschützte Felder, Präfix bleibt stehen, Zielwort wird nie zerstört,
geschützte Kacheln fallen nicht, plus Zufallsspiel in allen 12 Leveln (kein benötigter Buchstabe
geht verloren).

Optionaler Browser-Test (lokales Chrome, nicht in CI):

```bash
npm i --no-save puppeteer-core
CHROME_PATH=/usr/bin/google-chrome SCREENSHOTS=./screenshots npm run test:browser
```

Desktop + iPhone 14 (Touch): Startseite, Level 1 per Pfeil und per Wischen lösen, Abschluss-Dialog,
„Nächstes Level“, Fortschritt, Hinweis, Schutz-Markierung, Undo, Theme-Variablen unverändert,
alles passt in den Bildschirm, Touch-Ziele ≥ 44 px, keine JS-Fehler. Lehr-Level (frischer Spieler,
iPhone 14): Blasen auf dem Bildschirm, Abdunkeln, falsche Aktion blockiert + Wackeln, richtige
Aktion (Wischen/Pfeil) führt weiter, Jubel + Abschluss-Dialog, L2-Zugführung, Schutz-Erklärung,
Geister-Slots, Überspringen, Wiederholen (Startseite und „So geht's“), Combo versteckt.

CI: `.github/workflows/test.yml` führt bei Push/PR die Syntaxprüfung und `npm test` (Node 20) aus.
