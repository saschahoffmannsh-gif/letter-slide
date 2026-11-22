/*
 * Letter Slide – PARTIKEL („Zerbröseln von oben nach unten“)
 * ==========================================================
 * Getroffene Kacheln lösen sich von der Oberkante zur Unterkante auf.
 *
 * Ablauf pro Kachel:
 *  1. Die echte DOM-Kachel wird ausgeblendet; die Kachel (weiße Fläche, warmgraue
 *     Unterkante, dunkelbrauner Buchstabe) wird stattdessen auf der Vollbild-<canvas>
 *     gezeichnet.
 *  2. Eine waagerechte Auflöse-Front läuft in DISSOLVE_S (ease-in-out) von oben nach unten.
 *     - Unterhalb der Front: der intakte Rest der Kachel, scharf gezeichnet (Clip).
 *     - Direkt an der Front: ein ausgefranster Rand aus noch festen Körnern
 *       (jedes Korn hat eine zufällige Verzögerung innerhalb von EDGE_BAND).
 *     - Oberhalb: freigegebene Körner fallen mit Schwerkraft, leichtem Seitwärts-Drift,
 *       minimalem Hochploppen, schrumpfen und blenden aus.
 *  3. Pro Buchstabe in Wortreihenfolge leicht versetzt (STAGGER_S).
 *
 * Performance: Typed-Array-Pool (max. MAX_PARTICLES), fillRect-Quadrate gebündelt nach
 * Farbe, rAF-Schleife nur solange etwas lebt, devicePixelRatio-scharf.
 * prefers-reduced-motion: enabled() = false -> render.js nutzt einfaches Ausblenden.
 */
(function (root) {
  "use strict";

  /* --- Stellschrauben --- */
  const MAX_PARTICLES = 2500;
  const GRAINS_PER_ROW = 16;           // Körner pro Kachelbreite (16 -> ~2,8 px auf dem iPhone)
  const MIN_GRAINS_PER_ROW = 7;
  const DISSOLVE_S = 0.46;             // Dauer der Front von oben nach unten
  const STAGGER_S = 0.05;              // Versatz pro Buchstabe in Wortreihenfolge
  const EDGE_BAND = 0.16;              // Breite des ausgefransten Rands (Anteil der Kachelhöhe)
  const GRAVITY = 1350;                // px/s²
  const DRAG = 1.6;                    // Luftwiderstand (1/s)
  const LIFE_MIN = 0.7, LIFE_MAX = 1.1;
  const SPARKLE_RATE = 0.02;           // Anteil winziger Goldfunken
  const EDGE_PX = 4;                   // Höhe der Unterkante (wie box-shadow 0 4px 0 in style.css)

  /** Ease-in-out (kubisch) für die Front. */
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const rand = (a, b) => a + Math.random() * (b - a);

  /* --- Körner-Pool (Struktur aus Arrays) --- */
  const px = new Float32Array(MAX_PARTICLES), py = new Float32Array(MAX_PARTICLES);
  const vx = new Float32Array(MAX_PARTICLES), vy = new Float32Array(MAX_PARTICLES);
  const size = new Float32Array(MAX_PARTICLES), cellSz = new Float32Array(MAX_PARTICLES);
  const grain = new Float32Array(MAX_PARTICLES);          // Korngröße nach Freigabe (× Zelle)
  const age = new Float32Array(MAX_PARTICLES), life = new Float32Array(MAX_PARTICLES);
  const relY = new Float32Array(MAX_PARTICLES);           // Lage in der Kachel (0 = oben, 1 = unten)
  const jitter = new Float32Array(MAX_PARTICLES);         // Verzögerung innerhalb des Rands
  const color = new Uint8Array(MAX_PARTICLES);
  const free = new Uint8Array(MAX_PARTICLES);             // 0 = noch Teil der Kachel, 1 = fällt
  const sparkle = new Uint8Array(MAX_PARTICLES);
  const owner = new Int16Array(MAX_PARTICLES);            // Index in `tiles`
  let alive = 0;
  let spawnedTotal = 0;

  /** Aktive Kacheln, die gerade zerfallen: { x, y, w, faceH, h, t0, letter, font, done } */
  let tiles = [];
  let clock = 0; // Sekunden seit Start der aktuellen Animation

  /* --- Farbpalette (Index -> CSS-Farbe) zum Bündeln --- */
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

  let canvas = null, ctx = null, dpr = 1, rafId = 0, lastT = 0;
  let reduceMotion = false;
  let theme = null;
  /** Zeitlupe nur für Tests/Screenshots (1 = normal). Dauer-Rückgaben werden mitskaliert. */
  let timeScale = 1;

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

  /** Canvas an Viewport und devicePixelRatio anpassen (scharf auf Retina). */
  function resize() {
    if (!canvas) return;
    dpr = Math.min(root.devicePixelRatio || 1, 3);
    canvas.width = Math.round(root.innerWidth * dpr);
    canvas.height = Math.round(root.innerHeight * dpr);
    canvas.style.width = root.innerWidth + "px";
    canvas.style.height = root.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Farben aus den CSS-Variablen lesen (Theme bleibt in style.css). */
  function readTheme() {
    const css = getComputedStyle(document.documentElement);
    const v = (n, d) => css.getPropertyValue(n).trim() || d;
    return {
      face: v("--tile-face", "#FFFFFF"), shade: v("--tile-shade", "#F6F1EA"), edge: v("--tile-edge", "#E2D8CB"),
      ink: v("--tile-ink", "#4A3426"), gold: v("--hit", "#FFCF3A")
    };
  }

  /* --- Buchstaben-Maske: welche Körner gehören zum Buchstaben (gecacht) --- */
  const maskCache = new Map();
  let maskCanvas = null;
  function letterMask(letter, cols, rows, w, faceH, font) {
    const key = `${letter}|${cols}|${rows}|${Math.round(w)}|${font}`;
    if (maskCache.has(key)) return maskCache.get(key);
    const S = 4; // Überabtastung
    const W = cols * S, H = rows * S;
    if (!maskCanvas) maskCanvas = document.createElement("canvas");
    maskCanvas.width = W; maskCanvas.height = H;
    const m = maskCanvas.getContext("2d");
    m.setTransform(W / w, 0, 0, W / w, 0, 0); // Kachel-Koordinaten in px
    m.clearRect(0, 0, w, H);
    drawLetter(m, letter, font, w / 2, faceH / 2, "#000");
    const data = m.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(cols * rows);
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      const sx = gx * S + 2, sy = gy * S + 2;
      mask[gy * cols + gx] = data[(sy * W + sx) * 4 + 3] > 100 ? 1 : 0;
    }
    maskCache.set(key, mask);
    return mask;
  }

  /** Buchstaben optisch mittig zeichnen (wie das Flex-Zentrieren der DOM-Kachel). */
  function drawLetter(c, letter, font, cx, cy, fill) {
    c.font = font;
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    const m = c.measureText(letter);
    const asc = m.actualBoundingBoxAscent || 0, desc = m.actualBoundingBoxDescent || 0;
    c.fillStyle = fill;
    c.fillText(letter, cx, cy + (asc - desc) / 2);
  }

  /** Abgerundetes Rechteck als Pfad (Fallback ohne ctx.roundRect). */
  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  /**
   * crumble – startet das Auflösen von oben nach unten.
   * @param items [{ el: Kachel-Element (.tile), order: Position im Wort (0..) }]
   * @returns { duration, starts } – Gesamtdauer in s und Startzeit (s) jeder Kachel
   *          (für Timing der Gravitation und den Riesel-Sound)
   */
  function crumble(items) {
    if (!items.length) return { duration: 0, starts: [] };
    init();
    theme = readTheme();
    const ids = {
      face: colorId(theme.face), shade: colorId(theme.shade), edge: colorId(theme.edge),
      ink: colorId(theme.ink), gold: colorId(theme.gold), white: colorId("#FFFFFF")
    };
    if (alive === 0 && tiles.every((t) => t.done)) { tiles = []; clock = 0; }
    const budget = Math.max(0, MAX_PARTICLES - alive);
    const starts = [];
    let duration = 0;

    for (const { el, order } of items) {
      const face = el.querySelector(".face") || el;
      el.classList.remove("hit");                 // ohne Skalierung messen
      const rect = face.getBoundingClientRect();
      const letter = face.textContent || "";
      const cs = getComputedStyle(face);
      const font = `${cs.fontWeight || 900} ${cs.fontSize} ${cs.fontFamily}`;
      const w = rect.width, faceH = rect.height, h = faceH + EDGE_PX;
      const t0 = clock + order * STAGGER_S;
      const tileId = tiles.length;
      tiles.push({ x: rect.left, y: rect.top, w, faceH, h, t0, letter, font, radius: parseFloat(cs.borderTopLeftRadius) || 13, done: false });
      starts.push(order * STAGGER_S);
      duration = Math.max(duration, order * STAGGER_S + DISSOLVE_S);

      // Körner-Raster (Budget gleichmäßig auf die Kacheln verteilt)
      let cols = GRAINS_PER_ROW;
      const cell0 = w / cols;
      let rows = Math.ceil(h / cell0);
      const per = Math.floor(budget / items.length);
      while (cols > MIN_GRAINS_PER_ROW && cols * rows > per) { cols--; rows = Math.ceil(h / (w / cols)); }
      if (cols * rows > per) continue; // kein Budget: Kachel löst sich nur als Clip auf
      const cell = w / cols;
      const mask = letter ? letterMask(letter, cols, rows, w, faceH, font) : null;
      const r = tiles[tileId].radius;

      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          if (alive >= MAX_PARTICLES) break;
          const lx = (gx + 0.5) * cell, ly = (gy + 0.5) * cell;
          if (ly > h) continue;
          // Ecken der Fläche bzw. der Unterkante aussparen
          const top = ly > faceH ? EDGE_PX : 0;
          const ddx = Math.max(r - lx, lx - (w - r), 0);
          const ddy = Math.max(r + top - ly, ly - (h - r), 0);
          if (ddx * ddx + ddy * ddy > r * r) continue;

          const i = alive++;
          owner[i] = tileId;
          px[i] = rect.left + gx * cell;
          py[i] = rect.top + gy * cell;
          cellSz[i] = cell;
          size[i] = cell + 0.4;
          grain[i] = rand(0.55, 1.15);
          relY[i] = ly / h;
          jitter[i] = Math.random() * EDGE_BAND;
          free[i] = 0;
          age[i] = 0;
          life[i] = rand(LIFE_MIN, LIFE_MAX);
          vx[i] = rand(-28, 28);                 // leichter Seitwärts-Drift
          vy[i] = rand(-35, 10);                 // minimales Hochploppen
          sparkle[i] = 0;
          const k = Math.random();
          if (ly > faceH) color[i] = ids.edge;
          else if (mask && mask[gy * cols + gx]) color[i] = ids.ink;
          else if (k < SPARKLE_RATE) { color[i] = ids.gold; sparkle[i] = 1; vy[i] -= rand(30, 90); }
          else if (k < 0.3 || ly > faceH * 0.6) color[i] = k < 0.55 ? ids.shade : ids.face;
          else color[i] = k < 0.65 ? ids.white : ids.face;
          spawnedTotal++;
        }
      }
    }
    start();
    return { duration: duration / timeScale, starts: starts.map((x) => x / timeScale) };
  }

  /** Fortschritt der Front einer Kachel (0..1+EDGE_BAND) zum aktuellen Zeitpunkt. */
  function frontOf(t) {
    const p = Math.min(1, Math.max(0, (clock - t.t0) / DISSOLVE_S));
    return ease(p) * (1 + EDGE_BAND);
  }

  function start() {
    if (rafId) return;
    lastT = performance.now();
    draw();                                   // sofort zeichnen -> kein Flackern beim Ausblenden der DOM-Kachel
    rafId = requestAnimationFrame(frame);
  }

  function active() {
    return alive > 0 || tiles.some((t) => !t.done);
  }

  function frame(t) {
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    clock += dt * timeScale;
    step(dt * timeScale);
    draw();
    if (active()) rafId = requestAnimationFrame(frame);
    else { rafId = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); tiles = []; clock = 0; }
  }

  /** Physik: Körner hinter der Front freigeben, freie Körner bewegen, tote entfernen. */
  function step(dt) {
    for (const t of tiles) if (!t.done && clock - t.t0 >= DISSOLVE_S) t.done = true;
    const floor = root.innerHeight + 30;
    const damp = Math.exp(-DRAG * dt);
    for (let i = 0; i < alive; i++) {
      if (!free[i]) {
        const f = frontOf(tiles[owner[i]]);
        if (f < relY[i] + jitter[i]) continue; // noch Teil des intakten Rests / Rands
        free[i] = 1;
      }
      vx[i] = vx[i] * damp + rand(-40, 40) * dt;  // leichtes Flattern
      vy[i] = vy[i] * damp + GRAVITY * dt;
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      age[i] += dt;
      const k = age[i] / life[i];
      const g = grain[i] * cellSz[i];
      size[i] = Math.max(0.8, k < 0.12 ? size[i] + (g - size[i]) * Math.min(1, dt * 18) : g * (1 - 0.5 * (k - 0.12)));
      if (age[i] >= life[i] || py[i] > floor) {
        const j = --alive;
        if (i !== j) {
          px[i] = px[j]; py[i] = py[j]; vx[i] = vx[j]; vy[i] = vy[j]; size[i] = size[j]; cellSz[i] = cellSz[j];
          grain[i] = grain[j]; age[i] = age[j]; life[i] = life[j]; relY[i] = relY[j]; jitter[i] = jitter[j];
          color[i] = color[j]; free[i] = free[j]; sparkle[i] = sparkle[j]; owner[i] = owner[j];
        }
        i--;
      }
    }
  }

  /** Intakten Rest jeder Kachel scharf zeichnen: nur unterhalb der Front (Clip). */
  function drawRemainders() {
    for (const t of tiles) {
      if (t.done) continue;
      const f = frontOf(t);
      const clipTop = t.y + Math.min(f, 1) * t.h;
      if (clipTop >= t.y + t.h) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(t.x - 2, clipTop, t.w + 4, t.y + t.h - clipTop + 2);
      ctx.clip();
      // Unterkante (warmgrau) und weiße Fläche mit leichtem Verlauf
      ctx.fillStyle = theme.edge;
      roundRectPath(ctx, t.x, t.y + EDGE_PX, t.w, t.faceH, t.radius);
      ctx.fill();
      const grad = ctx.createLinearGradient(0, t.y, 0, t.y + t.faceH);
      grad.addColorStop(0.55, theme.face);
      grad.addColorStop(1, theme.shade);
      ctx.fillStyle = grad;
      roundRectPath(ctx, t.x, t.y, t.w, t.faceH, t.radius);
      ctx.fill();
      if (t.letter) drawLetter(ctx, t.letter, t.font, t.x + t.w / 2, t.y + t.faceH / 2, theme.ink);
      ctx.restore();
    }
  }

  /** Körner zeichnen: pro Farbe einmal fillStyle, Alpha quantisiert. */
  function draw() {
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    drawRemainders();
    for (let c = 0; c < palette.length; c++) {
      let used = false, lastA = -1;
      for (let i = 0; i < alive; i++) {
        if (color[i] !== c) continue;
        // feste Körner nur im ausgefransten Rand zeichnen (darunter liegt der scharfe Rest)
        if (!free[i]) {
          const f = frontOf(tiles[owner[i]]);
          if (relY[i] >= Math.min(f, 1)) continue;
        }
        if (!used) { ctx.fillStyle = palette[c]; used = true; }
        const k = free[i] ? age[i] / life[i] : 0;
        let a = 1 - k * k;
        if (sparkle[i]) a *= 0.6 + 0.4 * Math.sin(age[i] * 40 + i);
        a = Math.round(a * 10) / 10;
        if (a <= 0) continue;
        if (a !== lastA) { ctx.globalAlpha = a; lastA = a; }
        ctx.fillRect(px[i], py[i], size[i], size[i]);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Alles sofort entfernen (Undo, Reset, Menü). */
  function clear() {
    alive = 0;
    tiles = [];
    clock = 0;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  root.LetterSlideParticles = {
    init, crumble, clear,
    enabled: () => { init(); return !reduceMotion && !!ctx; },
    get alive() { return alive; },
    get spawnedTotal() { return spawnedTotal; },
    get running() { return rafId !== 0; },
    /** Für Tests: Kacheln mit Rechteck und Front-Fortschritt (0..1). */
    debugTiles: () => tiles.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h, done: t.done, front: Math.min(1, frontOf(t) / (1 + EDGE_BAND)), progress: Math.min(1, Math.max(0, (clock - t.t0) / DISSOLVE_S)) })),
    get timeScale() { return timeScale; },
    set timeScale(v) { timeScale = Math.max(0.05, Math.min(1, Number(v) || 1)); },
    MAX_PARTICLES, DISSOLVE_S, STAGGER_S
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
