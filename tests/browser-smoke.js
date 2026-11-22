// Optionaler Browser-Smoke-Test für Wortgarten (braucht lokales Chrome + puppeteer-core, NICHT Teil von `npm test`/CI).
//   npm i --no-save puppeteer-core   (oder PUPPETEER_CORE=/pfad/zu/puppeteer-core)
//   CHROME_PATH=/usr/bin/google-chrome SCREENSHOTS=/tmp/shots npm run test:browser
// Prüft: Startseite, Level 1 per UI lösen (Pfeil + Wischgeste), Level-Abschluss-Dialog, Hinweis, „Was passiert?“,
// Vorschau-Aufblitzen, Modifikator-Optik, Fortschritt in localStorage, Design-Variablen, iPhone-14-Layout, keine JS-Fehler.
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

async function openPage(browser, device) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
  page.on("dialog", (d) => { errors.push("nativer Dialog: " + d.message()); d.accept(); });
  if (device) await page.emulate(device); else await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: "load" });
  await page.evaluate(() => localStorage.clear());
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
const answer = async (page, value, touch) => { await press(page, value ? `#modal-actions button[data-value="${value}"]` : "#modal-actions button", touch); await modalGone(page); };
const waitScreen = (page, name) => page.waitForFunction((n) => LetterSlideApp.screen === n && !document.getElementById(n).hidden && !document.getElementById(n).classList.contains("off"), { timeout: 5000 }, name);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, PREFIX + name) }); };

/** Design-Check: bestehende Theme-Variablen sind weiter aktiv. */
async function designCheck(page) {
  const d = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const face = document.querySelector("#board .tile:not([class*='mod-']) .face");
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

/** Greift einen Zug aus der „Was passiert?“-Liste (optional bevorzugt mit fehlendem Typ). */
const pickModMove = (page, want) => page.evaluate((want) => {
  const list = LetterSlideLogic.whatIf(LetterSlideApp.game);
  return list.find((m) => m.placements.some((p) => want.includes(p.type))) || list[0] || null;
}, want);

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
  ok(/Stein/.test(how) && /Brunnen/.test(how) && /Trieb/.test(how) && /Vorschau/.test(how), "„So geht's“ erklärt Modifikatoren + Vorschau");
  await answer(page, null);

  await page.click("#start-level"); await waitScreen(page, "game");
  await waitModal(page); ok(/Willkommen|Zielwort|Wortgarten/i.test(await modalTitle(page)), "Tutorial-Popup Level 1: " + (await modalTitle(page)));
  await answer(page, "ok");
  ok((await page.$eval("#stat-mode", (e) => e.textContent)) === "Level 1 von 12", "Kopfzeile „Level 1 von 12“");
  ok((await page.$$("#target-slots .slot")).length === 6, "6 Ziel-Slots _ _ _ _ _ _");
  ok(/Warmes/.test(await page.$eval("#target-hint", (e) => e.textContent)), "Hinweistext „etwas Warmes“");
  ok(/Stein:\s*0.*Brunnen:\s*0.*Trieb:\s*0/s.test(await page.$eval("#modstatus", (e) => e.textContent)), "Modifikator-Status „Stein: 0 | Brunnen: 0 | Trieb: 0“");
  await designCheck(page);

  // „Was passiert?“
  await page.click("#btn-whatif"); await waitModal(page, /Was passiert/); ok(true, "„Was passiert?“-Dialog"); await answer(page, "ok");
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

  // Vorschau-Aufblitzen (Level 4: Stein)
  await page.evaluate(() => LetterSlideApp.startLevel(4)); await waitScreen(page, "game");
  await waitModal(page, /Stein/); await answer(page, "ok", true);
  ok(await page.$eval("#count-stein", (e) => !e.closest(".mod-chip").classList.contains("off")), "Level 4: Stein-Zähler aktiv");
  ok(await page.$eval("#count-brunnen", (e) => e.closest(".mod-chip").classList.contains("off")), "Level 4: Brunnen-Zähler ausgegraut");
  await sleep(900); // Brett-Intro abwarten
  const mv = await pickModMove(page, ["stein"]);
  ok(!!mv, "es gibt einen Zug, der einen Stein pflanzt");
  await page.evaluate((m) => { LetterSlideApp.handleSlide(m.axis, m.index, m.dir); }, mv);
  await page.waitForSelector("#board .tile.preview", { timeout: 3000 }).then(() => ok(true, "Vorschau blitzt gelb auf"), () => ok(false, "Vorschau blitzt gelb auf"));
  await sleep(220);
  await shot(page, "preview.png");
  ok(await page.$eval("#board .tile.preview", (e) => e.classList.contains("p-stein") && !!e.querySelector(".preview-ic")), "Vorschau zeigt Stein-Icon");
  await page.waitForFunction(() => !LetterSlideApp.busy || LetterSlideApp.modalOpen, { timeout: 20000 });
  await waitModal(page, /Stein/).then(() => answer(page, "ok", true), () => {});
  await idle(page);
  ok((await page.$$("#board .tile.mod-stein")).length >= 1, "Stein-Kachel liegt auf dem Brett");
  ok(Number(await page.$eval("#count-stein", (e) => e.textContent)) >= 1, "Stein-Zähler erhöht");
  // Undo stellt den Modifikator-Zustand wieder her
  await page.tap("#btn-undo"); await idle(page);
  ok((await page.$$("#board .tile.mod-stein")).length === 0, "Undo entfernt den gepflanzten Stein wieder");

  // Brett mit allen drei Modifikatortypen (Freies Spiel, echte Züge)
  await page.tap("#btn-menu").catch(() => {});
  await waitModal(page, /verlassen/).then(() => answer(page, "ok", true), () => {});
  await waitScreen(page, "start");
  await page.evaluate(() => { LetterSlideApp.stats.prefs.preview = false; });
  await page.evaluate(() => LetterSlideApp.startFree(20261122)); await waitScreen(page, "game");
  for (let k = 0; k < 40; k++) {
    const have = await page.evaluate(() => LetterSlideLogic.countModifiers(LetterSlideApp.game));
    const missing = ["stein", "brunnen", "trieb"].filter((t) => !have[t]);
    if (!missing.length) break;
    let m = await pickModMove(page, missing);
    if (!m) m = { axis: k % 2 ? "row" : "col", index: k % 6, dir: k % 3 ? 1 : -1 };
    await page.evaluate((m) => LetterSlideApp.handleSlide(m.axis, m.index, m.dir), m);
    await idle(page);
  }
  const vis = await page.evaluate(() => {
    const one = (t) => { const e = document.querySelector(`#board .tile.mod-${t} .face`); if (!e) return null; const s = getComputedStyle(e); return { bg: s.backgroundImage, ic: !!e.querySelector(".mod-ic") }; };
    return { stein: one("stein"), brunnen: one("brunnen"), trieb: one("trieb"), status: document.getElementById("modstatus").textContent };
  });
  ok(vis.stein && vis.stein.ic, "Stein: graue Kachel mit Stein-Icon");
  ok(vis.brunnen && vis.brunnen.ic && /url\(/.test(vis.brunnen.bg), "Brunnen: blaue Kachel mit Wellenmuster + Tropfen");
  ok(vis.trieb && vis.trieb.ic && /url\(/.test(vis.trieb.bg), "Trieb: grüne Kachel mit Sprossenmuster + Blatt");
  ok(/Stein:\s*[1-9].*Brunnen:\s*[1-9].*Trieb:\s*[1-9]/s.test(vis.status), "Status zählt alle drei: " + vis.status.replace(/\s+/g, " ").trim());
  await sleep(300);
  await shot(page, "modifiers.png");
  ok(errors.length === 0, "keine JS-Fehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--autoplay-policy=user-gesture-required"] });
  try {
    await desktop(browser);
    await iphone(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : "\nAlle Browser-Prüfungen bestanden");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
