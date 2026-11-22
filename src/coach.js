/*
 * Wortgarten – COACH MARKS (Anzeige des geführten Tutorials)
 * ==========================================================
 * Sprechblase im bestehenden Karten-Stil, die auf ein UI-Element zeigt; der Rest des Spiels wird
 * leicht abgedunkelt, das geforderte Element pulsiert sanft. Falsche Aktionen -> sanftes Wackeln.
 * Die Schritte kommen aus src/tutorial.js, der Ablauf aus src/main.js:
 *   Coach.show(step, ctx) -> Promise: "next" (Weiter / Aktion erledigt) | "skip" | "abort"
 *   Coach.allow(action)   -> darf diese Aktion jetzt ausgeführt werden?
 *   Coach.satisfy(action) -> Aktion ist fertig (z. B. Slide-Animation vorbei) -> Schritt erledigt
 *   Coach.reject(el)      -> sanftes Wackeln (Blase + angetipptes Element)
 *   Coach.refresh()       -> nach jedem Neuzeichnen des Bretts Abdunkeln/Puls neu anwenden
 */
(function (root) {
  "use strict";

  const Tut = root.LetterSlideTutorial;
  const N = 6;
  /** Container, in die das Abdunkeln hineinschaut (statt sie als Ganzes zu dimmen). */
  const GROUP_IDS = new Set(["playfield", "board", "hud", "controls", "arrows-top", "arrows-bottom", "arrows-left", "arrows-right"]);
  const isGroup = (el) => GROUP_IDS.has(el.id) || el.classList.contains("menu");
  /** Overlays mit eigener Sichtbarkeit (Deckkraft) – nie abdunkeln, sonst würden sie sichtbar. */
  const SKIP_IDS = new Set(["ended-overlay", "word-flash", "bloom", "combo-pop", "particles", "coach"]);

  const Coach = {
    active: false,
    step: null,
    ctx: null,
    _resolve: null,
    el: null,

    init() {
      const wrap = document.createElement("div");
      wrap.id = "coach";
      wrap.className = "coach";
      wrap.hidden = true;
      wrap.innerHTML = `
        <div class="coach-bubble" role="dialog" aria-live="polite" aria-label="Tutorial">
          <div class="coach-head"><span class="coach-tag">Lehr-Level</span><span class="coach-count"></span></div>
          <p class="coach-text"></p>
          <div class="coach-actions">
            <button type="button" class="coach-skip">Überspringen</button>
            <button type="button" class="pill pill-mint coach-next"><span>Weiter</span></button>
            <span class="coach-do" hidden></span>
          </div>
          <span class="coach-arrow" aria-hidden="true"></span>
        </div>`;
      document.body.appendChild(wrap);
      this.el = {
        wrap, bubble: wrap.querySelector(".coach-bubble"), text: wrap.querySelector(".coach-text"),
        count: wrap.querySelector(".coach-count"), next: wrap.querySelector(".coach-next"),
        skip: wrap.querySelector(".coach-skip"), doHint: wrap.querySelector(".coach-do"), arrow: wrap.querySelector(".coach-arrow"),
        game: document.getElementById("game")
      };
      this.el.next.addEventListener("click", () => { if (this.step && !this.step.move && !this.step.tap) this._finish("next"); });
      this.el.skip.addEventListener("click", () => this._finish("skip"));
      root.addEventListener("resize", () => this.refresh());
    },

    /** Schritt anzeigen. ctx: { game, lastResult, index, total } */
    show(step, ctx) {
      this.active = true;
      this.step = step;
      this.ctx = ctx;
      const { wrap, text, count, next, doHint } = this.el;
      text.innerHTML = Tut.fillText(step.text, ctx);
      count.textContent = `${ctx.index + 1}/${ctx.total}`;
      const waits = !!(step.move || step.tap);
      next.hidden = waits;
      next.querySelector("span").textContent = step.button || "Weiter";
      doHint.hidden = !waits;
      doHint.textContent = step.move ? "Dein Zug ☝︎" : "Tippe den Knopf ☝︎";
      wrap.hidden = false;
      wrap.classList.remove("show");
      this.el.game.classList.add("coach-on");
      this.refresh();
      requestAnimationFrame(() => wrap.classList.add("show"));
      return new Promise((res) => { this._resolve = res; });
    },

    /** Darf die Aktion jetzt passieren? action: { type: "slide", axis, index, dir } | { type: "tap", what } */
    allow(action) {
      if (!this.active || !this.step) return true;
      const s = this.step;
      if (action.type === "slide" && s.move) {
        const m = Tut.decodeMove(s.move);
        return m.axis === action.axis && m.index === action.index && m.dir === action.dir;
      }
      if (action.type === "tap" && s.tap) return s.tap === action.what;
      return false;
    },

    /** Geforderte Aktion ist ausgeführt (nach ihrer Animation). */
    satisfy(action, result) {
      if (!this.active || !this.step || !this.allow(action)) return false;
      if (this.ctx) this.ctx.lastResult = result || this.ctx.lastResult;
      this._finish("next");
      return true;
    },

    /** Während eine erlaubte Aktion läuft: Blase kurz ausblenden (Brett frei). */
    busy(on) { if (this.el && this.active) this.el.wrap.classList.toggle("away", !!on); },

    /** Falsche Aktion: sanftes Wackeln. */
    reject(el) {
      if (!this.el) return;
      for (const t of [this.el.bubble, el].filter(Boolean)) {
        t.classList.remove("coach-shake");
        void t.offsetWidth;
        t.classList.add("coach-shake");
        setTimeout(() => t.classList.remove("coach-shake"), 450);
      }
      if (root.LetterSlideAudio && root.LetterSlideAudio.nope) root.LetterSlideAudio.nope();
    },

    /** Coach beenden (ohne Ergebnis, z. B. Menü). */
    abort() { this._finish("abort"); },

    _finish(value) {
      const res = this._resolve;
      this._resolve = null;
      this.step = null;
      this.hide();
      if (res) res(value);
    },

    hide() {
      this.active = !!this._resolve;
      if (!this.el) return;
      this.el.wrap.classList.remove("show", "away");
      this.el.wrap.hidden = true;
      this.el.game.classList.remove("coach-on");
      for (const e of document.querySelectorAll(".coach-dim, .coach-focus, .coach-pulse")) e.classList.remove("coach-dim", "coach-focus", "coach-pulse");
    },

    /* ------------------------------------------------ Anker auflösen */
    resolve(name) {
      const $ = (sel) => [...document.querySelectorAll(sel)];
      const tile = (r, c) => $(`#board .tile[data-r="${r}"][data-c="${c}"]`);
      if (!name) return [];
      if (name === "target") return $("#target");
      if (name === "hint-text") return $("#target-hint");
      if (name === "slots") return $("#target-slots");
      if (name === "score") return $("#hud .hud-score");
      if (name === "board") return $("#board");
      if (name === "center") return [...tile(2, 2), ...tile(2, 3), ...tile(3, 2), ...tile(3, 3)];
      if (name === "protected") return $("#board .tile.protected");
      if (name.startsWith("btn:")) return $(`#btn-${name.slice(4)}`);
      if (name.startsWith("row:")) return $(`#board .tile[data-r="${name.slice(4)}"]`);
      if (name.startsWith("col:")) return $(`#board .tile[data-c="${name.slice(4)}"]`);
      if (name.startsWith("tile:")) { const [r, c] = name.slice(5).split(",").map(Number); return tile(r, c); }
      if (name.startsWith("arrow:")) {
        const m = Tut.decodeMove(name.slice(6));
        return $(`button.arrow[data-axis="${m.axis}"][data-index="${m.index}"][data-dir="${m.dir}"]`);
      }
      if (name === "letters") {
        // je Zielwort-Buchstabe die erste passende Kachel (Leserichtung), jede Kachel nur einmal
        const g = this.ctx && this.ctx.game;
        if (!g || !g.target) return [];
        const used = new Set();
        const out = [];
        for (const ch of g.target) {
          const i = g.grid.findIndex((x, k) => x === ch && !used.has(k));
          if (i >= 0) { used.add(i); out.push(...tile(Math.floor(i / N), i % N)); }
        }
        return out;
      }
      return [];
    },

    /** Abdunkeln + Puls anwenden und Blase positionieren. */
    refresh() {
      if (!this.active || !this.step || !this.el || this.el.wrap.hidden) return;
      const s = this.step;
      const anchorEls = this.resolve(s.anchor);
      const focus = [...anchorEls, ...(s.focus || []).flatMap((f) => this.resolve(f))];
      for (const e of document.querySelectorAll(".coach-dim, .coach-focus, .coach-pulse")) e.classList.remove("coach-dim", "coach-focus", "coach-pulse");
      const walk = (el) => {
        if (SKIP_IDS.has(el.id) || el.classList.contains("modal")) return;
        if (focus.some((f) => f === el || f.contains(el))) { if (focus.includes(el)) el.classList.add("coach-focus"); return; }
        if (!focus.some((f) => el.contains(f))) { el.classList.add("coach-dim"); return; }
        if (isGroup(el)) for (const ch of el.children) walk(ch);
      };
      for (const ch of this.el.game.children) walk(ch);
      // Puls: die geforderte Steuerung (Pfeil/Knopf); bei Info-Schritten der Anker selbst
      const pulse = s.move ? this.resolve("arrow:" + s.move) : s.tap ? this.resolve("btn:" + s.tap) : anchorEls.filter((e) => e.matches("button, .tile"));
      for (const e of pulse) e.classList.add("coach-pulse");
      this.position(focus.length ? focus : anchorEls);
    },

    position(els) {
      const { bubble, arrow } = this.el;
      const vw = root.innerWidth, vh = root.innerHeight, M = 10;
      let r = null;
      for (const e of els) {
        const b = e.getBoundingClientRect();
        if (!b.width && !b.height) continue;
        r = r ? { left: Math.min(r.left, b.left), top: Math.min(r.top, b.top), right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) } : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      }
      if (!r) r = { left: vw / 2, right: vw / 2, top: vh / 2, bottom: vh / 2 };
      bubble.style.left = "0px"; bubble.style.top = "0px";
      const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
      const below = vh - r.bottom - M, above = r.top - M;
      let place = below >= bh + 14 ? "below" : above >= bh + 14 ? "above" : below >= above ? "below" : "above";
      let top = place === "below" ? r.bottom + 14 : r.top - 14 - bh;
      top = Math.max(M, Math.min(vh - bh - M, top));
      const cx = (r.left + r.right) / 2;
      const left = Math.max(M, Math.min(vw - bw - M, cx - bw / 2));
      bubble.style.left = `${Math.round(left)}px`;
      bubble.style.top = `${Math.round(top)}px`;
      bubble.dataset.place = place;
      arrow.style.left = `${Math.round(Math.max(18, Math.min(bw - 18, cx - left)))}px`;
    }
  };

  root.LetterSlideCoach = Coach;
})(typeof globalThis !== "undefined" ? globalThis : this);
