/*
 * Wortgarten – EINGABE
 * =====================
 * Übersetzt Nutzeraktionen in Befehle an den Controller (main.js):
 *   - Buttons (Undo, Reset, Hinweis, Vorschau, Was passiert?, Teilen, Ton)
 *   - Wischgesten auf dem Brett (Pointer Events: Touch, Maus, Stift)
 *       waagerecht wischen -> Zeile der berührten Kachel um 1 Feld
 *       senkrecht wischen  -> Spalte der berührten Kachel um 1 Feld
 *       kurzes Tippen       -> Kachel auswählen (für die Tastatur)
 *   - Tastatur: Pfeile verschieben Zeile/Spalte der Auswahl, Shift+Pfeile
 *     bewegen die Auswahl, Strg/Cmd+Z = Undo
 * Die Randpfeile werden in render.js erzeugt und rufen direkt onSlide auf.
 */
(function (root) {
  "use strict";

  const { GRID_SIZE } = root.LetterSlideLogic;
  const View = root.LetterSlideView;

  /** Ab welcher Strecke eine Bewegung als Wischen zählt (Anteil einer Zelle, mind. px). */
  const SWIPE_MIN_PX = 16;
  const SWIPE_CELL_FRACTION = 0.3;
  /** Bis zu welcher Strecke ein Loslassen als Tippen zählt. */
  const TAP_MAX_PX = 10;

  /**
   * @param h Handler: { onSlide(axis, index, dir), onUndo(), onReset(), onShare(), onHint(), onWhatIf(), onTogglePreview(),
   *                     onToggleMute(), onSelect(r, c), isBusy() }
   */
  function bind(h) {
    const $ = (id) => document.getElementById(id);
    $("btn-undo").addEventListener("click", h.onUndo);
    $("btn-reset").addEventListener("click", h.onReset);
    $("btn-share").addEventListener("click", h.onShare);
    $("btn-hint").addEventListener("click", h.onHint);
    $("btn-whatif").addEventListener("click", h.onWhatIf);
    $("btn-preview").addEventListener("click", h.onTogglePreview);
    $("btn-mute").addEventListener("click", h.onToggleMute);
    bindSwipe(View.el.board, h);
    bindKeyboard(h);
  }

  /** Wischgesten auf dem Brett mit Pointer Events (kein Maus-only-Code). */
  function bindSwipe(board, h) {
    let g = null; // aktuelle Geste { id, x, y, r, c, done }

    board.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary || g) return;
      const tile = e.target.closest(".tile");
      if (!tile) return;
      e.preventDefault(); // kein Text-Markieren / kein Kompatibilitäts-Mausevent
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, r: Number(tile.dataset.r), c: Number(tile.dataset.c), done: false };
      try { board.setPointerCapture(e.pointerId); } catch (_) { /* egal */ }
    });

    board.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id || g.done) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      const threshold = Math.max(SWIPE_MIN_PX, View.cellSize() * SWIPE_CELL_FRACTION);
      if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;
      g.done = true; // pro Geste genau ein Slide
      if (h.isBusy()) return;
      if (Math.abs(dx) > Math.abs(dy)) h.onSlide("row", g.r, dx > 0 ? 1 : -1);
      else h.onSlide("col", g.c, dy > 0 ? 1 : -1);
    });

    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const moved = Math.hypot(e.clientX - g.x, e.clientY - g.y);
      if (e.type === "pointerup" && !g.done && moved <= TAP_MAX_PX && !h.isBusy()) h.onSelect(g.r, g.c);
      g = null;
    };
    board.addEventListener("pointerup", end);
    board.addEventListener("pointercancel", end);
  }

  function bindKeyboard(h) {
    const dirs = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        h.onUndo();
        return;
      }
      if (!(e.key in dirs)) return;
      e.preventDefault();
      if (h.isBusy()) return;
      const [dr, dc] = dirs[e.key];
      if (!View.selection) { h.onSelect(0, 0); return; }
      const sel = View.selection;
      if (e.shiftKey) {
        h.onSelect((sel.r + dr + GRID_SIZE) % GRID_SIZE, (sel.c + dc + GRID_SIZE) % GRID_SIZE);
        return;
      }
      if (dc !== 0) h.onSlide("row", sel.r, dc);
      else h.onSlide("col", sel.c, dr);
    });
  }

  root.LetterSlideInput = { bind };
})(typeof globalThis !== "undefined" ? globalThis : this);
