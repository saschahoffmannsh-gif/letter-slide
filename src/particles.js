/*
 * Letter Slide – PARTIKEL („Zerbröseln“)
 * =====================================
 * Getroffene Kacheln zerfallen in viele kleine Körner. Eine einzige
 * Vollbild-<canvas> (pointer-events: none) liegt über dem Spiel.
 *
 * - Jede Kachel wird in ein Raster aus Körnern zerlegt (bis ~14×14 ≈ 196 pro Kachel).
 *   Körner im Buchstaben sind dunkelbraun (Buchstabe bröselt mit), unten ein Streifen
 *   in der dunklen Kachelkante, sonst Pastell mit leichten Hell/Dunkel-Varianten,
 *   ein paar goldene Funken.
 * - Die Körner bilden zuerst die Kachel nach (stehen still) und lösen sich dann
 *   zeilenweise von oben nach unten ab („Sweep“), pro Kachel in Wortreihenfolge versetzt.
 * - Physik: kleiner Impuls nach außen/oben + Zufall, Schwerkraft, Luftwiderstand,
 *   Schrumpfen, Ausblenden über 0,6–1,0 s. Körner dürfen unter das Brett fallen.
 * - Performance: feste Typed-Arrays (Pool, max. MAX_PARTICLES), fillRect-Quadrate,
 *   gebündelt nach Farbe; rAF-Schleife läuft nur, solange Körner existieren.
 * - prefers-reduced-motion: enabled() = false -> render.js nutzt das einfache Ausblenden.
 */
(function (root) {
  "use strict";

  /* --- Stellschrauben --- */
  const MAX_PARTICLES = 2500;
  const GRAINS_PER_SIDE = 14;          // max. Raster pro Kachel (14×14 = 196)
  const MIN_GRAINS_PER_SIDE = 6;
  const SWEEP_S = 0.16;                // Dauer des Ablösens von oben nach unten (pro Kachel)
  const STAGGER_S = 0.025;             // Versatz pro Buchstabe in Wortreihenfolge
  const GRAVITY = 1500;                // px/s²
  const DRAG = 2.4;                    // Luftwiderstand (1/s)
  const LIFE_MIN = 0.6, LIFE_MAX = 1.0;
  const SPARKLE_RATE = 0.035;          // Anteil goldener Funken

  /* --- Pool (Struktur aus Arrays) --- */
  const px = new Float32Array(MAX_PARTICLES), py = new Float32Array(MAX_PARTICLES);
  const vx = new Float32Array(MAX_PARTICLES), vy = new Float32Array(MAX_PARTICLES);
  const size = new Float32Array(MAX_PARTICLES), size0 = new Float32Array(MAX_PARTICLES);
  const age = new Float32Array(MAX_PARTICLES), life = new Float32Array(MAX_PARTICLES);
  const delay = new Float32Array(MAX_PARTICLES);
  const color = new Uint8Array(MAX_PARTICLES);
  const sparkle = new Uint8Array(MAX_PARTICLES);
  const grain = new Float32Array(MAX_PARTICLES);
  let alive = 0;
  let spawnedTotal = 0;

  /* --- Farbpalette (Index -> CSS-Farbe), für das Bündeln nach Farbe --- */
  const palette = [];
  const paletteIndex = new Map();
  function colorId(css) {
    let id = paletteIndex.get(css);
    if (id === undefined) {
      if (palette.length >= 255) return 0;
      id = palette.length;
      palette.push(css);
      paletteIndex.set(css, id);
    }
    return id;
  }

  /** "#RRGGBB" mit Weiß (t>0) oder Schwarz (t<0) mischen. */
  function shade(hex, t) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const mix = (c) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
    const r = mix(n >> 16), g = mix((n >> 8) & 255), b = mix(n & 255);
    return `rgb(${r},${g},${b})`;
  }

  let canvas = null, ctx = null, dpr = 1, rafId = 0, lastT = 0;
  let reduceMotion = false;

  function init() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "particles";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resize();
    root.addEventListener("resize", resize);
    const mq = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null;
    reduceMotion = !!(mq && mq.matches);
    if (mq && mq.addEventListener) mq.addEventListener("change", (e) => { reduceMotion = e.matches; });
  }

  /** Canvas an Viewport und devicePixelRatio anpassen (gestochen scharf auf Retina). */
  function resize() {
    if (!canvas) return;
    dpr = Math.min(root.devicePixelRatio || 1, 3);
    const w = root.innerWidth, h = root.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* --- Buchstaben-Maske: Buchstabe gerastert auf side×side Zellen (gecacht) --- */
  const maskCache = new Map();
  let maskCanvas = null;
  function letterMask(letter, side, fontFamily) {
    const key = `${letter}|${side}|${fontFamily}`;
    if (maskCache.has(key)) return maskCache.get(key);
    const S = side * 4;
    if (!maskCanvas) maskCanvas = document.createElement("canvas");
    maskCanvas.width = S; maskCanvas.height = S;
    const m = maskCanvas.getContext("2d");
    m.clearRect(0, 0, S, S);
    m.fillStyle = "#000";
    m.textAlign = "center";
    m.textBaseline = "middle";
    m.font = `900 ${Math.round(S * 0.56)}px ${fontFamily}`;
    m.fillText(letter, S / 2, S / 2 + S * 0.03);
    const data = m.getImageData(0, 0, S, S).data;
    const mask = new Uint8Array(side * side);
    for (let cy = 0; cy < side; cy++) {
      for (let cx = 0; cx < side; cx++) {
        const sx = cx * 4 + 2, sy = cy * 4 + 2;
        mask[cy * side + cx] = data[(sy * S + sx) * 4 + 3] > 100 ? 1 : 0;
      }
    }
    maskCache.set(key, mask);
    return mask;
  }

  const rand = (a, b) => a + Math.random() * (b - a);

  /**
   * crumble – lässt Kacheln zerbröseln.
   * @param items [{ el: Kachel-Element (.tile), order: Position im Wort (0..) }]
   * @returns Sekunden, bis alle Körner abgelöst sind (für das Timing der Gravitation)
   */
  function crumble(items) {
    if (!items.length) return 0;
    init();
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    const brown = v("--ink") || "#4A3426";
    const gold = v("--hit") || "#FFCF3A";
    const budget = Math.max(0, MAX_PARTICLES - alive);
    const perTile = Math.floor(budget / items.length);
    const side = Math.min(GRAINS_PER_SIDE, Math.floor(Math.sqrt(perTile)));
    if (side < MIN_GRAINS_PER_SIDE) return 0;
    let maxRelease = 0;

    for (const { el, order } of items) {
      const face = el.querySelector(".face") || el;
      const rect = face.getBoundingClientRect();
      const letter = face.textContent || "";
      const tone = ([...el.classList].find((c) => /^c\d$/.test(c)) || "c0").slice(1);
      const base = v(`--tile-${tone}`) || "#BFE6D3";
      const deep = v(`--tile-${tone}-deep`) || base;
      const ids = {
        base: colorId(shade(base, 0)), light: colorId(shade(base, 0.35)), dark: colorId(shade(base, -0.08)),
        deep: colorId(shade(deep, 0)), ink: colorId(shade(brown, 0)), ink2: colorId(shade(brown, 0.18)),
        gold: colorId(shade(gold, 0)), gold2: colorId(shade(gold, 0.5))
      };
      const mask = letter ? letterMask(letter, side, getComputedStyle(face).fontFamily) : null;
      const cell = rect.width / side;
      const radius = rect.width * 0.28; // abgerundete Ecken aussparen
      const cxT = rect.left + rect.width / 2, cyT = rect.top + rect.height / 2;
      const tileDelay = order * STAGGER_S;

      for (let gy = 0; gy < side; gy++) {
        for (let gx = 0; gx < side; gx++) {
          if (alive >= MAX_PARTICLES) break;
          // Mittelpunkt der Zelle; außerhalb der abgerundeten Ecken -> überspringen
          const lx = (gx + 0.5) * cell, ly = (gy + 0.5) * cell;
          const dx = Math.max(radius - lx, lx - (rect.width - radius), 0);
          const dy = Math.max(radius - ly, ly - (rect.height - radius), 0);
          if (dx * dx + dy * dy > radius * radius) continue;

          const i = alive++;
          px[i] = rect.left + gx * cell;
          py[i] = rect.top + gy * cell;
          size0[i] = cell + 0.35;            // im Ruhezustand lückenlos -> sieht aus wie die Kachel
          size[i] = size0[i];
          age[i] = 0;
          life[i] = rand(LIFE_MIN, LIFE_MAX);
          // Sweep von oben nach unten + etwas Zufall
          delay[i] = tileDelay + (gy / side) * SWEEP_S + rand(0, 0.03);
          maxRelease = Math.max(maxRelease, delay[i]);
          // Impuls: leicht nach außen und oben
          const ox = (px[i] - cxT) / rect.width, oy = (py[i] - cyT) / rect.height;
          vx[i] = ox * rand(40, 120) + rand(-35, 35);
          vy[i] = oy * rand(10, 60) - rand(20, 150);
          grain[i] = rand(0.75, 1.35);           // Korngröße nach dem Ablösen (× Zellgröße)
          sparkle[i] = 0;

          const inLetter = mask && mask[gy * side + gx];
          const r = Math.random();
          if (inLetter) color[i] = r < 0.8 ? ids.ink : ids.ink2;
          else if (gy >= side - Math.max(1, Math.round(side * 0.09))) color[i] = ids.deep; // dunkle Unterkante
          else if (r < SPARKLE_RATE) { color[i] = r < SPARKLE_RATE / 2 ? ids.gold : ids.gold2; sparkle[i] = 1; vy[i] -= rand(60, 160); }
          else if (r < 0.22) color[i] = ids.light;
          else if (r < 0.40) color[i] = ids.dark;
          else color[i] = ids.base;
          spawnedTotal++;
        }
      }
    }
    start();
    return maxRelease;
  }

  function start() {
    if (rafId || alive === 0) return;
    lastT = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function frame(t) {
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    step(dt);
    draw();
    rafId = alive > 0 ? requestAnimationFrame(frame) : 0;
    if (!rafId) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /** Physik-Schritt; tote Körner per Swap-Remove entfernen (Pool bleibt dicht). */
  function step(dt) {
    const floor = root.innerHeight + 30;
    const damp = Math.exp(-DRAG * dt);
    for (let i = 0; i < alive; i++) {
      if (delay[i] > 0) { delay[i] -= dt; continue; } // noch Teil der Kachel
      vx[i] *= damp;
      vy[i] = vy[i] * damp + GRAVITY * dt;
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      age[i] += dt;
      const k = age[i] / life[i];
      // vom lückenlosen Kachel-Stück auf Korngröße (~1,5–4 px) und dann langsam kleiner
      const g = grain[i] * (size0[i] - 0.35);
      size[i] = Math.max(0.9, k < 0.1 ? size0[i] + (g - size0[i]) * (k / 0.1) : g * (1 - 0.45 * (k - 0.1) / 0.9));
      if (age[i] >= life[i] || py[i] > floor) {
        const j = --alive;
        if (i !== j) {
          px[i] = px[j]; py[i] = py[j]; vx[i] = vx[j]; vy[i] = vy[j];
          size[i] = size[j]; size0[i] = size0[j]; age[i] = age[j]; life[i] = life[j];
          delay[i] = delay[j]; color[i] = color[j]; sparkle[i] = sparkle[j]; grain[i] = grain[j];
        }
        i--;
      }
    }
  }

  /** Zeichnen: pro Farbe einmal fillStyle setzen, Alpha quantisiert (wenige State-Wechsel). */
  function draw() {
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    for (let c = 0; c < palette.length; c++) {
      let used = false;
      let lastA = -1;
      for (let i = 0; i < alive; i++) {
        if (color[i] !== c) continue;
        if (!used) { ctx.fillStyle = palette[c]; used = true; }
        const k = delay[i] > 0 ? 0 : age[i] / life[i];
        let a = 1 - k * k;
        if (sparkle[i]) a *= 0.65 + 0.35 * Math.sin(age[i] * 40 + i);
        a = Math.round(a * 10) / 10;
        if (a <= 0) continue;
        if (a !== lastA) { ctx.globalAlpha = a; lastA = a; }
        const s = size[i];
        ctx.fillRect(px[i], py[i], s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Alle Körner sofort entfernen (Undo, Reset, Menü). */
  function clear() {
    alive = 0;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  root.LetterSlideParticles = {
    init, crumble, clear,
    enabled: () => { init(); return !reduceMotion && !!ctx; },
    get alive() { return alive; },
    get spawnedTotal() { return spawnedTotal; },
    get running() { return rafId !== 0; },
    MAX_PARTICLES
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
