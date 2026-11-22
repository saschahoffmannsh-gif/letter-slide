// Optionaler Browser-Smoke-Test für Wortgarten (braucht lokales Chrome + puppeteer-core, NICHT Teil von `npm test`/CI).
//   npm i --no-save puppeteer-core   (oder PUPPETEER_CORE=/pfad/zu/puppeteer-core)
//   CHROME_PATH=/usr/bin/google-chrome SCREENSHOTS=/tmp/shots npm run test:browser
// Prüft: Startseite, Level 1 per UI lösen (Pfeil + Wischgeste), Level-Abschluss-Dialog, Hinweis,
// Schutz-Markierung, Fortschritt in localStorage, Design-Variablen, iPhone-14-Layout, Lehr-Level, keine JS-Fehler.
"use strict";
const path = require("path");
const puppeteer = require(process.env.PUPPETEER_CORE || "puppeteer-core");
const ROOT = path.resolve(__dirname, "..");
const URL = "file://" + path.join(ROOT, "index.html");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const SHOTS = process.env.SCREENSHOTS ? path.resolve(process.env.SCREENSHOTS) : null;
const PREFIX = process.env.SHOT_PREFIX || "wortgarten-";

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(browser, device, seed = { tutorial: { done: {}, skipped: true } }) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
  page.on("dialog", (d) => { errors.push("nativer Dialog: " + d.message()); d.accept(); });
  if (device) await page.emulate(device); else await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: "load" });
  // Standard: Tutorial übersprungen (prüft die klassischen Abläufe + Tipp-Popups als Rückfall);
  // seed = null -> frischer Spieler (geführtes Lehr-Level).
  await page.evaluate((seed) => { localStorage.clear(); if (seed) localStorage.setItem("wortgartenStats.v1", JSON.stringify(seed)); }, seed);
  await page.reload({ waitUntil: "load" });
  return { page, errors };
}
const idle = (page) => page.waitForFunction(() => !LetterSlideApp.busy, { timeout: 20000 });
const waitModal = (page, re) => page.waitForFunction((src) => {
  const m = document.getElementById("modal");
  return !m.hidden && m.classList.contains("show") && (!src || new RegExp(src).test(document.getElementById("modal-title").textContent));
}, { timeout: 8000 }, re ? re.source : null);
const modalGone = (page) => page.waitForFunction(() => !LetterSlideApp.modalOpen, { timeout: 5000 });
const modalTitle = (page) => page.$eval("#modal-title", (e) => e.textContent);
const press = async (page, sel, touch) => { if (touch) await page.tap(sel); else await page.click(sel); };
const answer = async (page, value, touch) => { await sleep(300); /* Einblend-Animation des Dialogs abwarten */ await press(page, value ? `#modal-actions button[data-value="${value}"]` : "#modal-actions button", touch); await modalGone(page); };
const waitScreen = (page, name) => page.waitForFunction((n) => LetterSlideApp.screen === n && !document.getElementById(n).hidden && !document.getElementById(n).classList.contains("off"), { timeout: 5000 }, name);
/** Offene Tutorial-Tipps nach einem Zug schließen (Reihenfolge kann je nach Brett variieren). */
async function dismissTips(page, touch) {
  for (let k = 0; k < 4; k++) {
    await sleep(150);
    if (!(await page.evaluate(() => LetterSlideApp.modalOpen))) return;
    await press(page, "#modal-actions button", touch); // nächster Tipp kann direkt folgen
    await sleep(400);
  }
}
/** Markierte (geschützte) Felder im DOM == Regel der Logik? */
const protectCheck = (page) => page.evaluate(() => {
  const g = LetterSlideApp.game;
  const want = [...LetterSlideLogic.protectedCells(g.grid, g.target)].sort((a, b) => a - b);
  const have = [...document.querySelectorAll("#board .tile.protected")].map((t) => Number(t.dataset.r) * 6 + Number(t.dataset.c)).sort((a, b) => a - b);
  return { want, have };
});
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, PREFIX + name) }); };
const shotAs = async (page, file) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, file) }); };

/* ---------- Coach-Marks (Lehr-Level) ---------- */
const coachInfo = (page) => page.evaluate(() => {
  const w = document.getElementById("coach"), b = w.querySelector(".coach-bubble"), r = b.getBoundingClientRect();
  return { on: !w.hidden && w.classList.contains("show") && !w.classList.contains("away"), text: w.querySelector(".coach-text").textContent,
    count: w.querySelector(".coach-count").textContent, inView: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
    dimmed: document.querySelectorAll("#game.coach-on .coach-dim").length, pulse: [...document.querySelectorAll(".coach-pulse")].map((e) => e.id || e.dataset.axis + e.dataset.index + e.dataset.dir || e.className) };
});
const waitCoach = (page, re) => page.waitForFunction((src) => {
  const w = document.getElementById("coach");
  return !w.hidden && w.classList.contains("show") && !w.classList.contains("away") && new RegExp(src).test(w.querySelector(".coach-text").textContent);
}, { timeout: 10000 }, re.source);
const coachNext = async (page) => { await sleep(250); await page.tap("#coach .coach-next"); await sleep(150); };
const arrowSel = (mv) => { const m = /^([RC])([1-6])([+-])$/.exec(mv); return `button.arrow[data-axis="${m[1] === "R" ? "row" : "col"}"][data-index="${Number(m[2]) - 1}"][data-dir="${m[3] === "+" ? 1 : -1}"]`; };

/** Design-Check: bestehende Theme-Variablen sind weiter aktiv. */
async function designCheck(page) {
  const d = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const face = document.querySelector("#board .tile:not(.protected) .face") || document.querySelector("#board .tile .face");
    const fs = face && getComputedStyle(face);
    const pill = getComputedStyle(document.querySelector("#controls .pill"));
    return {
      tileFace: root.getPropertyValue("--tile-face").trim(), bg: getComputedStyle(document.body).backgroundColor,
      faceBg: fs && fs.backgroundImage, ink: fs && fs.color, titleA: getComputedStyle(document.querySelector("#game .title .t-letter")).color,
      pillFont: pill.fontFamily
    };
  });
  ok(d.tileFace.toUpperCase() === "#FFFFFF", "--tile-face weiterhin weiß");
  ok(d.bg === "rgb(251, 243, 228)", "Creme-Hintergrund (--bg) unverändert: " + d.bg);
  ok(/rgb\(255, 255, 255\)/.test(d.faceBg || ""), "normale Kachel weiß (--tile-face)");
  ok(d.ink === "rgb(74, 52, 38)", "braune Buchstaben (--tile-ink)");
  ok(/ui-rounded|Nunito/.test(d.pillFont), "gleiche runde Schrift");
}

async function desktop(browser) {
  console.log("Desktop (1280×900, file://)");
  const { page, errors } = await openPage(browser);
  await waitScreen(page, "start");
  ok(/WORT\s*GARTEN/i.test(await page.$eval("#start h1", (e) => e.textContent)), "Titel WORTGARTEN");
  ok((await page.$eval("#start-level-title", (e) => e.textContent)) === "Level 1 spielen", "Startbutton „Level 1 spielen“");
  ok(/^Tagesrätsel #\d+$/.test(await page.$eval("#start-daily-title", (e) => e.textContent)), "Tagesrätsel-Button");
  ok(!!(await page.$("#start-free")), "Freies Spiel");
  await page.click("#start-howto"); await waitModal(page, /So geht/);
  const how = await page.$eval("#modal-body", (e) => e.textContent);
  ok(/Zielwort/.test(how) && /zerbröseln nie/.test(how) && /Kaskade/.test(how), "„So geht's“ erklärt Zielwort, Schutz und Punkte");
  await answer(page, "ok");

  await page.click("#start-level"); await waitScreen(page, "game");
  await waitModal(page); ok(/Willkommen|Zielwort|Wortgarten/i.test(await modalTitle(page)), "Tutorial-Popup Level 1: " + (await modalTitle(page)));
  await answer(page, "ok");
  ok((await page.$eval("#stat-mode", (e) => e.textContent)) === "Level 1 von 12", "Kopfzeile „Level 1 von 12“");
  ok((await page.$$("#target-slots .slot")).length === 6, "6 Ziel-Slots _ _ _ _ _ _");
  ok(/Warmes/.test(await page.$eval("#target-hint", (e) => e.textContent)), "Hinweistext „etwas Warmes“");
  await designCheck(page);
  const pc = await protectCheck(page);
  ok(pc.want.length === 6 && JSON.stringify(pc.want) === JSON.stringify(pc.have), `alle 6 Zielbuchstaben dezent markiert: ${pc.have.join(",")}`);
  ok(await page.$eval("#board .tile.protected .face", (f) => getComputedStyle(f, "::after").content !== "none"), "Unterstrich an geschützten Kacheln");

  // Hinweis (mit Rückfrage)
  await page.click("#btn-hint"); await waitModal(page, /Hinweis nehmen/); await page.click('#modal-actions button[data-value="ok"]');
  await waitModal(page, /Hinweis 1\/3/);
  ok(/Das Wort enthält ein [A-Z]/.test(await page.$eval("#modal-body", (e) => e.textContent)), "Hinweis nennt Buchstabe + Lage");
  await answer(page, "ok");
  ok(await page.$eval("#hint-line", (e) => !e.hidden && e.textContent.length > 10), "Hinweiszeile sichtbar");
  ok((await page.$$("#target-slots .slot.revealed")).length === 1, "ein Slot aufgedeckt");
  ok((await page.$eval("#hint-count", (e) => e.textContent)) === "2", "Hinweis-Zähler 2");

  // Level 1 per Pfeil lösen: Zeile 1 nach links
  await page.click('button.arrow[data-axis="row"][data-index="0"][data-dir="-1"]');
  await waitModal(page, /Level 1 gelöst!/);
  const body = await page.$eval("#modal-body", (e) => e.textContent);
  ok(/WAERME/.test(body) && /48 Punkte/.test(body) && /Züge: 1/.test(body), "Abschluss: WAERME · 48 Punkte (60 − 20 %) · Züge: 1");
  ok(!!(await page.$('#modal-actions button[data-value="next"]')), "Button „Nächstes Level“");
  const prog = await page.evaluate(() => JSON.parse(localStorage.getItem("wortgartenStats.v1")).progress);
  ok(prog.unlocked === 2 && prog.best["1"] === 48, "Fortschritt in localStorage gespeichert");
  await answer(page, "next");
  ok((await page.$eval("#stat-mode", (e) => e.textContent)) === "Level 2 von 12", "Nächstes Level geladen");
  ok((await page.$$("#target-slots .slot")).length === 4, "Level 2: 4 Slots (MOND)");
  ok((await page.$eval("#hint-count", (e) => e.textContent)) === "3", "Hinweise pro Level zurückgesetzt");
  await page.click("#btn-menu"); await waitScreen(page, "start");
  ok((await page.$eval("#start-level-title", (e) => e.textContent)) === "Level 2 spielen", "Startseite: „Level 2 spielen“");
  ok(errors.length === 0, "keine JS-Fehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await page.close();
}

async function iphone(browser) {
  const device = puppeteer.KnownDevices["iPhone 14"];
  console.log(`iPhone 14 (${device.viewport.width}×${device.viewport.height}, Touch)`);
  const { page, errors } = await openPage(browser, device);
  await waitScreen(page, "start");
  await sleep(500);
  await shot(page, "start.png");
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  ok(await noHScroll(), "Startseite ohne Querscrollen");
  ok(await page.$$eval("#start button", (bs) => bs.filter((b) => !b.hidden).every((b) => b.getBoundingClientRect().height >= 44)), "Start-Buttons >= 44 px");

  await page.tap("#start-level"); await waitScreen(page, "game");
  await waitModal(page); await answer(page, "ok", true);
  await sleep(400);
  await shot(page, "level1.png");
  const lay = await page.evaluate(() => ({ ctrl: document.getElementById("controls").getBoundingClientRect().bottom, vh: innerHeight, board: document.getElementById("board").getBoundingClientRect().width,
    small: [...document.querySelectorAll("#game button")].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44)).map((b) => b.id || b.className) }));
  ok(lay.ctrl <= lay.vh, `ganzes Spiel passt in den Bildschirm (Steuerung endet bei ${Math.round(lay.ctrl)} von ${lay.vh} px)`);
  ok(lay.board >= 240, `Brett ${Math.round(lay.board)} px breit`);
  ok(lay.small.length === 0, "alle Touch-Ziele >= 44 px" + (lay.small.length ? ": " + lay.small.join(",") : ""));
  ok(await noHScroll(), "Spiel ohne Querscrollen");
  await designCheck(page);

  // Level 1 per Wischgeste lösen: Kachel in Zeile 1 nach links wischen
  const t = await page.$eval('#board .tile[data-r="0"][data-c="3"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; });
  await page.touchscreen.touchStart(t.x, t.y);
  for (let k = 1; k <= 6; k++) await page.touchscreen.touchMove(t.x - (t.w * 0.9 * k) / 6, t.y);
  await page.touchscreen.touchEnd();
  await page.waitForFunction(() => document.querySelector("#bloom.show") && document.querySelectorAll("#board .tile.bloom").length === 6, { timeout: 8000 }).then(() => ok(true, "Zielwort blüht auf"), () => ok(false, "Zielwort blüht auf"));
  await waitModal(page, /Level 1 gelöst!/);
  ok(/60 Punkte/.test(await page.$eval("#modal-body", (e) => e.textContent)), "Level 1 per Wischen gelöst: 60 Punkte");
  const card = await page.$eval(".modal-card", (c) => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; });
  ok(card, "Abschluss-Dialog passt auf den Bildschirm");
  await sleep(300);
  await shot(page, "complete.png");
  await answer(page, "menu", true).catch(() => {});
  if (await page.evaluate(() => LetterSlideApp.modalOpen)) await answer(page, "next", true);

  // Level 4: Zielbuchstaben sind markiert, ein Zug und Undo funktionieren ohne Modifikatoren
  await page.evaluate(() => LetterSlideApp.startLevel(4)); await waitScreen(page, "game");
  await sleep(400);
  await dismissTips(page, true);
  const pc4 = await protectCheck(page);
  ok(pc4.want.length === 5 && JSON.stringify(pc4.want) === JSON.stringify(pc4.have), "Level 4: Markierung = benötigte Zielbuchstaben der Logik");
  ok((await page.$$("#board .tile.protected")).length === 5, "Level 4: 5 Zielbuchstaben (BLUME) lila markiert");
  await page.tap(arrowSel("C1+"));
  await idle(page);
  await dismissTips(page, true);
  const after = await page.evaluate(() => LetterSlideApp.game.moves);
  ok(after === 1, "Level 4: Zug ausgeführt");
  await page.tap("#btn-undo"); await idle(page);
  ok((await page.evaluate(() => LetterSlideApp.game.moves)) === 0, "Undo stellt den Zug zurück");
  await sleep(300);
  await shot(page, "level4.png");
  ok(errors.length === 0, "keine JS-Fehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await page.close();
}

/** Geführtes Tutorial auf dem iPhone 14: Coach-Marks, Sperre falscher Aktionen, Weiter, Überspringen, Wiederholen. */
async function iphoneTutorial(browser) {
  const device = puppeteer.KnownDevices["iPhone 14"];
  console.log("iPhone 14 – Lehr-Level (frischer Spieler)");
  const { page, errors } = await openPage(browser, device, null);
  await waitScreen(page, "start");
  ok((await page.$eval("#start-level-sub", (e) => e.textContent)).includes("Lehr-Level"), "Startseite: „Level 1 spielen“ startet das Lehr-Level");
  ok(await page.$eval("#start-tutorial", (e) => e.hidden), "„Tutorial wiederholen“ erst nach dem ersten Durchlauf");
  await page.tap("#start-level"); await waitScreen(page, "game");
  await waitCoach(page, /Hinweis/);
  let c = await coachInfo(page);
  ok(c.on && c.inView && c.count === "1/7", `L1 Schritt 1 erklärt den Hinweis, Blase auf dem Bildschirm (${c.count})`);
  ok(c.dimmed > 5, "Rest des Spiels leicht abgedunkelt");
  ok(!(await page.evaluate(() => LetterSlideApp.modalOpen)), "kein altes Tipp-Popup");
  ok(await page.$eval("#stat-combo", (e) => getComputedStyle(e).opacity === "0"), "Combo-Wolke im Level-Modus versteckt");
  ok((await page.$$("#target-slots .slot.ghost")).length === 5, "Slots zeigen den Fortschritt WAERM zart (Geister-Buchstaben)");
  await sleep(300);
  await shotAs(page, "tutorial-l1-hint.png");
  // falsche Aktion während eines Info-Schritts: Zug wird blockiert, Blase wackelt
  await page.tap(arrowSel("R1-"));
  await sleep(80);
  ok(await page.$eval(".coach-bubble", (b) => b.classList.contains("coach-shake")), "falsche Aktion -> sanftes Wackeln");
  ok((await page.evaluate(() => LetterSlideApp.game.moves)) === 0, "… und kein Zug");
  await coachNext(page); await waitCoach(page, /Strich/);
  ok((await coachInfo(page)).count === "2/7", "Weiter -> Schritt 2 (Slots)");
  await coachNext(page); await waitCoach(page, /Pfeil am Rand/);
  await coachNext(page); await waitCoach(page, /wischst/);
  await coachNext(page); await waitCoach(page, /nach links/);
  c = await coachInfo(page);
  ok(c.pulse.includes("row0-1") && c.inView, "Zug-Schritt: Pfeil ← von Zeile 1 pulsiert");
  ok(await page.$eval("#coach .coach-next", (b) => b.hidden), "Zug-Schritt hat keinen Weiter-Knopf");
  await sleep(300);
  await shotAs(page, "tutorial-l1-slide.png");
  await page.tap(arrowSel("R3+")); await sleep(100);
  ok((await page.evaluate(() => LetterSlideApp.game.moves)) === 0, "falscher Pfeil blockiert");
  await page.tap("#btn-hint"); await sleep(150);
  ok(!(await page.evaluate(() => LetterSlideApp.modalOpen)), "falscher Knopf (Hinweis) blockiert");
  // richtige Aktion per Wischgeste
  const t = await page.$eval('#board .tile[data-r="0"][data-c="3"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; });
  await page.touchscreen.touchStart(t.x, t.y);
  for (let k = 1; k <= 6; k++) await page.touchscreen.touchMove(t.x - (t.w * 0.9 * k) / 6, t.y);
  await page.touchscreen.touchEnd();
  await waitCoach(page, /Geschafft/);
  ok((await page.evaluate(() => LetterSlideApp.game.solved && LetterSlideApp.game.moves)) === 1, "richtige Wischgeste löst Level 1 und führt weiter (Jubel)");
  await coachNext(page); await waitCoach(page, /6 Buchstaben × 10/);
  ok((await coachInfo(page)).count === "7/7", "Punkte werden kurz erklärt");
  await coachNext(page);
  await waitModal(page, /Level 1 gelöst!/);
  ok(true, "danach Abschluss-Dialog „Level 1 gelöst!“");
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem("wortgartenStats.v1")).tutorial.done["1"] === true), "Lehr-Level 1 als erledigt gespeichert");
  await answer(page, "next", true);

  // Level 2: senkrechte Wörter, jeder Zug geführt
  await waitCoach(page, /senkrecht/);
  ok((await coachInfo(page)).inView, "L2: senkrechte Wörter erklärt");
  await coachNext(page); await waitCoach(page, /Zeile 1 nach rechts/);
  ok((await coachInfo(page)).pulse.includes("row01"), "L2: Pfeil → von Zeile 1 pulsiert");
  await sleep(300);
  await shotAs(page, "tutorial-l2-move.png");
  await page.tap(arrowSel("R1+"));
  await waitCoach(page, /zerbröseln/);
  ok(/[A-Z]{3}/.test((await coachInfo(page)).text), "L2: kurze Wörter des Zugs werden genannt: " + (await coachInfo(page)).text.match(/\(([^)]*)\)/)?.[1]);
  await coachNext(page); await waitCoach(page, /zerbröseln nie/);
  ok((await page.$$("#board .tile.protected.coach-focus")).length >= 2, "L2: geschützte (lila) Kacheln hervorgehoben");
  ok((await page.$$("#target-slots .slot.ghost")).length >= 2, "L2: Fortschritt als Geister-Buchstaben in den Slots");
  // Überspringen
  await sleep(250);
  await page.tap("#coach .coach-skip"); await sleep(300);
  ok(!(await coachInfo(page)).on, "Überspringen blendet den Coach aus");
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem("wortgartenStats.v1")).tutorial.skipped === true), "Überspringen gespeichert");
  await page.tap(arrowSel("R6+")); await idle(page);
  ok((await page.evaluate(() => LetterSlideApp.game.moves)) === 2, "nach dem Überspringen ist jeder Zug erlaubt");
  await dismissTips(page, true);

  // Wiederholen über die Startseite
  await page.tap("#btn-menu"); await waitModal(page, /verlassen/); await answer(page, "ok", true);
  await waitScreen(page, "start");
  ok(!(await page.$eval("#start-tutorial", (e) => e.hidden)), "Startseite: „Tutorial wiederholen“ sichtbar");
  await page.tap("#start-tutorial"); await waitScreen(page, "game");
  await waitCoach(page, /Willkommen/);
  ok((await page.evaluate(() => LetterSlideApp.game.level.id)) === 1 && (await coachInfo(page)).count === "1/7", "Tutorial startet wieder bei Level 1");
  // … und über „So geht's“
  await page.tap("#btn-howto"); await waitModal(page, /So geht/);
  ok(!!(await page.$('#modal-actions button[data-value="tutorial"]')), "„So geht's“ bietet „Tutorial wiederholen“");
  await answer(page, "ok", true);
  ok(errors.length === 0, "keine JS-Fehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--autoplay-policy=user-gesture-required"] });
  try {
    await desktop(browser);
    await iphone(browser);
    await iphoneTutorial(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : "\nAlle Browser-Prüfungen bestanden");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
