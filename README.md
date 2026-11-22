# Letter Slide

Ein deutsches Wort-Schiebepuzzle – spielbarer Prototyp. Reines HTML/CSS/JavaScript,
**keine Abhängigkeiten, kein Build-Schritt, keine Assets**. Optimiert für das iPhone
(hochkant, Touch), läuft aber genauso am Desktop.

Die vollständige Original-Spezifikation steht in [`docs/SPEC.md`](docs/SPEC.md).

## Spielidee & Regeln

- 6×6-Gitter, jede Zelle enthält einen Großbuchstaben.
- **Einzige Aktion:** eine Zeile oder Spalte zyklisch um genau ein Feld verschieben
  (was rausfällt, kommt auf der anderen Seite wieder rein). Jeder Slide = ein Zug.
- Nach jedem Slide werden alle Zeilen und Spalten geprüft: Jede zusammenhängende
  Buchstabenfolge (≥ 3) aus der Wortliste wird gelöscht – alle Treffer gleichzeitig,
  auch überlappende und sich kreuzende. Teilwörter, die komplett in einem längeren
  Treffer derselben Linie stecken, zählen nicht extra (HAUS zählt nicht zusätzlich AUS).
- Danach fallen die Buchstaben nach unten, neue fallen von oben nach. Entstehen dabei
  neue Wörter, läuft eine **Kaskade** – jede Stufe erhöht den Combo-Multiplikator.
- **Punkte:** 3 Buchstaben = 10, 4 = 25, 5 = 60, 6+ = 150, multipliziert mit
  `1 + 0,5 × (Kaskadenstufe − 1)` (Stufe 1 = ×1, Stufe 2 = ×1,5, Stufe 3 = ×2 …).
  Punkte einer Stufe = gerundete Summe aller Wörter dieser Stufe × Multiplikator.
- Kein Zeitlimit, kein Game Over. „Runde beenden“ hält den Score fest.

### Modi

| Modus | Verhalten |
|---|---|
| **Tagesrätsel** | Seed aus dem lokalen Datum (`YYYY-MM-DD`, FNV-1a-Hash). Alle bekommen am selben Tag dasselbe Brett und dieselben Nachfüll-Buchstaben. Nummer = Tage seit 01.01.2026 + 1. „Reset“ startet das Tagesrätsel neu (gleiches Brett). |
| **Endlos** | Zufälliger Seed bei jedem Start, unbegrenzt spielbar. |

Das Startbrett wird deterministisch so lange neu gewürfelt, bis es keine Wörter enthält.

### Bedienung

- **Wischen (Touch/Maus):** auf einer Kachel waagerecht wischen → ihre Zeile rückt ein
  Feld in diese Richtung; senkrecht wischen → ihre Spalte. Kurz tippen = Kachel auswählen.
- **Randpfeile:** ▲ ▼ ◀ ▶ an jeder Zeile/Spalte.
- **Tastatur:** Kachel anklicken oder Shift+Pfeile wählt aus, Pfeiltasten verschieben
  die Zeile (←/→) bzw. Spalte (↑/↓), Strg/Cmd+Z = Undo.
- **Undo** (bis zu 50 Schritte, inkl. Zufallsgenerator-Zustand), **Reset**, **Teilen**
  (kopiert z. B. `Letter Slide #326 · 4 Züge · 62 Punkte · 🔥🔥🔥` – 🔥-Anzahl = höchste
  Kaskadenstufe, kein Brett-Spoiler), **Runde beenden**, 🔊/🔇 Ton.

## Starten

- **Lokal:** `index.html` einfach im Browser öffnen (Doppelklick, `file://` funktioniert –
  es werden bewusst klassische `<script>`-Tags statt ES-Modulen verwendet).
- **Auf dem iPhone / mit Home-Bildschirm-Icon:** über einen beliebigen statischen Webserver
  ausliefern (z. B. `npx serve .` oder `python3 -m http.server`) und in Safari öffnen →
  Teilen → „Zum Home-Bildschirm“. Das Web-Manifest wird nur über http(s) eingebunden
  (über `file://` würde der Browser sonst einen Fehler melden).

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

## Startseite

Beim Laden erscheint die Startseite: großes Logo, wippende Deko-Kacheln, Kurz-Slogan,
großer Knopf **„Tagesrätsel #N“** (mit Datum), **„Endlos“** (mit Rekord), **„So geht's“**
(Regeln + Punktetabelle, Werte live aus `config.js`) und Ton an/aus. Ist das heutige
Tagesrätsel schon beendet, zeigt der Knopf das Ergebnis und es gibt **„Ergebnis teilen“**.
Im Spiel führt **„Menü“** zurück (mit Rückfrage im In-Game-Dialog, falls eine Runde läuft).

Gespeichert wird in `localStorage` (Schlüssel `letterSlideStats.v1`, Modul `src/stats.js`):
bestes Tagesergebnis pro Datum (die letzten 60 Tage) und der Endlos-Rekord (beim Beenden
oder Verlassen einer Endlos-Runde). Ohne `localStorage` (Privatmodus) läuft alles weiter,
nur ohne Speichern.

## Zerbröseln (Partikel)

Bei einem Treffer leuchten die Kacheln kurz golden, dann zerfallen sie in kleine Körner
(`src/particles.js`): eine Vollbild-`<canvas>` (pointer-events: none, devicePixelRatio-scharf)
zeichnet pro Kachel bis zu ~196 Körner (1,5–4 px) in der Pastellfarbe mit Hell/Dunkel-Varianten,
der dunklen Kachelkante, goldenen Funken und dem Buchstaben in Dunkelbraun. Die Körner lösen
sich von oben nach unten ab, pro Buchstabe in Wortreihenfolge versetzt, und fallen mit
Schwerkraft und Luftwiderstand, schrumpfen und blenden über 0,6–1,0 s aus. Nach ~300 ms startet
die Gravitation, die Körner rieseln weiter. Dazu ein leises gefiltertes Rausch-„Rieseln“
(respektiert Stumm).

- Performance: Typed-Array-Pool, max. 2500 Körner, `fillRect` gebündelt nach Farbe, rAF-Schleife
  nur solange Körner leben (headless bei 4× CPU-Drosselung: 2040 Körner mit stabilen 60 fps).
- `prefers-reduced-motion: reduce` → keine Partikel, einfaches Ausblenden.
- Undo, Reset und Menü entfernen sofort alle Körner.
- Stellschrauben oben in `src/particles.js` (`MAX_PARTICLES`, `GRAINS_PER_SIDE`, `SWEEP_S`,
  `STAGGER_S`, `GRAVITY`, `DRAG`, `LIFE_MIN/MAX`, `SPARKLE_RATE`), Timing in `ANIM` (`src/render.js`).

## Design: „Pastell-Candy“

Cremefarbener Hintergrund, Bonbon-Titel (LETTER koralle, SLIDE lavendel), Kacheln in Mint,
Pfirsich, Lavendel und Butter mit dunkelbraunen Buchstaben, goldenes Aufleuchten bei Treffern,
HUD als Pillen (Punkte mit Stern, Züge) plus orangefarbene Combo-Wolke. Alles reines CSS und
Inline-SVG (Icons als `<symbol>` in `index.html`), keine Bilddateien, keine Webfonts
(abgerundeter System-Font-Stack: `ui-rounded`, „SF Pro Rounded“, …).

- **Theme ändern:** alle Farben, Schrift und Maße stehen als CSS-Variablen oben in
  `css/style.css` (`--bg`, `--ink`, `--tile-0` … `--tile-3`, `--hit`, `--mint`, `--combo-bg` …).
- **Kachelfarbe je Buchstabe:** Tabelle `TILE_COLOR_BY_LETTER` in `src/render.js`
  (bleibt beim Schieben stabil, häufige Buchstaben sind auf alle vier Farben verteilt).
- **Dialoge:** Bestätigung („Aktuelle Runde verwerfen?“), Teilen und Rundenende laufen über
  ein eigenes In-Game-Modal (`View.modal()` in `src/render.js`) statt `confirm()`/`alert()`;
  Escape oder Tippen auf den Hintergrund schließt.

## Ordnerstruktur

```
letter-slide/
├── index.html              # dünne Hülle: Markup + Script-Reihenfolge
├── manifest.webmanifest    # Web-App-Manifest (Home-Bildschirm)
├── css/style.css           # Platzhalter-Optik, Animationen, Mobil-Layout
├── src/
│   ├── config.js           # Wortliste, Buchstaben-Gewichtung, Punkte, Limits, MODES
│   ├── logic.js            # reine Spiellogik (kein DOM, in Node ladbar)
│   ├── stats.js            # Tagesergebnis + Endlos-Rekord (localStorage, in Node ladbar)
│   ├── audio.js            # optionaler WebAudio-Sound (Klick, Wort-Ton, Rieseln) + iOS-Unlock
│   ├── particles.js        # Canvas-Partikel fürs Zerbröseln
│   ├── render.js           # DOM-Rendering, HUD, Animationen
│   ├── input.js            # Buttons, Wischgesten (Pointer Events), Tastatur
│   └── main.js             # Verdrahtung, Startseite <-> Spiel, Eingabesperre, Teilen, Statistik
├── tests/
│   ├── logic.test.js       # Logik-Tests (node:test, keine Abhängigkeiten)
│   ├── stats.test.js       # Tests der localStorage-Statistik
│   └── browser-smoke.js    # optionaler Headless-Chrome-Test (Desktop + iPhone 14)
├── docs/SPEC.md            # Original-Spezifikation
└── .github/workflows/test.yml
```

Ladereihenfolge im Browser: `config.js → logic.js → stats.js → audio.js → particles.js → render.js → input.js → main.js`.
Jede Datei legt ein Objekt global ab (`LetterSlideConfig`, `LetterSlideLogic`, …);
`config.js` und `logic.js` exportieren in Node zusätzlich per `module.exports`.

Kernfunktionen in `src/logic.js`: `slideLine`, `findWords`, `checkBoard`, `clearWords`,
`applyGravity`, `refill`, `cascade`, `undo`, `reset`, `startDaily`, `startEndless`
(plus `performSlide`, `endRound`, `buildShareText`, `startMode`).

## Anpassen

Alles Folgende steht oben in **`src/config.js`**:

- **Wortliste austauschen:** Inhalt des Template-Strings `WORD_LIST_RAW` ersetzen
  (Wörter durch Leerzeichen/Zeilenumbruch getrennt, Zeilen mit `//` werden ignoriert).
  `parseWordList()` in `logic.js` schreibt alles groß, entfernt Duplikate und alles, was
  nicht A–Z mit 3–6 Buchstaben ist; daraus entsteht das Set `DICTIONARY`.
  Die mitgelieferte Liste (993 Wörter) ist eine Beispiel-Liste und sollte vor einem
  Release durch eine geprüfte ersetzt werden.
- **Buchstaben-Gewichtung ändern:** `LETTER_WEIGHTS` (relative Häufigkeiten, werden
  normalisiert). `USE_UNIFORM_LETTERS = true` → alle Buchstaben gleich wahrscheinlich.
  Gezogen wird in `drawLetter()` mit dem geseedeten PRNG (Mulberry32).
- **Punkteformel anpassen:** `SCORE_BY_LENGTH` (`{ 3: 10, 4: 25, 5: 60, 6: 150 }`, ab 6
  gilt der Wert für 6) und `COMBO_STEP` (0,5) im Multiplikator
  `comboMultiplier(level) = 1 + COMBO_STEP × (level − 1)`. Die Summe je Kaskadenstufe
  wird in `cascade()` (`logic.js`) berechnet und gerundet.
- **Weitere Stellschrauben:** `HISTORY_LIMIT` (Undo-Tiefe), `MAX_CASCADE_LEVELS`,
  `DAILY_EPOCH` (Start der Rätselnummern), Animationsdauern in `ANIM` (`render.js`),
  Wisch-Schwellen in `input.js`.
- **Neuen Modus ergänzen:** Eintrag in `MODES` anlegen:

  ```js
  monthly: {
    id: "monthly",
    label: "Monatsrätsel",
    seed: (ctx, h) => h.hashString("M-" + ctx.dateKey.slice(0, 7)), // gleicher Seed pro Monat (YYYY-MM)
    shareTag: (state) => state.dateKey.slice(0, 7),
    title: () => "Monatsrätsel"
  }
  ```

  Der Button erscheint automatisch; `startMode("monthly")` startet ihn.

## Tests

```bash
npm test                # Logik- und Statistik-Tests mit node:test (Node ≥ 20, keine Abhängigkeiten)
```

Geprüft werden u. a.: gleiches Datum → gleiches Startbrett, Endlos zufällig, wortfreie
Startbretter, `slideLine` in alle 4 Richtungen, waagerechte/senkrechte/überlappende Treffer,
HAUS ohne AUS, Gravitation + Nachfüllen ohne Lücken, Punkteformel inkl. Kaskaden
(unabhängig nachgerechnet über 12 000 Züge), Undo stellt Grid, Score, Züge, Combo und
PRNG-Zustand exakt wieder her, Reset, Teilen-Text, Rundenende.

Optionaler Browser-Smoke-Test (lokales Chrome nötig, läuft **nicht** in CI):

```bash
npm i --no-save puppeteer-core
CHROME_PATH=/usr/bin/google-chrome npm run test:browser
# Screenshots: SCREENSHOTS=./screenshots npm run test:browser
```

Er prüft u. a. Startseite (Tagesrätsel-Knopf, „So geht's“, Ergebnis/Rekord aus localStorage,
„Ergebnis teilen“), Start/Menü-Wechsel, dass Körner beim Treffer entstehen und die Canvas danach
wieder leer ist (auch nach Undo), den Reduced-Motion-Fallback, und öffnet `index.html` per `file://` (keine JS-Fehler, Spielablauf über Pfeile, Tastatur,
Undo, Moduswechsel samt In-Game-Dialog, Rundenende-Dialog, Teilen-Dialog, Reset; native Dialoge gelten als Fehler), prüft das Manifest über einen lokalen
http-Server und emuliert ein **iPhone 14 mit Touch**: Viewport-Meta, kein Querscrollen,
Touch-Ziele ≥ 44 px, Wischen waagerecht/senkrecht (je genau ein Zug), Tippen = Auswahl,
Pfeil per Touch, Audio-Unlock.

CI: `.github/workflows/test.yml` führt bei Push und Pull Request `npm test` mit Node 20 aus.
