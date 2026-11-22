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
const LetterSlideParticlesMax = 2500;
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

/** Wartet, bis die Partikel-Ebene leer ist, und prüft, dass die Canvas wirklich leer gezeichnet ist. */
const particlesCleared = (page) => page.waitForFunction(() => {
  const P = LetterSlideParticles;
  if (P.alive !== 0 || P.running) return false;
  const c = document.getElementById("particles");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 16) if (d[i] !== 0) return false;
  return true;
}, { timeout: 5000 }).then(() => true, () => false);
/**
 * Canvas über einer zerfallenden Kachel auswerten: Deckung (Anteil deckender Pixel) oben/unten
 * und die Grenze des intakten Rests (erste Zeile von oben, ab der die Kachel geschlossen ist).
 */
const sampleDissolve = (page, k = 0) => page.evaluate((k) => {
  const t = LetterSlideParticles.debugTiles()[k];
  if (!t) return null;
  const c = document.getElementById("particles");
  const dpr = c.width / innerWidth;
  const x0 = Math.round((t.x + t.w * 0.15) * dpr), w = Math.round(t.w * 0.7 * dpr);
  const y0 = Math.round(t.y * dpr), h = Math.round(t.h * dpr);
  const d = c.getContext("2d").getImageData(x0, y0, w, h).data;
  const rowCov = [];
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 200) n++; rowCov.push(n / w); }
  const band = (a, b) => { const r = rowCov.slice(Math.floor(a * h), Math.ceil(b * h)); return r.reduce((s, v) => s + v, 0) / r.length; };
  let boundary = 1;
  for (let y = 0; y < h - 2; y++) if (rowCov[y] > 0.97 && rowCov[y + 1] > 0.97 && rowCov[y + 2] > 0.97) { boundary = y / h; break; }
  return { progress: t.progress, top: band(0, 0.15), bottom: band(0.82, 0.95), boundary };
}, k);

const screenIs = (page, name) => page.evaluate((n) => LetterSlideApp.screen === n && !document.getElementById(n).hidden, name);
const waitScreen = (page, name) => page.waitForFunction((n) => LetterSlideApp.screen === n && !document.getElementById(n).classList.contains("off") && !document.getElementById(n).hidden, { timeout: 5000 }, name);

/** Spielt Randpfeile, bis ein Zug punktet (über die echte UI). */
async function playUntilScore(page, clickFn) {
  for (let k = 0; k < 80; k++) {
    const mv = await findScoringMove(page);
    if (mv) {
      const before = await page.evaluate(() => LetterSlideParticles.spawnedTotal);
      await page.evaluate((m) => { LetterSlideApp.handleSlide(m.axis, m.i, m.d); }, mv);
      return before;
    }
    await clickFn(["#arrows-top", "#arrows-bottom", "#arrows-left", "#arrows-right"][k % 4] + ` button:nth-child(${(k % 6) + 1})`);
    await idle(page);
  }
  return null;
}

async function desktopFile(browser) {
  console.log("Desktop, file://");
  const { page, errors } = await openPage(browser, "file://" + path.join(ROOT, "index.html"),
    (p) => p.setViewport({ width: 1000, height: 900 }));
  // Startseite
  ok(await screenIs(page, "start") && await page.$eval("#game", (g) => g.hidden), "Startseite beim Laden sichtbar, Spiel verborgen");
  const n = await page.evaluate(() => LetterSlideLogic.dailyPuzzleNumber(LetterSlideLogic.formatDateKey(new Date())));
  ok((await page.$eval("#start-daily-title", (e) => e.textContent)) === `Tagesrätsel #${n}`, `Startknopf „Tagesrätsel #${n}“`);
  ok(/\d{2}\.\d{2}\.\d{4}/.test(await page.$eval("#start-daily-sub", (e) => e.textContent)), "Datum am Tagesrätsel-Knopf");
  ok(await page.$eval("#start-share", (e) => e.hidden && e.getClientRects().length === 0), "„Ergebnis teilen“ noch verborgen");
  await page.click("#start-howto"); await waitModal(page);
  ok(await modalTitle(page) === "So geht's" && await page.$$eval(".score-table tr", (r) => r.length) === 4, "„So geht's“-Dialog mit Punktetabelle");
  await page.keyboard.press("Escape");
  await page.click("#start-daily");
  await waitScreen(page, "game");
  ok(await screenIs(page, "game") && await page.$eval("#start", (e) => e.hidden), "Tagesrätsel gestartet -> Spielbildschirm");

  ok(await page.$$eval("#board .tile", (t) => t.length) === 36, "36 Kacheln sichtbar");
  ok(await page.$$eval("button.arrow", (t) => t.length === 24 && t.every((b) => b.querySelector("svg use"))), "24 Randpfeile mit SVG-Icon");
  ok(await page.$$eval("#board .tile .face", (fs) => fs.every((f) => { const c = getComputedStyle(f); return c.backgroundImage.includes("rgb(255, 255, 255)") && c.color === "rgb(74, 52, 38)"; })), "alle 36 Kacheln weiß mit dunkelbraunem Buchstaben");
  ok(await page.$$eval("#board .tile", (ts) => ts.every((t) => !/\bc\d\b/.test(t.className))), "keine Pastell-Kachelklassen mehr");
  ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tile-face").trim().toUpperCase() === "#FFFFFF"), "Theme-Variable --tile-face aktiv");
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

  // Treffer -> Partikel
  const before = await playUntilScore(page, (sel) => page.click(sel));
  ok(before !== null, "Treffer-Zug gefunden");
  await page.waitForFunction(() => LetterSlideParticles.alive > 0, { timeout: 3000 }).catch(() => {});
  const spawned = await page.evaluate((b) => ({ alive: LetterSlideParticles.alive, spawned: LetterSlideParticles.spawnedTotal - b }), before);
  ok(spawned.alive > 0 && spawned.spawned >= 100, `Partikel gespawnt (${spawned.spawned} Körner, ${spawned.alive} aktiv)`);
  ok(spawned.alive <= LetterSlideParticlesMax, "Partikel-Limit eingehalten");
  await page.waitForFunction(() => { const t = LetterSlideParticles.debugTiles()[0]; return t && t.progress >= 0.5; }, { polling: "raf", timeout: 3000 });
  const mid = await sampleDissolve(page, 0);
  ok(mid && mid.top < 0.35 && mid.bottom > 0.9, `Auflösen von oben: bei ${Math.round(mid.progress * 100)} % oben ${Math.round(mid.top * 100)} % Deckung, unten ${Math.round(mid.bottom * 100)} % (intakt)`);
  await idle(page);
  ok((await state(page)).score > 0, "Treffer erzielt (Score " + (await state(page)).score + ")");
  ok(await particlesCleared(page), "Partikel verschwinden, Canvas danach leer, rAF gestoppt");

  // Undo direkt nach einem Treffer entfernt alle Körner sofort
  const b2 = await playUntilScore(page, (sel) => page.click(sel));
  if (b2 !== null) {
    await idle(page);
    const aliveBefore = await page.evaluate(() => LetterSlideParticles.alive);
    await page.click("#btn-undo");
    const after = await page.evaluate(() => ({ alive: LetterSlideParticles.alive, running: LetterSlideParticles.running }));
    ok(after.alive === 0 && !after.running, `Undo entfernt restliche Körner (${aliveBefore} -> 0)`);
  }

  // Menü mit laufender Runde -> Bestätigung
  await page.click("#btn-menu");
  await waitModal(page);
  ok(await modalTitle(page) === "Aktuelle Runde verwerfen?", "Menü fragt im In-Game-Dialog");
  await shot(page, "desktop-modal-confirm.png");
  await page.click('#modal-actions button[data-value="cancel"]');
  ok(!(await modalVisible(page)) && await screenIs(page, "game"), "Abbrechen bleibt im Spiel");

  // Tagesrätsel beenden -> Ergebnis gespeichert
  await page.click("#btn-end");
  await waitModal(page);
  ok(await modalTitle(page) === "Runde beendet", "Rundenende-Dialog");
  ok(await page.$eval("#ended-overlay", (e) => e.classList.contains("show")), "Runde beendet -> Overlay");
  ok(await page.$eval("button.arrow", (b) => b.disabled), "Pfeile gesperrt");
  const dailyScore = (await state(page)).score;
  await shot(page, "desktop-modal-ende.png");
  await page.click('#modal-actions button[data-value="share"]');
  await page.waitForFunction(() => document.getElementById("modal-title").textContent === "Teilen");
  await new Promise((r) => setTimeout(r, 300));
  const share = await page.$eval("#modal-body textarea", (e) => e.value);
  ok(new RegExp(`^Letter Slide #${n} · \\d+ Z(ug|üge) · ${dailyScore} Punkte`).test(share), "Teilen-Text: " + share);
  ok(/kopiert/.test(await page.$eval("#modal-body .status", (e) => e.textContent)), "Teilen kopiert in die Zwischenablage");
  await page.keyboard.press("Escape");
  ok(!(await modalVisible(page)), "Escape schließt den Dialog");
  await page.click("#btn-menu");
  await waitScreen(page, "start");
  ok(await screenIs(page, "start"), "Menü-Knopf -> Startseite (Runde beendet, keine Rückfrage)");
  ok((await page.$eval("#start-daily-sub", (e) => e.textContent)).includes(`${dailyScore} Punkte`), "Startseite zeigt heutiges Ergebnis");
  ok(await page.$eval("#start-share", (e) => !e.hidden && e.getClientRects().length > 0), "„Ergebnis teilen“ sichtbar");
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem(LetterSlideStats.STORAGE_KEY)).daily[LetterSlideLogic.formatDateKey(new Date())].score) === dailyScore, "Ergebnis in localStorage");
  await page.click("#start-share"); await waitModal(page);
  ok((await page.$eval("#modal-body textarea", (e) => e.value)).includes(`#${n}`), "Ergebnis von der Startseite teilen");
  await page.click('#modal-actions button[data-value="ok"]');

  // Endlos: Rekord merken
  await page.click("#start-endless");
  await waitScreen(page, "game");
  ok(await page.$eval("#stat-mode", (e) => e.textContent) === "Endlos", "Endlos-Modus");
  ok((await state(page)).grid !== start, "Endlos-Brett anders");
  await playUntilScore(page, (sel) => page.click(sel)); await idle(page);
  const endlessScore = (await state(page)).score;
  await page.click("#btn-menu"); await waitModal(page);
  await page.click('#modal-actions button[data-value="ok"]');
  await waitScreen(page, "start");
  ok((await page.$eval("#start-endless-sub", (e) => e.textContent)) === `Rekord: ${endlessScore} Punkte`, `Endlos-Rekord auf der Startseite (${endlessScore})`);
  ok(await particlesCleared(page), "Keine Körner auf der Startseite");
  await shot(page, "desktop-start.png");
  await page.click("#start-daily"); await waitScreen(page, "game");
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

async function reducedMotion(browser) {
  console.log("prefers-reduced-motion: reduce");
  const { page, errors } = await openPage(browser, "file://" + path.join(ROOT, "index.html"),
    (p) => p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]));
  await page.click("#start-endless");
  await waitScreen(page, "game");
  const b = await playUntilScore(page, (sel) => page.click(sel));
  await page.waitForSelector("#board .tile.vanish", { timeout: 3000 }).then(() => ok(true, "einfaches Ausblenden statt Partikel"), () => ok(false, "einfaches Ausblenden statt Partikel"));
  await idle(page);
  ok(b !== null && await page.evaluate(() => LetterSlideParticles.spawnedTotal) === 0 && (await state(page)).score > 0, "keine Körner, Punkte trotzdem gezählt");
  ok(errors.length === 0, "keine JS-Fehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await page.close();
}

async function iphone(browser) {
  const device = puppeteer.KnownDevices["iPhone 14"] || puppeteer.KnownDevices["iPhone 13"];
  console.log(`Mobil: ${device.name || "iPhone"} (${device.viewport.width}x${device.viewport.height}, Touch)`);
  const { page, errors } = await openPage(browser, "file://" + path.join(ROOT, "index.html"), (p) => p.emulate(device));
  await page.evaluate(() => localStorage.clear()); // frischer Start (Desktop-Lauf teilt sich den Speicher)
  await page.reload({ waitUntil: "load" });
  const vp = await page.$eval('meta[name="viewport"]', (m) => m.content);
  ok(/width=device-width/.test(vp) && /initial-scale=1/.test(vp) && /viewport-fit=cover/.test(vp), "viewport-Meta: " + vp);
  ok(await page.$('meta[name="apple-mobile-web-app-capable"][content="yes"]') !== null, "apple-mobile-web-app-capable");
  ok(await page.evaluate(() => matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0), "Touch-Gerät emuliert");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "kein horizontales Scrollen");
  ok(await page.$eval("#board", (b) => getComputedStyle(b).touchAction === "none"), "touch-action: none auf dem Brett");
  const css = await page.evaluate(() => ({ ta: getComputedStyle(document.documentElement).touchAction, us: getComputedStyle(document.body).userSelect || getComputedStyle(document.body).webkitUserSelect, ob: getComputedStyle(document.documentElement).overscrollBehaviorY }));
  ok(css.ta === "manipulation" && css.us === "none" && css.ob === "none", "kein Doppeltipp-Zoom/Textauswahl/Overscroll " + JSON.stringify(css));
  // Startseite auf dem iPhone
  ok(await screenIs(page, "start"), "Startseite sichtbar");
  ok(await page.$eval("#start-share", (e) => e.getClientRects().length === 0), "ohne Ergebnis kein „Ergebnis teilen“");
  const fitStart = await page.$$eval("#start button:not([hidden])", (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { b: r.bottom, w: r.width, h: r.height }; }));
  ok(fitStart.every((x) => x.b <= device.viewport.height && x.w >= 44 && x.h >= 44), "Startseite: alle Knöpfe >= 44 px und ohne Scrollen sichtbar");
  ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), "Startseite passt ohne Scrollen");
  await shot(page, "iphone-start.png");
  await page.tap("#start-howto"); await waitModal(page);
  await new Promise((r) => setTimeout(r, 300));
  const hcard = await page.$eval(".modal-card", (c) => { const r = c.getBoundingClientRect(); return { t: r.top, b: r.bottom }; });
  ok(hcard.t >= 0 && hcard.b <= device.viewport.height, "„So geht's“ passt auf den Bildschirm");
  await shot(page, "iphone-howto.png");
  await page.tap('#modal-actions button[data-value="ok"]');
  await page.tap("#start-daily");
  await waitScreen(page, "game");
  ok(await screenIs(page, "game"), "Tagesrätsel per Touch gestartet");
  await new Promise((r) => setTimeout(r, 500)); // Intro-Animation abwarten

  const small = await page.$$eval("button", (bs) => bs.filter((b) => b.getClientRects().length > 0).map((b) => { const r = b.getBoundingClientRect(); return { t: b.getAttribute("aria-label") || b.textContent, w: r.width, h: r.height }; }).filter((x) => x.w < 44 || x.h < 44));
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

  // Auflösen von oben nach unten in Zeitlupe (×0,25) festhalten: 25 %, 50 %, 80 %
  await page.evaluate(() => { LetterSlideParticles.timeScale = 0.25; });
  const b0 = await playUntilScore(page, (sel) => page.tap(sel));
  ok(b0 !== null, "Treffer-Zug gefunden");
  if (b0 !== null) {
    await page.waitForSelector("#board .tile.hit", { timeout: 3000 });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "iphone-dissolve-00-glow.png") });
    const samples = [];
    for (const pct of [25, 50, 80]) {
      await page.waitForFunction((p) => { const t = LetterSlideParticles.debugTiles()[0]; return t && t.progress >= p / 100; }, { polling: "raf", timeout: 8000 }, pct);
      const smp = await sampleDissolve(page, 0);
      samples.push(smp);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `iphone-dissolve-${pct}.png`) });
    }
    const desc = samples.map((x) => `${Math.round(x.progress * 100)}%: Rest ab ${Math.round(x.boundary * 100)}%`).join(", ");
    ok(samples[0].boundary < samples[1].boundary && samples[1].boundary < samples[2].boundary, "Front wandert von oben nach unten (" + desc + ")");
    ok(samples[0].bottom > 0.9 && samples[1].bottom > 0.9, "unterer Teil bleibt bis zur Mitte intakt (25 %/50 %)");
    await idle(page);
    ok(await particlesCleared(page), "Canvas nach dem Auflösen wieder leer");
  }
  await page.evaluate(() => { LetterSlideParticles.timeScale = 1; });

  // Dialoge auf dem iPhone: Menü-Rückfrage + Teilen, Buttons >= 44 px, passt in den Viewport
  await page.tap("#btn-menu");
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
  await page.tap("#btn-menu"); await waitModal(page);
  await page.tap('#modal-actions button[data-value="ok"]');
  await waitScreen(page, "start");
  ok(await screenIs(page, "start"), "Zurück zur Startseite per Touch");
  ok(errors.length === 0, "keine JS-Fehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--autoplay-policy=user-gesture-required"] });
  try {
    await desktopFile(browser);
    await httpManifest(browser);
    await reducedMotion(browser);
    await iphone(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : "\nAlle Browser-Prüfungen bestanden");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
