/*
 * Letter Slide – VERDRAHTUNG / ABLAUFSTEUERUNG
 * ============================================
 * Hält den Spielzustand, verbindet Eingabe -> Logik -> Rendering und blockiert
 * Eingaben, solange Animationen laufen.
 */
(function (root) {
  "use strict";

  const L = root.LetterSlideLogic;
  const View = root.LetterSlideView;
  const Input = root.LetterSlideInput;
  const Sound = root.LetterSlideAudio;

  let game = L.startDaily();
  let busy = false; // true während Animationen -> Eingaben werden ignoriert

  const $ = (id) => document.getElementById(id);
  const btn = { undo: $("btn-undo"), reset: $("btn-reset"), share: $("btn-share"), end: $("btn-end"), mute: $("btn-mute") };

  function refreshControls() {
    btn.undo.disabled = busy || game.ended || game.history.length === 0;
    btn.reset.disabled = busy;
    btn.end.disabled = busy || game.ended;
    btn.share.disabled = busy;
    for (const b of document.querySelectorAll("button.arrow")) b.disabled = busy || game.ended;
    btn.reset.title = game.modeId === "daily" ? "Tagesrätsel neu starten (gleiches Brett)" : "Gleiches Brett neu starten";
    btn.mute.textContent = Sound.enabled ? "🔊" : "🔇";
    btn.mute.setAttribute("aria-label", Sound.enabled ? "Ton aus" : "Ton an");
  }

  function fullRender() {
    View.renderBoard(game.grid);
    View.updateHud(game);
    refreshControls();
  }

  /** Ein Zug inkl. aller Animationen (Slide -> je Kaskadenstufe: Treffer + Fallen). */
  async function handleSlide(axis, index, dir) {
    if (busy || game.ended) return;
    busy = true;
    refreshControls();
    Sound.click();
    const scoreBefore = game.score;
    const result = L.performSlide(game, axis, index, dir);
    try {
      View.updateHud(game, { score: scoreBefore, comboLevel: 0 });
      await View.animateSlide(result.gridBefore, axis, index, dir);
      View.renderBoard(result.gridAfterSlide);
      for (const step of result.steps) {
        Sound.word(Math.max(...step.matches.map((m) => m.length)), step.level);
        View.updateHud(game, { score: step.scoreAfter, comboLevel: step.level, bump: step.level >= 2 });
        await View.animateClear(step);
        await View.animateFall(step);
      }
    } finally {
      busy = false;
      fullRender();
    }
  }

  function confirmLeave() {
    return game.moves === 0 || game.ended || root.confirm("Aktuelle Runde verwerfen?");
  }

  function switchMode(modeId) {
    if (busy || !confirmLeave()) return;
    game = modeId === "daily" ? L.startDaily() : modeId === "endless" ? L.startEndless() : L.startMode(modeId);
    View.hideShare();
    fullRender();
  }

  /** Text in die Zwischenablage kopieren, mit Fallback (Textfeld + execCommand + alert). */
  async function shareResult() {
    const text = L.buildShareText(game);
    try {
      if (!navigator.clipboard || !root.isSecureContext) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      View.showShare(text, "In die Zwischenablage kopiert ✓");
    } catch (e) {
      View.showShare(text, "Bitte manuell kopieren.");
      const ta = View.el.shareText;
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
      if (ok) View.el.shareStatus.textContent = "In die Zwischenablage kopiert ✓";
      else root.alert(text);
    }
  }

  /** Web-Manifest nur über http(s) einbinden (über file:// würde der Browser einen CORS-Fehler loggen). */
  function linkManifest() {
    if (!/^https?:$/.test(location.protocol)) return;
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "manifest.webmanifest";
    document.head.appendChild(link);
  }

  /* --- Verdrahtung --- */
  Sound.loadPreference();
  Sound.installUnlock(document);
  View.init(handleSlide, switchMode);
  Input.bind({
    onSlide: handleSlide,
    onUndo: () => { if (!busy && L.undo(game)) fullRender(); },
    onReset: () => { if (busy) return; L.reset(game); View.hideShare(); fullRender(); },
    onEnd: () => {
      if (busy || game.ended) return;
      const text = L.endRound(game);
      View.showShare(text, "Runde beendet – Score festgehalten. „Teilen“ kopiert den Text.");
      fullRender();
    },
    onShare: () => { if (!busy) shareResult(); },
    onToggleMute: () => { Sound.setEnabled(!Sound.enabled); if (Sound.enabled) Sound.unlock(); refreshControls(); },
    onSelect: (r, c) => { View.selection = { r, c }; View.renderBoard(game.grid); },
    isBusy: () => busy
  });
  linkManifest();
  fullRender();

  /* Kleiner Debug-/Test-Zugang (wird vom Browser-Smoke-Test genutzt). */
  root.LetterSlideApp = {
    get game() { return game; },
    get busy() { return busy; },
    handleSlide
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
