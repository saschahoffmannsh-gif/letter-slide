/*
 * Wortgarten – RENDERING & ANIMATIONEN
 * ====================================
 * Zeichnet Brett (inkl. Modifikator-Kacheln), HUD, Zielwort-Feld, Modifikator-Leiste und
 * Overlays ins DOM und spielt die Animationen ab (CSS-Transitions, Partikel, Bloom).
 * Kennt keine Spielregeln – bekommt Grids/Schritte aus logic.js.
 */
(function (root) {
  "use strict";

  const L = root.LetterSlideLogic;
  const { GRID_SIZE, MODES, idx, comboMultiplier } = L;
  const ICON = { stein: "i-stone", brunnen: "i-drop", trieb: "i-sprout" };
  /** Bloom-Farben fürs gelöste Zielwort (Pastell-Palette aus style.css). */
  const BLOOM = [["--mint", "--mint-deep"], ["--peach", "--peach-deep"], ["--lavender", "--lavender-deep"], ["--butter", "--hit-deep"], ["--sage", "--sage-deep"], ["--heart", "--title-a-deep"]];

  /** Animationsdauern (ms). */
  /*   flash   = kurzes goldenes Aufleuchten vor dem Zerbröseln
   *   crumble = Mindest-Wartezeit; tatsächlich wird gewartet, bis die Auflöse-Front
   *             aller Kacheln unten angekommen ist (particles.js) -> dann Gravitation
   *   vanish  = einfaches Ausblenden (Fallback bei prefers-reduced-motion) */
  const ANIM = { slide: 120, flash: 150, crumble: 350, vanish: 180, fall: 150, plant: 380, wordHold: 700, comboHold: 750, bloom: 2000 };
  const Particles = root.LetterSlideParticles;
  const Sound = root.LetterSlideAudio;

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  /** Zwei Frames abwarten, damit der Startzustand einer Transition gerendert ist. */
  const nextFrame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));

  /** 1.5 -> "1,5" */
  function formatMult(m) {
    return Number.isInteger(m) ? String(m) : String(m).replace(".", ",");
  }

  const View = {
    el: {},
    selection: null, // { r, c } – ausgewählte Kachel (Tastatursteuerung)

    /**
     * DOM-Referenzen holen, Pfeil-Buttons und Modus-Buttons erzeugen.
     * @param onArrow(axis, index, dir)  Klick auf einen Randpfeil
     * @param onModeClick(modeId)         Klick auf einen Modus-Button
     */
    init(onArrow, onModeClick) {
      const $ = (id) => document.getElementById(id);
      this.el = {
        targetCard: $("target"), targetHint: $("target-hint"), slots: $("target-slots"), hintLine: $("hint-line"),
        endedTitle: $("ended-title"), bloom: $("bloom"), hintCount: $("hint-count"), preview: $("btn-preview"),
        counts: { stein: $("count-stein"), brunnen: $("count-brunnen"), trieb: $("count-trieb") },
        chips: document.querySelectorAll("#modstatus .mod-chip"),
        board: $("board"), mode: $("stat-mode"), moves: $("stat-moves"), score: $("stat-score"),
        combo: $("stat-combo"), comboValue: $("stat-combo-value"), flash: $("word-flash"),
        comboPop: $("combo-pop"), overlay: $("ended-overlay"), endedSummary: $("ended-summary"),
        modeButtons: $("mode-buttons"),
        modal: $("modal"), modalTitle: $("modal-title"), modalBody: $("modal-body"), modalActions: $("modal-actions")
      };
      const specs = [
        ["arrows-top", "up", "col", -1, "Spalte %n nach oben"],
        ["arrows-bottom", "down", "col", +1, "Spalte %n nach unten"],
        ["arrows-left", "left", "row", -1, "Zeile %n nach links"],
        ["arrows-right", "right", "row", +1, "Zeile %n nach rechts"]
      ];
      for (const [id, glyph, axis, dir, label] of specs) {
        const box = $(id);
        for (let i = 0; i < GRID_SIZE; i++) {
          const b = document.createElement("button");
          b.type = "button";
          // Sichtbares Pastell-Quadrat mit Inline-SVG-Pfeil (Symbol #i-arrow in index.html)
          b.innerHTML = `<span class="arrow-key dir-${glyph}"><svg aria-hidden="true"><use href="#i-arrow"/></svg></span>`;
          b.className = "arrow";
          b.dataset.axis = axis; b.dataset.index = i; b.dataset.dir = dir;
          b.setAttribute("aria-label", label.replace("%n", i + 1));
          b.addEventListener("click", () => onArrow(axis, i, dir));
          box.appendChild(b);
        }
      }
      for (const mode of this.el.modeButtons ? Object.values(MODES) : []) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = mode.label;
        b.dataset.mode = mode.id;
        b.addEventListener("click", () => onModeClick(mode.id));
        this.el.modeButtons.appendChild(b);
      }
      // Dialog: Escape bzw. Tippen auf den Hintergrund = Abbrechen
      this.el.modal.addEventListener("pointerdown", (e) => { if (e.target === this.el.modal) this.closeModal("cancel"); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.modalOpen) this.closeModal("cancel"); });
    },

    /**
     * Eine Kachel an Zelle (r, c) erzeugen (Position in %, damit translate(100%) = ein Feld).
     * @param mod null | "stein" | "brunnen" | "trieb" – Modifikator-Kachel (Farbe, Muster, Icon)
     */
    makeTile(letter, r, c, mod = null) {
      const t = document.createElement("div");
      t.className = "tile" + (mod ? ` mod-${mod}` : ""); // weiß; Modifikatoren pastell getönt (style.css)
      t.style.left = `${(c * 100) / GRID_SIZE}%`;
      t.style.top = `${(r * 100) / GRID_SIZE}%`;
      t.dataset.r = r;
      t.style.setProperty("--i", r * GRID_SIZE + Math.max(0, c)); // für die Intro-Staffelung
      t.dataset.c = c;
      const f = document.createElement("div");
      f.className = "face";
      f.textContent = letter ?? "";
      if (letter == null) f.style.visibility = "hidden";
      if (mod) f.insertAdjacentHTML("beforeend", `<svg class="mod-ic" aria-hidden="true"><use href="#${ICON[mod]}"/></svg>`);
      if (mod) t.dataset.mod = mod;
      t.appendChild(f);
      return t;
    },

    /** Modifikator einer Zelle: Feld-Modifikator (Stein/Brunnen) hat Vorrang vor dem Trieb-Buchstaben. */
    modAt(mods, i) {
      if (!mods) return null;
      return (mods.cellMod && mods.cellMod[i]) || (mods.sprout && mods.sprout[i] ? "trieb" : null);
    },

    /**
     * Brett komplett neu zeichnen. Liefert Map Index -> Kachel-Element.
     * @param mods { cellMod, sprout } (optional)
     */
    renderBoard(grid, mods = null) {
      const board = this.el.board;
      board.textContent = "";
      const tiles = new Map();
      // Zielwort des laufenden Spiels merken (Animationen übergeben nur cellMod/sprout)
      if (mods && "target" in mods) this.target = mods.solved ? null : mods.target;
      // Zielwort-Fortschritt: geschützte Felder dezent markieren (gleiche Regel wie in der Logik)
      const prot = this.target ? L.protectedCells(grid, this.target) : null;
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          const t = this.makeTile(grid[idx(r, c)], r, c, this.modAt(mods, idx(r, c)));
          if (prot && prot.has(idx(r, c))) t.classList.add("protected");
          board.appendChild(t);
          tiles.set(idx(r, c), t);
        }
      }
      this.applySelection(tiles);
      return tiles;
    },

    applySelection(tiles) {
      if (!this.selection) return;
      const { r, c } = this.selection;
      for (const [i, t] of tiles) {
        const tr = Math.floor(i / GRID_SIZE), tc = i % GRID_SIZE;
        if (tr === r && tc === c) t.classList.add("sel");
        else if (tr === r || tc === c) t.classList.add("sel-line");
      }
    },

    /** Kantenlänge einer Zelle in px (für die Swipe-Schwelle). */
    cellSize() {
      return this.el.board.clientWidth / GRID_SIZE;
    },

    /**
     * Slide-Animation: jede bewegliche Kachel gleitet zur nächsten Nicht-Stein-Zelle der Linie
     * (über Steine hinweg, die Steine bleiben liegen). Die Randkachel gleitet hinaus, ihre Kopie
     * kommt auf der Gegenseite herein.
     * @param mods { cellMod, sprout } VOR dem Zug
     */
    async animateSlide(gridBefore, axis, index, dir, mods = null) {
      const tiles = this.renderBoard(gridBefore, mods);
      const n = GRID_SIZE;
      const pos = (i) => (axis === "row" ? i % n : Math.floor(i / n)); // Position entlang der Linie
      const cells = L.movableCells(mods && mods.cellMod, axis, index);
      const m = cells.length;
      const moving = [];
      for (let k = 0; k < m; k++) {
        const from = cells[k], to = cells[(k + dir + m) % m];
        const t = tiles.get(from);
        const wraps = dir > 0 ? k === m - 1 : k === 0;
        if (!wraps) { moving.push([t, pos(to) - pos(from)]); continue; }
        // Randkachel: hinaus bis hinter den Rand, Kopie kommt von der Gegenseite bis zur Zielzelle
        moving.push([t, dir > 0 ? n - pos(from) : -1 - pos(from)]);
        const ghostPos = dir > 0 ? -1 : n;
        const letter = gridBefore[from];
        const mod = this.modAt(mods, from);
        const ghost = axis === "row" ? this.makeTile(letter, index, ghostPos, mod) : this.makeTile(letter, ghostPos, index, mod);
        this.el.board.appendChild(ghost);
        moving.push([ghost, pos(to) - ghostPos]);
      }
      await nextFrame();
      for (const [t, d] of moving) {
        t.style.transition = `transform ${ANIM.slide}ms ease-out`;
        t.style.transform = axis === "row" ? `translateX(${d * 100}%)` : `translateY(${d * 100}%)`;
      }
      await wait(ANIM.slide + 10);
    },

    /**
     * Treffer: Kacheln kurz golden aufleuchten, Wort groß einblenden, dann zerbröseln
     * die Kacheln in Körner (particles.js). Die Gravitation startet, sobald sie sichtbar
     * zerfallen sind; die Körner fallen währenddessen weiter.
     */
    async animateClear(step, flash = true) {
      const tiles = this.renderBoard(step.gridBefore, { cellMod: step.cellModBefore, sprout: step.sproutBefore });
      for (const i of step.cleared) tiles.get(i).classList.add("hit");
      if (flash) this.showWordFlash(step);
      if (step.level >= 2) this.showComboPop(step.level);
      await wait(ANIM.flash);
      if (Particles && Particles.enabled()) {
        // Reihenfolge: Buchstaben in Wortreihenfolge (jedes Wort startet parallel)
        const order = new Map();
        const cleared = new Set(step.cleared); // Stein-Buchstaben bleiben stehen
        for (const m of step.matches) m.cells.forEach((cell, k) => { if (cleared.has(cell) && !order.has(cell)) order.set(cell, k); });
        const items = [...order].map(([cell, k]) => ({ el: tiles.get(cell), order: k }));
        const { duration, starts, grainsPerTile } = Particles.crumble(items); // Canvas zeichnet die Kacheln ab jetzt
        for (const { el } of items) el.classList.add("crumbled"); // DOM-Kachel weg, Canvas übernimmt
        if (Sound && Sound.trickle) Sound.trickle(starts, Particles.DISSOLVE_S, grainsPerTile / 300);
        // Gravitation erst, wenn die Front aller Kacheln unten angekommen ist (Körner rieseln weiter)
        await wait(Math.max(ANIM.crumble, duration * 1000));
      } else {
        for (const i of step.cleared) tiles.get(i).classList.add("vanish");
        if (Sound && Sound.trickle) Sound.trickle([0], 0.2);
        await wait(ANIM.vanish);
      }
    },

    /** Kurzes Einblenden der Kacheln beim Rundenstart. */
    introBoard() {
      const board = this.el.board;
      board.classList.remove("intro");
      void board.offsetWidth;
      board.classList.add("intro");
      setTimeout(() => board.classList.remove("intro"), 900);
    },

    /** Gravitation: Kacheln fallen von ihrer alten Zeile nach unten, neue fallen von oben ein. */
    async animateFall(step) {
      const tiles = this.renderBoard(step.gridFallen, { cellMod: step.cellModBefore, sprout: step.sproutFallen });
      const movers = [];
      for (const [i, t] of tiles) {
        const r = Math.floor(i / GRID_SIZE);
        const from = step.fromRow[i];
        if (from != null && from !== r) {
          t.style.transform = `translateY(${(from - r) * 100}%)`;
          movers.push(t);
        }
      }
      await nextFrame();
      for (const t of movers) {
        t.style.transition = `transform ${ANIM.fall}ms cubic-bezier(.5,0,.9,.6)`;
        t.style.transform = "translateY(0)";
      }
      await wait(ANIM.fall + 20);
    },

    /** Neue Modifikatoren erscheinen mit kurzem Plopp (nach Gravitation/Nachfüllen). */
    async animatePlant(step) {
      if (!step.placed.length) return;
      const tiles = this.renderBoard(step.gridAfter, { cellMod: step.cellModAfter, sprout: step.sproutAfter });
      for (const p of step.placed) tiles.get(p.cell).classList.add("planted");
      if (Sound && Sound.plant) step.placed.forEach((p, k) => setTimeout(() => Sound.plant(p.type), k * 90));
      await wait(ANIM.plant);
    },

    /**
     * Vorschau: Zielfelder, die zu Modifikatoren würden, blitzen gelb auf (mit Typ-Farbe und Icon),
     * BEVOR der Slide läuft.
     */
    async previewFlash(placements, ms) {
      const tiles = this.el.board.querySelectorAll(".tile");
      const byCell = new Map();
      for (const t of tiles) byCell.set(Number(t.dataset.r) * GRID_SIZE + Number(t.dataset.c), t);
      const marked = [];
      for (const p of placements) {
        const t = byCell.get(p.cell);
        if (!t || t.classList.contains("preview")) continue;
        t.classList.add("preview", `p-${p.type}`);
        t.querySelector(".face").insertAdjacentHTML("beforeend", `<svg class="preview-ic" aria-hidden="true"><use href="#${ICON[p.type]}"/></svg>`);
        marked.push(t);
      }
      if (Sound && Sound.previewPing) Sound.previewPing();
      await wait(ms);
      for (const t of marked) { t.classList.remove("preview", "p-stein", "p-brunnen", "p-trieb"); const ic = t.querySelector(".preview-ic"); if (ic) ic.remove(); }
    },

    /** Zielwort blüht auf: Buchstaben bunt, Farb-Bloom + Blüten über dem Brett. */
    async bloom(state) {
      const sol = state.solved;
      const tiles = this.renderBoard(state.grid, state);
      sol.cells.forEach((cell, k) => {
        const t = tiles.get(cell);
        const [c, d] = BLOOM[k % BLOOM.length];
        t.classList.add("bloom");
        t.style.setProperty("--bc", `var(${c})`);
        t.style.setProperty("--bd", `var(${d})`);
        t.style.setProperty("--k", k);
      });
      const b = this.el.bloom;
      b.innerHTML = [[8, 6], [62, 4], [30, 40], [70, 58], [6, 66], [44, 76]]
        .map(([x, y], k) => `<svg style="--x:${x}%;--y:${y}%;--d:${(k * 0.12).toFixed(2)}s"><use href="#i-flower"/></svg>`).join("");
      b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
      if (Sound && Sound.bloom) Sound.bloom(sol.length);
      await wait(ANIM.bloom);
    },

    showWordFlash(step) {
      const f = this.el.flash;
      f.querySelector(".words").textContent = step.matches.map((m) => m.word).join(" · ");
      // Kurze Wörter geben keine Punkte – angezeigt wird, was sie pflanzen
      const names = { stein: "Stein", brunnen: "Brunnen", trieb: "Trieb" };
      f.querySelector(".pts").textContent = step.plan.length
        ? "+ " + step.plan.map((p) => names[p.type]).join(" + ")
        : "kein Modifikator";
      f.classList.add("show");
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => f.classList.remove("show"), ANIM.wordHold);
    },

    showComboPop(level) {
      const p = this.el.comboPop;
      p.textContent = `COMBO ×${level}`;
      p.classList.remove("show");
      void p.offsetWidth; // Reflow, damit der Pop erneut startet
      p.classList.add("show");
      clearTimeout(this._comboTimer);
      this._comboTimer = setTimeout(() => p.classList.remove("show"), ANIM.comboHold);
    },

    /**
     * HUD aktualisieren (Punkte, Züge, Combo, Zielwort-Feld, Modifikator-Leiste, Hinweis-Zähler).
     * override erlaubt während der Kaskaden-Animation Zwischenstände: { score, comboLevel, bump, mods }.
     */
    updateHud(state, override = {}) {
      const mode = MODES[state.modeId];
      this.el.mode.textContent = mode.title(state);
      this.el.moves.textContent = state.moves;
      this.el.score.textContent = override.score ?? state.score;
      const level = override.comboLevel ?? state.combo;
      this.el.comboValue.textContent = `×${formatMult(comboMultiplier(Math.max(level, 1)))}`;
      const c = this.el.combo;
      c.dataset.level = String(Math.min(level, 5));
      if (override.bump) {
        c.classList.add("bump");
        setTimeout(() => c.classList.remove("bump"), 160);
      }
      this.renderTarget(state);
      // Modifikator-Leiste: „Stein: 2 | Brunnen: 1 | Trieb: 0“; im Level deaktivierte Typen blass
      const counts = L.countModifiers(override.mods || state);
      for (const t of L.MOD_TYPES) this.el.counts[t].textContent = counts[t];
      for (const chip of this.el.chips) {
        const on = state.enabled[chip.dataset.type];
        chip.classList.toggle("off", !on);
        chip.title = on ? "" : "In diesem Level noch nicht aktiv";
      }
      this.el.hintCount.textContent = state.target ? Math.max(0, L.CONFIG.HINTS_PER_LEVEL - state.hintsUsed) : "–";
      this.el.overlay.classList.toggle("show", !!state.solved && !override.hideOverlay);
      if (state.solved) {
        this.el.endedTitle.textContent = `${state.target} gelöst!`;
        this.el.endedSummary.textContent = `${state.levelPoints} Punkte in ${state.moves} ${state.moves === 1 ? "Zug" : "Zügen"}`;
      }
    },

    /** Zielwort-Feld: „Etwas Warmes · 6 Buchstaben“ + Platzhalter „_ _ _ _ _ _“ (Hinweise decken auf). */
    renderTarget(state) {
      const { targetCard, targetHint, slots, hintLine } = this.el;
      targetCard.classList.toggle("free", !state.target);
      if (!state.target) {
        targetHint.textContent = "Kein Zielwort – probiere Steine, Brunnen und Triebe aus";
        slots.textContent = "";
        hintLine.hidden = true;
        return;
      }
      const t = state.target;
      const hint = state.hint.charAt(0).toUpperCase() + state.hint.slice(1);
      targetHint.textContent = `${hint} · ${t.length} Buchstaben`;
      slots.textContent = "";
      for (let k = 0; k < t.length; k++) {
        const el = document.createElement("span");
        const shown = state.solved || state.revealed.includes(k);
        el.className = "slot" + (state.solved ? " solved" : shown ? " revealed" : " empty");
        el.textContent = shown ? t[k] : "_";
        slots.appendChild(el);
      }
      slots.setAttribute("aria-label", `Zielwort: ${[...t].map((ch, k) => (state.solved || state.revealed.includes(k) ? ch : "_")).join(" ")} (${t.length} Buchstaben)`);
      const last = state.hints[state.hints.length - 1];
      hintLine.hidden = !last;
      if (last) hintLine.textContent = `Hinweis ${state.hints.length}/${L.CONFIG.HINTS_PER_LEVEL}: ${last.text}`;
    },

    /* ---------------------------------------------------------------
     * In-Game-Dialog (ersetzt confirm()/alert()).
     * modal({ title, body, actions }) -> Promise mit dem `value` der gewählten Aktion
     * (bzw. "cancel" bei Escape/Hintergrund).
     *   body:    HTML-String oder DOM-Knoten
     *   actions: [{ label, value, cls: "pill-mint"|"pill-peach"|..., icon: "i-share", keepOpen, onClick }]
     *            keepOpen = Dialog bleibt offen, onClick(modalBody) wird aufgerufen
     * ------------------------------------------------------------- */
    modalOpen: false,
    _modalResolve: null,

    modal({ title, body = "", actions = [{ label: "OK", value: "ok", cls: "pill-mint" }] }) {
      if (this.modalOpen) this.closeModal("cancel");
      const { modal, modalTitle, modalBody, modalActions } = this.el;
      modalTitle.textContent = title;
      modalBody.textContent = "";
      if (typeof body === "string") modalBody.innerHTML = body;
      else if (body) modalBody.appendChild(body);
      modalActions.textContent = "";
      for (const a of actions) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `pill ${a.cls || "pill-cream"}`;
        b.dataset.value = a.value;
        b.innerHTML = (a.icon ? `<svg class="ic" aria-hidden="true"><use href="#${a.icon}"/></svg>` : "") + `<span></span>`;
        b.querySelector("span").textContent = a.label;
        b.addEventListener("click", () => {
          if (a.onClick) a.onClick(modalBody);
          if (!a.keepOpen) this.closeModal(a.value);
        });
        modalActions.appendChild(b);
      }
      modal.hidden = false;
      this.modalOpen = true;
      requestAnimationFrame(() => modal.classList.add("show"));
      const primary = modalActions.lastElementChild;
      if (primary) primary.focus({ preventScroll: true });
      return new Promise((res) => { this._modalResolve = res; });
    },

    closeModal(value) {
      if (!this.modalOpen) return;
      const { modal } = this.el;
      modal.classList.remove("show");
      modal.hidden = true;
      this.modalOpen = false;
      const res = this._modalResolve;
      this._modalResolve = null;
      if (res) res(value);
    }
  };

  /** Kleiner HTML-Escaper für Dialog-Inhalte. */
  function esc(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  View.esc = esc;
  View.formatMult = formatMult;

  root.LetterSlideView = View;
})(typeof globalThis !== "undefined" ? globalThis : this);
