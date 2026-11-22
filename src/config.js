/*
 * Wortgarten – KONFIGURATION
 * ===========================
 * Alles, was man typischerweise austauschen oder feinjustieren will, steht hier:
 * Wortliste, Buchstaben-Gewichtung, Modifikator-Regeln, Punkteformel, Limits, Modi.
 * (Die Level selbst stehen in src/levels.js.)
 *
 * Läuft im Browser (klassisches <script>, legt `LetterSlideConfig` global ab)
 * und in Node (`require("./config.js")`). Keine Abhängigkeiten.
 */
(function (root) {
  "use strict";

  /** Brettgröße (Spec: 6x6). */
  const GRID_SIZE = 6;
  /** Mindestlänge eines Wortes. */
  const MIN_WORD_LENGTH = 3;

  /*
   * WORTLISTE  >>> HIER AUSTAUSCHEN <<<
   * Beispiel-Liste (~1000 gängige deutsche Wörter, 3–6 Buchstaben, nur A–Z,
   * keine Umlaute/ß). Für das fertige Spiel durch eine geprüfte Liste ersetzen:
   * einfach den Inhalt des Template-Strings tauschen (Wörter durch Leerzeichen/
   * Zeilenumbruch getrennt; Zeilen, die mit // beginnen, werden ignoriert).
   * Kleinbuchstaben werden automatisch groß geschrieben; Einträge, die nicht
   * nur A–Z enthalten oder nicht 3–6 Buchstaben lang sind, werden verworfen
   * (siehe parseWordList in logic.js).
   */
  const WORD_LIST_RAW = `
    // --- 3 Buchstaben (128) ---
    AAL ABO AHA ALS ALT ARM ART AST AUF AUS AXT BAD BAR BAU BEI BIN
    BIO BIS BOX BUS DAS DEM DEN DER DES DIA DIE DIR DOM DUO EGO EHE
    EID EIN EIS ELF EMU ERZ FAN FEE GAB GAS GAU GEL GEN GUT HAI HAT
    HER HEU HIN HOF HUF HUT ICH IHR IST JOB KAM KUR LAG LAS LOT MAI
    MAL MAN MIR MIT MUS MUT NAH NEU NIE NIX NOT NUN NUR ODE OFT OHR
    OMA OPA ORT OST PIK POL POP RAP ROH ROT RUF RUM SAH SAU SEE SET
    SIE SKI TAG TAL TAT TAU TEE TON TOR TOT TUN UHR UHU UND UNS VON
    VOR WAL WAS WEG WEM WEN WER WIE WIR WOK WUT ZAR ZEH ZEN ZOO ZUG
    // --- 4 Buchstaben (313) ---
    ABER ACHT AFFE AKTE ALLE ALSO AMEN ARIE ARZT ATEM AUGE AUTO BACH BAHN BALD BALL
    BAND BANK BART BAUM BEIN BERG BETT BIER BILD BLAU BLEI BLUT BOOT BOTE BREI BROT
    BUCH BUDE BUND BUNT BURG CHEF CHOR DACH DAME DANK DANN DARM DEIN DICH DICK DIEB
    DING DORF DORN DOSE DREI DUFT DUMM EBBE ECHO ECKE EHRE EILE EINE ELCH ENDE ENGE
    ENTE ERBE ERDE ESEL EULE FALL FARN FASS FAUL FEIN FELD FELS FEST FETT FILM FILZ
    FINK FLOH FLUG FLUR FORM FOTO FRAU FREI FROH GANS GANZ GAST GELB GELD GERN GIFT
    GLAS GLUT GOLD GOLF GOTT GRAB GRAD GRAS GRAU GURT HAAR HAHN HALB HALS HALT HAND
    HANG HART HARZ HASE HAUS HAUT HEER HEFE HEFT HEIM HELD HELL HELM HEMD HERD HERZ
    HEXE HIER HIRN HOCH HOLZ HOSE HUHN HUND IDEE IGEL JAGD JAHR JEDE JUNG KALB KALT
    KAMM KANN KANU KAUF KAUZ KEIN KEKS KERN KIND KINO KLAR KLEE KNIE KOCH KOHL KOPF
    KORB KORN KRUG KUSS LAGE LAMM LAND LANG LAST LAUB LAUF LAUS LAUT LEER LEHM LEIB
    LEID LIED LIMO LOCH LOHN LUFT LUPE LUST MAHL MANN MAUS MEER MEHL MEHR MEIN MODE
    MOHN MOND MOOR MOOS MOPS MORD MUND NAME NAPF NARR NASE NASS NEIN NEON NERV NEST
    NETZ NEUN NOCH NOTE NUSS OASE OBEN OBST OFEN OHNE OPER PAAR PARK PASS PECH PELZ
    PFAD PFAU PILZ PLAN PONY POST QUAL QUIZ RABE RAND RAUM REBE REDE REIS RIND RING
    ROCK ROSE RUHE RUND RUTE SAAL SACK SAFT SAGE SALZ SAND SATZ SEHR SEIL SEIN SEKT
    SENF SIEB SIEG SINN SOFA SOHN SOLL SPUR STAR STEG TAKT TANK TANZ TAXI TEIL TIER
    TOPF TREU TUBA TUCH TURM UFER VASE VERS VIEL VIER VOLK VOLL WADE WAHL WALD WAND
    WARE WARM WEIN WELT WERK WERT WILD WIND WIRT WITZ WOHL WOLF WORT WURM ZAHL ZAHN
    ZAUN ZEHE ZEIT ZELT ZIEL ZINK ZINS ZOLL ZOPF
    // --- 5 Buchstaben (382) ---
    ACKER ADLER ALARM ALBUM ALLEE ALTAR AMPEL ANGST ANKER APFEL ARENA ASCHE ATLAS BACKE BAUCH BAUER
    BEERE BESEN BETON BEUTE BIBEL BIBER BIENE BIRKE BIRNE BITTE BLASE BLATT BLECH BLICK BLITZ BLUME
    BLUSE BODEN BOGEN BOHNE BOMBE BRAND BRAUT BRIEF BRUST BUCHE BULLE DAMPF DATUM DECKE DOLCH DRAHT
    DRAMA DROGE DUNST DURCH DURST EICHE EIMER EISEN ENGEL ERBSE ERNTE ESSEN ESSIG ETAGE FABEL FADEN
    FAHNE FAHRT FALKE FALLE FALTE FARBE FASAN FAUST FEDER FEGEN FEIER FEIGE FERNE FEUER FIGUR FIRMA
    FISCH FLECK FLOTT FLUSS FOLGE FOLIE FORST FRAGE FUCHS FUNKE GABEL GASSE GEIER GEIGE GEIST GELEE
    GENIE GLANZ GLIED GRIFF GRUBE GRUND GURKE HABEN HAFEN HAFER HAGEL HAKEN HALLE HARFE HASEL HEBEL
    HECHT HECKE HEIDE HENNE HEUTE HILFE HITZE HOBBY HONIG HOSEN HOTEL HYMNE IMMER INSEL JACKE JETZT
    JUBEL JUWEL KABEL KAJAK KAKAO KAMEL KANAL KANNE KANTE KAPPE KARTE KASSE KATER KATZE KEGEL KELCH
    KERZE KETTE KIOSK KISTE KLANG KLEID KLEIN KLIMA KNABE KNALL KNOPF KOHLE KOMET KOMMA KRAFT KRANZ
    KREBS KREIS KREUZ KRIEG KRONE KUGEL KUNST KURVE LACHS LADEN LAGER LAKEN LAMPE LATTE LAUNE LEBEN
    LEBER LEDER LEHRE LEISE LESER LEUTE LICHT LILIE LINDE LINIE LIPPE LISTE LOCKE LOTTO LUNGE MAGEN
    MAGIE MARKE MARKT MASKE MASSE MATTE MAUER MEISE MENGE MESSE MIENE MIETE MILCH MITTE MONAT MOTOR
    MOTTE MUSIK NABEL NACHT NADEL NAGEL NARBE NEBEL NEFFE NELKE NICHT NIERE NONNE NOTIZ NUDEL OCHSE
    OLIVE ONKEL OPFER ORGEL ORKAN OTTER PAKET PALME PAPPE PASTA PAUSE PEDAL PERLE PFEIL PFERD PFIFF
    PFLUG PFOTE PFUND PILOT PINIE PIRAT PISTE PIZZA PLATZ PREIS PROBE PROFI PUDEL PUMPE PUNKT PUPPE
    QUARK RADIO RASEN RASSE RATTE RAUCH RAUPE RAUTE RECHT REGAL REGEL REGEN REICH REIHE REISE RENTE
    RIESE RINDE RIPPE ROBBE ROLLE ROMAN RUDEL RUDER RUINE SAGEN SALAT SALON SAMEN SAUER SAUNA SCHAF
    SCHAL SCHUH SEELE SEGEL SEGEN SEIFE SEITE SILBE SIRUP SOCKE SONNE SORGE SPALT SPATZ SPECK SPEER
    SPIEL SPORT STADT STAHL STALL STAMM STAUB STEIN STERN STIEL STIER STIFT STIRN STOCK STOFF STROH
    STROM STUBE STUFE STUHL STURM SUCHE SUMPF SUPPE TABAK TAFEL TANNE TANTE TASSE TAUBE TEICH TEMPO
    TENOR THEMA TIGER TINTE TISCH TITEL TORTE TRAUM TROST TRUHE TULPE UNION UNTER VATER VILLA VOGEL
    WAAGE WACHE WACHS WAFFE WAGEN WALZE WANGE WANNE WEIDE WEILE WEISE WELLE WENIG WESEN WESPE WIESE
    WOCHE WOLKE WOLLE WUNDE WURST ZANGE ZEBRA ZEILE ZELLE ZEUGE ZIEGE ZUNGE ZWECK ZWERG
    // --- 6 Buchstaben (170) ---
    BAGGER BALKEN BANANE BECHER BECKEN BESSER BEUTEL BREZEL BRILLE BRUDER BUCKEL BUTTER DACKEL DAUMEN DELFIN DIENST
    DONNER DRACHE DUSCHE EICHEL EINZUG ERBSEN FACKEL FIEBER FINGER FLAMME FLIEGE FLOSSE FLOTTE FOHLEN FREUND FRIEDE
    FROSCH FRUCHT FUTTER GARTEN GERSTE GEWEHR GIEBEL GIPFEL GITTER GLATZE GLOCKE GRENZE GRUPPE HAMMER HAUFEN HERBST
    HIMMEL HIRSCH HUMMEL HUMMER HUSTEN INHALT INSEKT JAGUAR KAFFEE KAKTUS KAPUZE KARREN KASTEN KELLER KESSEL KIEFER
    KIRCHE KISSEN KITTEL KLAPPE KLASSE KLINGE KLINKE KLIPPE KNOTEN KOBOLD KOFFER KORKEN KRABBE KRAGEN KRATER KRUSTE
    KUCHEN LAPPEN LEITER LERCHE MANDEL MANTEL MARMOR MELONE MENSCH MESSER METALL MINUTE MUSKEL MUSTER MUTTER NICHTE
    NORDEN PALAST PANZER PAPIER PARADE PFANNE PINSEL PLAKAT PLATTE POSTEN PULVER QUALLE QUELLE RAHMEN RAKETE REIFEN
    REITER RETTER REZEPT RIEGEL RITTER ROGGEN SCHALE SCHAUM SCHERE SCHILD SCHLAF SCHNEE SCHOSS SCHULE SCHUSS SCHWAN
    SENDER SESSEL SILBER SOMMER SPINNE SPITZE SPRUNG STILLE STIMME STORCH STRAND STRICH TASCHE TELLER TENNIS TOMATE
    TRAUBE TREPPE TRESOR TUNNEL TUSCHE URLAUB VENTIL WALZER WASSER WECKER WEIZEN WESTEN WETTER WIMPER WINKEL WINTER
    WIPFEL WIRBEL WOLLEN WUNSCH ZAPFEN ZETTEL ZIEGEL ZIMMER ZIRKUS ZUCKER
`;

  /*
   * BUCHSTABEN-GEWICHTUNG  >>> HIER ÄNDERN <<<
   * Relative Häufigkeit deutscher Buchstaben in Prozent (Umlaute/ß herausgerechnet).
   * Die Werte müssen nicht 100 ergeben – sie werden normalisiert.
   * Für Gleichverteilung: USE_UNIFORM_LETTERS = true setzen (oder alle Werte auf 1).
   */
  const LETTER_WEIGHTS = {
    E: 17.40, N: 9.78, I: 7.55, S: 7.27, R: 7.00, A: 6.51, T: 6.15, D: 5.08,
    H: 4.76,  U: 4.35, L: 3.44, C: 3.06, G: 3.01, M: 2.53, O: 2.51, B: 1.89,
    W: 1.89,  F: 1.66, K: 1.21, Z: 1.13, P: 0.79, V: 0.67, J: 0.27, Y: 0.04,
    X: 0.03,  Q: 0.02
  };
  const USE_UNIFORM_LETTERS = false;

  /*
   * ======================================================================
   * WORTGARTEN – REGELN  >>> HIER ANPASSEN <<<
   * ======================================================================
   */

  /** Kurze Wörter (Werkzeuge): Länge SHORT_MIN..SHORT_MAX. Sie geben 0 Punkte, pflanzen Modifikatoren. */
  const SHORT_MIN = 3;
  const SHORT_MAX = 5;
  /**
   * Zielwort-Fortschritt schützen: die längste richtige Teilfolge des Zielworts im Brett (ab dieser
   * Länge) wird nicht von kreuzenden kurzen Wörtern zerstört (siehe bestPartialRun in logic.js).
   */
  const PROTECT_MIN = 2;

  /*
   * PUNKTEFORMEL fürs Zielwort  >>> HIER ANPASSEN <<<
   *   Punkte = Länge × POINTS_PER_LETTER × BRUNNEN_FACTOR^(Brunnen im Pfad)
   *            × Kaskaden-Multiplikator × (1 − HINT_PENALTY × benutzte Hinweise)
   *   Kaskaden-Multiplikator = 1 + COMBO_STEP × (Anzahl Löschrunden, bevor das Zielwort entstand)
   *            -> direkt durch den Slide ×1, nach 1 Kaskade ×1,5, nach 2 ×2 …
   *   (berechnet in targetScore() in logic.js)
   */
  const POINTS_PER_LETTER = 10;
  const BRUNNEN_FACTOR = 2;
  const COMBO_STEP = 0.5;
  const HINTS_PER_LEVEL = 3;
  const HINT_PENALTY = 0.2;

  /*
   * MODIFIKATOR-REGELN  >>> HIER ANPASSEN <<<
   * Für jedes kurze Wort wird der ERSTE passende Eintrag genommen (Reihenfolge = Vorrang),
   * aber nur, wenn der Modifikator im Level aktiv ist (level.modifiersEnabled).
   * Ist der Typ im Level aus, entsteht nichts (es wird NICHT auf die nächste Regel ausgewichen –
   * so ist für den Spieler eindeutig, was ein Wort an dieser Stelle bewirkt).
   *   when(word, g)  word = { axis: "row"|"col", line, start, length, cells }, g = Geometrie-Helfer
   *   type           "trieb" | "stein" | "brunnen"
   * Zielfeld: stein/brunnen = Feld rechts vom letzten Buchstaben (waagerecht) bzw. darunter
   * (senkrecht); trieb = erstes freies Feld im Uhrzeigersinn um das Wort (siehe logic.js).
   */
  const MODIFIER_RULES = [
    // Mitte: Wort berührt eines der 4 zentralen Felder (|r-2,5| < 1 und |c-2,5| < 1)
    { type: "trieb",   when: (w, g) => w.cells.some((i) => g.isCenter(i)) },
    // waagerecht in der unteren Hälfte (Zeile 4–6) oder senkrecht in der linken Hälfte (Spalte 1–3)
    { type: "stein",   when: (w) => (w.axis === "row" && w.line >= 3) || (w.axis === "col" && w.line <= 2) },
    // senkrecht in der rechten Hälfte (Spalte 4–6) oder waagerecht in der oberen Hälfte (Zeile 1–3)
    { type: "brunnen", when: (w) => (w.axis === "col" && w.line >= 3) || (w.axis === "row" && w.line <= 2) }
  ];
  /** Seltene Buchstaben für Triebe (Auswahl per geseedetem PRNG). */
  const RARE_LETTERS = ["Q", "X", "Y", "J"];
  /** Dauer des gelben Aufblitzens der Vorschau (ms). */
  const PREVIEW_MS = 800;

  /** Undo-Tiefe (Spec: mindestens 20). */
  const HISTORY_LIMIT = 50;
  /** Sicherheitsgrenze gegen theoretisch endlose Kaskaden. */
  const MAX_CASCADE_LEVELS = 100;
  /** Max. Versuche, ein wortfreies Startbrett zu würfeln (Freies Spiel). */
  const MAX_BOARD_ATTEMPTS = 5000;
  /** Tag 1 der Tagesrätsel-Nummerierung (lokales Datum). */
  const DAILY_EPOCH = "2026-01-01";

  /*
   * MODI
   *   level  – Level 1..n aus src/levels.js (Fortschritt in localStorage)
   *   daily  – Tagesrätsel: ein Level aus der Liste, per Datum gewählt (für alle gleich)
   *   free   – Freies Spiel: Zufallsbrett, alle Modifikatoren, kein Zielwort (zum Ausprobieren)
   *   title(state)    Anzeige unter dem Titel
   *   shareTag(state) Kennung im Teilen-Text
   */
  const MODES = {
    level: {
      id: "level", label: "Level",
      title: (s) => `Level ${s.level.id} von ${s.levelCount}`,
      shareTag: (s) => `Level ${s.level.id}`
    },
    daily: {
      id: "daily", label: "Tagesrätsel",
      title: (s) => `Tagesrätsel #${s.puzzleNumber}`,
      shareTag: (s) => `Tagesrätsel #${s.puzzleNumber} · Level ${s.level.id}`
    },
    free: {
      id: "free", label: "Freies Spiel",
      title: () => "Freies Spiel",
      shareTag: () => "Freies Spiel"
    }
  };

  const config = {
    GRID_SIZE, MIN_WORD_LENGTH, WORD_LIST_RAW, LETTER_WEIGHTS, USE_UNIFORM_LETTERS,
    SHORT_MIN, SHORT_MAX, PROTECT_MIN, POINTS_PER_LETTER, BRUNNEN_FACTOR, COMBO_STEP, HINTS_PER_LEVEL, HINT_PENALTY,
    MODIFIER_RULES, RARE_LETTERS, PREVIEW_MS,
    HISTORY_LIMIT, MAX_CASCADE_LEVELS, MAX_BOARD_ATTEMPTS, DAILY_EPOCH, MODES
  };

  if (typeof module !== "undefined" && module.exports) module.exports = config;
  else root.LetterSlideConfig = config;
})(typeof globalThis !== "undefined" ? globalThis : this);
