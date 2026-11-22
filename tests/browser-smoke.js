// Optionaler Browser-Smoke-Test (braucht lokales Chrome + puppeteer-core, NICHT Teil von `npm test`/CI).
//   npm i --no-save puppeteer-core   (oder PUPPETEER_CORE=/pfad/zu/puppeteer-core)
//   CHROME_PATH=/usr/bin/google-chrome npm run test:browser
// Prüft: file:// ohne JS-Fehler, Spielablauf per Buttons/Tastatur, Manifest über http,
// iPhone-14-Emulation mit Touch (Wischgeste, Touch-Ziele >= 44 px, kein Querscrollen).
"use strict";
const path = require("path");
const fs = require("fs");
const http = require("http");
const puppeteer = require(process.env.PUPPETEER_CORE || "puppeteer-core");
const ROOT = path.resolve(__dirname, "..");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const SHOTS = process.env.SCREENSHOTS ? path.resolve(process.env.SCREENSHOTS) : null;

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) failures++; };

async function openPage(browser, url, setup) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
  // Native Dialoge sind ersetzt (In-Game-Modal) -> jeder native Dialog ist ein Fehler
  page.on("dialog", (d) => { errors.push("nativer Dialog: " + d.message()); d.accept(); });
  if (setup) await setup(page);
  await page.goto(url, { waitUntil: "load" });
  return { page, errors };
}
const idle = (page) => page.waitForFunction(() => !LetterSlideApp.busy, { timeout: 15000 });
const modalVisible = (page) => page.$eval("#modal", (m) => !m.hidden && getComputedStyle(m).display !== "none");
const waitModal = (page) => page.waitForFunction(() => { const m = document.getElementById("modal"); return !m.hidden && m.classList.contains("show"); }, { timeout: 5000 });
const modalTitle = (page) => page.$eval("#modal-title", (e) => e.textContent);
const shot = async (page, name) => { if (SHOTS) { await new Promise((r) => setTimeout(r, 250)); await page.screenshot({ path: path.join(SHOTS, name) }); } };
/** Sucht einen Zug, der punktet, und liefert ihn (ohne den Zustand zu verändern). */
const findScoringMove = (page) => page.evaluate(() => {
  const g = LetterSlideApp.game;
  for (const axis of ["row", "col"]) for (let i = 0; i < 6; i++) for (const d of [1, -1]) {
    const clone = { ...g, grid: g.grid.slice(), rng: { state: g.rng.state }, history: [] };
    if (LetterSlideLogic.performSlide(clone, axis, i, d).steps.length) return { axis, i, d };
  }
  return null;
});
const state = (page) => page.evaluate(() => ({ grid: LetterSlideApp.game.grid.join(""), moves: LetterSlideApp.game.moves, score: LetterSlideApp.game.score }));
/** Erwartetes Ergebnis eines Zuges an einer Kopie des Zustands vorausberechnen. */
const predict = (page, axis, i, dir) => page.evaluate((a, i, d) => {
  const g = LetterSlideApp.game;
  const clone = { ...g, grid: g.grid.slice(), rng: { state: g.rng.state }, history: [] };
  LetterSlideLogic.performSlide(clone, a, i, d);
  return clone.grid.join("");
}, axis, i, dir);

async function desktopFile(browser) {
  console.log("Desktop, file://");
  const { page, errors } = await openPage(browser, "file://" + path.join(ROOT, "index.html"),
    (p) => p.setViewport({ width: 1000, height: 900 }));
  ok(await page.$$eval("#board .tile", (t) => t.length) === 36, "36 Kacheln sichtbar");
  ok(await page.$$eval("button.arrow", (t) => t.length === 24 && t.every((b) => b.querySelector("svg use"))), "24 Randpfeile mit SVG-Icon");
  ok(await page.$$eval("#board .tile", (t) => new Set(t.map((x) => [...x.classList].find((c) => /^c\d$/.test(c)))).size) >= 3, "Kacheln in mehreren Pastellfarben");
  ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tile-0").trim().toUpperCase() === "#BFE6D3"), "Theme-Variablen aktiv");
  ok((await page.$eval("#stat-mode", (e) => e.textContent)).startsWith("Tagesrätsel #"), "Modus Tagesrätsel");
  const start = (await state(page)).grid;
  ok(start === await page.evaluate(() => LetterSlideLogic.startDaily().grid.join("")), "Tagesbrett deterministisch");

  const exp = await predict(page, "row", 1, 1);
  await page.click("#arrows-right button:nth-child(2)");
  ok(await page.evaluate(() => LetterSlideApp.busy), "Eingabe während Animation blockiert");
  await idle(page);
  let s = await state(page);
  ok(s.moves === 1 && s.grid === exp, "Randpfeil verschiebt Zeile 2 nach rechts");
  await page.click("#btn-undo");
  s = await state(page);
  ok(s.moves === 0 && s.grid === start, "Undo-Button");

  await page.mouse.click(...(await center(page, "#board .tile:nth-child(8)")));
  const exp2 = await predict(page, "col", 1, 1);
  await page.keyboard.press("ArrowDown"); await idle(page);
  s = await state(page);
  ok(s.moves === 1 && s.grid === exp2, "Tastatur: Auswahl + Pfeil runter");
  await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
  ok((await state(page)).moves === 0, "Strg+Z");

  let scored = false;
  for (let k = 0; k < 80 && !scored; k++) {
    const sel = ["#arrows-top", "#arrows-bottom", "#arrows-left", "#arrows-right"][k % 4] + ` button:nth-child(${(k % 6) + 1})`;
    await page.click(sel); await idle(page);
    scored = (await state(page)).score > 0;
  }
  ok(scored, "Treffer erzielt (Score " + (await state(page)).score + ")");

  await page.click('#mode-buttons button[data-mode="endless"]');
  await waitModal(page);
  ok(await modalTitle(page) === "Aktuelle Runde verwerfen?", "Moduswechsel fragt im In-Game-Dialog");
  await shot(page, "desktop-modal-confirm.png");
  await page.click('#modal-actions button[data-value="cancel"]');
  ok(!(await modalVisible(page)) && (await state(page)).moves > 0, "Abbrechen behält die Runde");
  await page.click('#mode-buttons button[data-mode="endless"]');
  await waitModal(page);
  await page.click('#modal-actions button[data-value="ok"]');
  ok(await page.$eval("#stat-mode", (e) => e.textContent) === "Endlos", "Endlos-Modus");
  ok((await state(page)).grid !== start, "Endlos-Brett anders");
  await page.click("#arrows-left button:nth-child(1)"); await idle(page);
  await page.click("#btn-end");
  await waitModal(page);
  ok(await modalTitle(page) === "Runde beendet", "Rundenende-Dialog");
  ok(await page.$eval("#ended-overlay", (e) => e.classList.contains("show")), "Runde beendet -> Overlay");
  ok(await page.$eval("button.arrow", (b) => b.disabled), "Pfeile gesperrt");
  await shot(page, "desktop-modal-ende.png");
  await page.click('#modal-actions button[data-value="share"]');
  await page.waitForFunction(() => document.getElementById("modal-title").textContent === "Teilen");
  await new Promise((r) => setTimeout(r, 300));
  const share = await page.$eval("#modal-body textarea", (e) => e.value);
  ok(/^Letter Slide Endlos · 1 Zug · \d+ Punkte/.test(share), "Teilen-Text: " + share);
  ok(/kopiert/.test(await page.$eval("#modal-body .status", (e) => e.textContent)), "Teilen kopiert in die Zwischenablage");
  await page.keyboard.press("Escape");
  ok(!(await modalVisible(page)), "Escape schließt den Dialog");
  await page.click("#btn-share"); await waitModal(page);
  await page.click('#modal-actions button[data-value="ok"]');
  ok(!(await modalVisible(page)), "Teilen-Button öffnet/schließt Dialog");
  await page.click("#btn-reset");
  ok((await state(page)).moves === 0 && !(await page.evaluate(() => LetterSlideApp.game.ended)), "Reset");
  await shot(page, "desktop.png");
  ok(errors.length === 0, "keine JS-Fehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await page.close();
}

async function center(page, sel) {
  const b = await (await page.$(sel)).boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
}

async function httpManifest(browser) {
  console.log("Desktop, http:// (Manifest)");
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json" }[path.extname(p)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type + "; charset=utf-8" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { page, errors } = await openPage(browser, `http://127.0.0.1:${server.address().port}/`);
  ok(await page.$eval('link[rel="manifest"]', (l) => !!l.href).catch(() => false), "Manifest verlinkt");
  const cdp = await page.createCDPSession();
  const m = await cdp.send("Page.getAppManifest");
  ok(m.errors.length === 0 && /Letter Slide/.test(m.data || ""), "Manifest geladen & gültig" + (m.errors.length ? ": " + JSON.stringify(m.errors) : ""));
  ok(errors.length === 0, "keine JS-Fehler über http" + (errors.length ? ": " + errors.join(" | ") : ""));
  await page.close();
  server.close();
}

async function iphone(browser) {
  const device = puppeteer.KnownDevices["iPhone 14"] || puppeteer.KnownDevices["iPhone 13"];
  console.log(`Mobil: ${device.name || "iPhone"} (${device.viewport.width}x${device.viewport.height}, Touch)`);
  const { page, errors } = await openPage(browser, "file://" + path.join(ROOT, "index.html"), (p) => p.emulate(device));
  const vp = await page.$eval('meta[name="viewport"]', (m) => m.content);
  ok(/width=device-width/.test(vp) && /initial-scale=1/.test(vp) && /viewport-fit=cover/.test(vp), "viewport-Meta: " + vp);
  ok(await page.$('meta[name="apple-mobile-web-app-capable"][content="yes"]') !== null, "apple-mobile-web-app-capable");
  ok(await page.evaluate(() => matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0), "Touch-Gerät emuliert");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "kein horizontales Scrollen");
  ok(await page.$eval("#board", (b) => getComputedStyle(b).touchAction === "none"), "touch-action: none auf dem Brett");
  const css = await page.evaluate(() => ({ ta: getComputedStyle(document.documentElement).touchAction, us: getComputedStyle(document.body).userSelect || getComputedStyle(document.body).webkitUserSelect, ob: getComputedStyle(document.documentElement).overscrollBehaviorY }));
  ok(css.ta === "manipulation" && css.us === "none" && css.ob === "none", "kein Doppeltipp-Zoom/Textauswahl/Overscroll " + JSON.stringify(css));
  const small = await page.$$eval("button", (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { t: b.getAttribute("aria-label") || b.textContent, w: r.width, h: r.height }; }).filter((x) => x.w < 44 || x.h < 44));
  ok(small.length === 0, "alle Buttons >= 44x44 px" + (small.length ? ": " + JSON.stringify(small.slice(0, 4)) : ""));
  const tile = await page.$eval("#board .tile", (t) => t.getBoundingClientRect().width);
  const board = await page.$eval("#board", (b) => ({ width: b.getBoundingClientRect().width }));
  ok(tile >= 44, `Kacheln ${tile.toFixed(1)} px (Brett ${board.width.toFixed(0)} px)`);
  const pf = await page.$eval("#playfield", (p) => { const r = p.getBoundingClientRect(); return { left: r.left, right: r.right }; });
  ok(pf.left >= 0 && pf.right <= device.viewport.width, "Spielfeld passt in die Breite");
  const ctrl = await page.$eval("#controls", (c) => c.getBoundingClientRect().bottom);
  ok(ctrl <= device.viewport.height, `Buttons ohne Scrollen sichtbar (unten bei ${ctrl.toFixed(0)} px)`);

  // Wischgeste waagerecht auf Kachel (Zeile 3, Spalte 2) -> Zeile 3 nach rechts
  const [x, y] = await center(page, "#board .tile:nth-child(14)"); // Index 13 = r2,c1
  const exp = await predict(page, "row", 2, 1);
  await page.touchscreen.touchStart(x, y);
  await page.touchscreen.touchMove(x + 20, y + 2);
  await page.touchscreen.touchMove(x + 45, y + 3);
  await page.touchscreen.touchEnd();
  await idle(page);
  let s = await state(page);
  ok(s.moves === 1 && s.grid === exp, "Wischen waagerecht verschiebt die Zeile (1 Zug)");

  // Wischgeste senkrecht nach oben -> Spalte nach oben
  const [x2, y2] = await center(page, "#board .tile:nth-child(23)"); // Index 22 = r3,c4
  const exp2 = await predict(page, "col", 4, -1);
  await page.touchscreen.touchStart(x2, y2);
  await page.touchscreen.touchMove(x2 + 2, y2 - 20);
  await page.touchscreen.touchMove(x2 + 3, y2 - 50);
  await page.touchscreen.touchEnd();
  await idle(page);
  s = await state(page);
  ok(s.moves === 2 && s.grid === exp2, "Wischen senkrecht verschiebt die Spalte (1 Zug)");

  // Kurzes Tippen = Auswahl, kein Zug
  await page.touchscreen.tap(x, y);
  await new Promise((r) => setTimeout(r, 100));
  ok((await state(page)).moves === 2 && await page.$("#board .tile.sel") !== null, "Tippen wählt Kachel aus, kein Zug");

  // Tippen auf Randpfeil per Touch
  await page.tap("#arrows-bottom button:nth-child(1)"); await idle(page);
  ok((await state(page)).moves === 3, "Randpfeil per Touch");
  ok(await page.evaluate(() => !!LetterSlideAudio.ctx), "AudioContext nach erster Berührung angelegt (iOS-Unlock)");
  await shot(page, "iphone.png");

  // Treffer-Animation festhalten (goldene Kacheln + Wort-Einblendung)
  let mv = null;
  for (let k = 0; k < 40 && !mv; k++) {
    mv = await findScoringMove(page);
    if (!mv) { await page.tap(`#arrows-right button:nth-child(${(k % 6) + 1})`); await idle(page); }
  }
  ok(!!mv, "Treffer-Zug gefunden");
  if (mv) {
    page.evaluate((m) => LetterSlideApp.handleSlide(m.axis, m.i, m.d), mv);
    await page.waitForSelector("#board .tile.hit", { timeout: 3000 });
    ok(true, "Treffer leuchten (.hit)");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "iphone-treffer.png") });
    await idle(page);
  }

  // Dialoge auf dem iPhone: Bestätigen + Teilen, Buttons >= 44 px, passt in den Viewport
  await page.tap('#mode-buttons button[data-mode="endless"]');
  await waitModal(page);
  await new Promise((r) => setTimeout(r, 300)); // Einblend-Animation (scale) abwarten
  const card = await page.$eval(".modal-card", (c) => { const r = c.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  ok(card.l >= 0 && card.r <= device.viewport.width && card.t >= 0 && card.b <= device.viewport.height, "Dialog passt auf den Bildschirm");
  ok(await page.$$eval("#modal-actions button", (bs) => bs.every((b) => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })), "Dialog-Buttons >= 44 px");
  await shot(page, "iphone-modal-confirm.png");
  await page.tap('#modal-actions button[data-value="cancel"]');
  await page.tap("#btn-share"); await waitModal(page);
  await shot(page, "iphone-modal-teilen.png");
  await page.tap('#modal-actions button[data-value="ok"]');
  ok(!(await modalVisible(page)), "Dialog per Touch geschlossen");
  ok(errors.length === 0, "keine JS-Fehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--autoplay-policy=user-gesture-required"] });
  try {
    await desktopFile(browser);
    await httpManifest(browser);
    await iphone(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : "\nAlle Browser-Prüfungen bestanden");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
