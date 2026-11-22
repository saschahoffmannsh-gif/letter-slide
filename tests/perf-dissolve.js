/*
 * Optionaler Performance-Test fürs Auflösen (nicht in CI):
 * iPhone-14-Emulation, 4× CPU-Drosselung, ein 5-Buchstaben-Wort und 350 ms später
 * eine Kaskade mit 6 weiteren Kacheln. Misst die rAF-Frame-Abstände.
 *   PUPPETEER_CORE=/pfad/zu/puppeteer-core node tests/perf-dissolve.js
 */
"use strict";
const path = require("path");
const puppeteer = require(process.env.PUPPETEER_CORE || "puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.emulate(puppeteer.KnownDevices["iPhone 14"]);
  await page.goto("file://" + path.resolve(__dirname, "..", "index.html"));
  await page.evaluate(() => LetterSlideApp.startGame("endless"));
  await new Promise((r) => setTimeout(r, 1500));
  const cdp = await page.target().createCDPSession();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const res = await page.evaluate(() => new Promise((done) => {
    const P = LetterSlideParticles;
    const tiles = [...document.querySelectorAll("#board .tile")];
    const frames = []; let last = performance.now(), maxAlive = 0;
    const loop = (t) => { frames.push(t - last); last = t; maxAlive = Math.max(maxAlive, P.alive); if (frames.length < 400 && (P.running || frames.length < 10)) requestAnimationFrame(loop); else finish(); };
    const finish = () => { const f = frames.slice(2).sort((a, b) => a - b); const q = (p) => f[Math.min(f.length - 1, Math.floor(p * f.length))]; done({ series: frames.map((x) => Math.round(x)).join(" "), prof: { step: P.prof.step / P.prof.frames, draw: P.prof.draw / P.prof.frames }, n: f.length, median: q(0.5), p95: q(0.95), max: f[f.length - 1], maxAlive, spawned: P.spawnedTotal }); };
    requestAnimationFrame(loop);
    P.crumble(tiles.slice(0, 5).map((el, order) => ({ el, order })));
    setTimeout(() => P.crumble(tiles.slice(12, 18).map((el, order) => ({ el, order }))), 350);
  }));
  const fps = (ms) => (1000 / ms).toFixed(0);
  console.log(`Frames ${res.n}, Median ${res.median.toFixed(1)} ms (${fps(res.median)} fps), p95 ${res.p95.toFixed(1)} ms (${fps(res.p95)} fps), max ${res.max.toFixed(1)} ms; Körner gespawnt ${res.spawned}, max. gleichzeitig ${res.maxAlive}; pro Frame Physik ${res.prof.step.toFixed(1)} ms, Zeichnen ${res.prof.draw.toFixed(1)} ms`);
  if (process.env.SERIES) console.log(res.series);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
