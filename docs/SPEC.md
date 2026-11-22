# Letter Slide – Original-Spezifikation

> Design-Dokument von Sascha Hoffmann (unverändert übernommen).

```text
Baue mir einen spielbaren Prototyp meines Wort-Puzzles "Letter Slide". Bitte als einzelne HTML-Datei mit JavaScript und Canvas oder DOM-Grid. Keine Assets, keine echte Grafik: nur farbige Kacheln, Buchstaben, Zahlen und einfache UI. Es muss sofort im Browser laufen. Sauberer, kommentierter Code. Trenne Spiellogik, Rendering und Eingabe.

KERNIDEE
Ein 6x6-Buchstabengitter. Der Spieler kann jede Zeile und jede Spalte um genau ein Feld zyklisch verschieben (links/rechts bzw. hoch/runter). Das ist die EINZIGE Aktion. Nach jedem Slide wird das Brett geprüft: Jede waagerechte oder senkrechte Linie aus 3 oder mehr Buchstaben, die ein gültiges Wort ergibt, wird gelöscht. Steine darüber fallen nach, neue Buchstaben füllen von oben nach. Das kann Kaskaden auslösen.

SPIELREGELN IM DETAIL
- Gitter 6x6, jede Zelle enthält genau einen Großbuchstaben.
- Eingabe: An jedem Zeilen- und Spaltenrand ein kleiner Pfeil-Button. Klick = ein Slide in diese Richtung, zyklisch (das rausfallende Feld kommt auf der anderen Seite wieder rein).
- Ein Slide zählt als ein Zug.
- Nach jedem Slide: Wortprüfung auf allen Zeilen und Spalten.
  - Waagerecht: zusammenhängende Buchstabenfolgen der Länge >= 3, die in der Wortliste stehen.
  - Senkrecht: dasselbe.
  - Überlappende Treffer: alle gefundenen Wörter gleichzeitig löschen (alle Treffer sammeln, Zellen als "zu löschen" markieren).
- Löschen: markierte Zellen werden leer. Dann Gravitation: Buchstaben fallen in ihrer Spalte nach unten. Dann Nachfüllen von oben mit zufälligen Buchstaben (gewichtet nach deutscher Buchstabenhäufigkeit, oder für den Prototyp gleichverteilt – kommentiere die Stelle, wo man das ändern kann).
- Nach dem Nachfüllen erneut prüfen (Kaskade), bis keine Wörter mehr gefunden werden. Kaskade erhöht den Combo-Multiplikator.
- Punkte: Wort der Länge 3 = 10 Punkte, Länge 4 = 25, Länge 5 = 60, Länge 6+ = 150. Jede Kaskadenstufe multipliziert mit (1 + 0.5 * (Kaskadenstufe - 1)), also Stufe 1 = x1, Stufe 2 = x1.5, Stufe 3 = x2 usw.
- Kein Zeitlimit, kein Verlieren. Ziel ist die Punktzahl.

WORTLISTE
- Nutze eine eingebettete, kleine deutsche Wortliste mit ca. 500–1000 gängigen Wörtern (3–6 Buchstaben, Großbuchstaben, keine Umlaute, keine ß). Wenn du keine passende parat hast, generiere eine sinnvolle Beispiel-Liste direkt im Code als Array und kommentiere klar, dass sie ersetzt werden soll.
- Wörterbuch als Set für O(1)-Lookup.
- Kommentiere die Stelle, an der man die Liste austauschen kann.

MODI
- "Tagesrätsel": fester Seed, der sich aus dem Datum (YYYY-MM-DD) ableitet. Ein PRNG mit diesem Seed erzeugt das Startbrett und alle Nachfüll-Buchstaben deterministisch. Jeder Spieler bekommt weltweit dasselbe Brett. Ein Versuch pro Tag (im Prototyp: nur ein "Neu starten"-Button, der das Tagesrätsel zurücksetzt, aber kein neues Brett erzeugt).
- "Endlos": zufälliger Seed bei jedem Start, unbegrenzt spielbar.
- Buttons oben: "Tagesrätsel" und "Endlos". Aktueller Modus wird angezeigt.

UI / ANZEIGE
- Oben: Modus, Zugzähler, Punktestand, Combo-Anzeige (aktueller Multiplikator).
- Grid mittig, große Kacheln mit Buchstaben.
- An jedem Zeilen- und Spaltenrand kleine Pfeil-Buttons zum Verschieben.
- Unten: Buttons "Undo", "Reset", "Teilen".
- Beim Wort-Treffer: Wort groß einblenden, kurz aufleuchten, dann verschwinden.
- Bei Kaskade: Combo-Anzeige hochzählen, Farbe/Intensität ändern.
- Kein Game Over. Nur ein "Runde beenden"-Button, der den Score festhält.

UNDO
- Undo stellt den kompletten vorherigen Zustand wieder her: Grid-Inhalt, Score, Zugzähler, Combo, PRNG-Zustand. Halte dafür einen History-Stack von Snapshots (Grid als flaches Array, Score, Zähler, PRNG-State). Mindestens 20 Schritte.
- Reset setzt das aktuelle Level auf den Anfangszustand zurück (gleicher Seed).

TEILEN
- Nach "Runde beenden" (oder am Ende des Tagesrätsels) einen teilbaren Text erzeugen, z.B.:
  "Letter Slide #247 · 4 Züge · 62 Punkte · 🔥🔥🔥"
- Button "Teilen" kopiert den Text in die Zwischenablage (navigator.clipboard.writeText). Kein Spoiler über das Brett.
- Für den Prototyp reicht ein alert() oder ein Textfeld mit dem Inhalt.

PLATZHALTER-DARSTELLUNG
- Grid-Kacheln: hellgraue Quadrate mit großem dunklen Buchstaben.
- Beim Slide: kurze Translate-Animation (ca. 120 ms), Kachel gleitet raus und auf der anderen Seite wieder rein.
- Wort-Treffer: Kacheln kurz gelb aufblitzen, dann ausblenden.
- Gravitation: kurze Fall-Animation (ca. 150 ms), neue Kacheln fallen von oben ein.
- Combo: kleine Textanzeige "COMBO x2" mit kurzem Pop.
- Kein Sound nötig für den Prototyp, aber baue optional einen simplen WebAudio-Klick und einen Ton pro Wortlänge ein, damit man das "Satisfying"-Gefühl testen kann.

TECHNISCHE VORGABEN
- Alles in einer Datei, keine externen Bibliotheken.
- PRNG: einfacher Mulberry32 oder xorshift, mit Seed aus Datum bzw. Math.random().
- Kernfunktionen klar kommentiert: slideLine(), findWords(), clearWords(), applyGravity(), refill(), cascade(), checkBoard(), undo(), reset(), startDaily(), startEndless().
- Wortliste und Buchstaben-Gewichtung oben im Code als Konstanten, damit man sie leicht ersetzen kann.
- Level-/Modus-Definition so, dass man später leicht neue Modi ergänzen kann.

AKZEPTANZKRITERIEN
1. Datei startet im Browser, Grid ist sichtbar.
2. Ich kann Zeilen und Spalten verschieben (Buttons am Rand und/oder Tastatur), zyklisch.
3. Nach einem Slide werden gültige Wörter (>=3 Buchstaben aus der Liste) erkannt, gelöscht, Gravitation und Nachfüllen laufen, Kaskaden funktionieren.
4. Punkte und Combo werden korrekt berechnet und angezeigt.
5. Undo stellt Grid, Score, Zähler und Combo korrekt wieder her.
6. "Tagesrätsel" erzeugt bei gleichem Datum dasselbe Startbrett, "Endlos" ein zufälliges.
7. "Teilen" erzeugt einen kopierbaren Text ohne Spoiler.
8. Optik ist reine Platzhalter-Grafik, aber Slides, Treffer, Gravitation und Kaskaden fühlen sich durch einfache Animationen und optional Sounds befriedigend an.
9. Am Ende: kurze Erklärung, wie ich die Wortliste austausche, die Buchstaben-Gewichtung ändere und die Punkteformel anpasse.
```
