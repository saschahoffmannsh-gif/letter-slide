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
    btn.mute.querySelector("use").setAttribute("href", Sound.enabled ? "#i-sound" : "#i-mute");
    btn.mute.classList.toggle("muted", !Sound.enabled);
    btn.mute.setAttribute("aria-label", Sound.enabled ? "Ton aus" : "Ton an");
  }

  function fullRender() {
    View.renderBoard(game.grid);
    View.updateHud(game);
    refreshControls();
  }

  /** Ein Zug inkl. aller Animationen (Slide -> je Kaskadenstufe: Treffer + Fallen). */
  async function handleSlide(axis, index, dir) {
    if (busy || game.ended || View.modalOpen) return;
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

  /** Bestätigung im In-Game-Dialog (statt confirm()). Liefert Promise<boolean>. */
  async function confirmLeave() {
    if (game.moves === 0 || game.ended) return true;
    const choice = await View.modal({
      title: "Aktuelle Runde verwerfen?",
      body: `<p>Dein Fortschritt geht verloren.</p><div class="stats"><span>★ ${game.score}</span><span>${game.moves} ${game.moves === 1 ? "Zug" : "Züge"}</span></div>`,
      actions: [
        { label: "Abbrechen", value: "cancel", cls: "pill-cream" },
        { label: "Verwerfen", value: "ok", cls: "pill-peach", icon: "i-reset" }
      ]
    });
    return choice === "ok";
  }

  async function switchMode(modeId) {
    if (busy || View.modalOpen) return;
    if (!(await confirmLeave())) return;
    game = modeId === "daily" ? L.startDaily() : modeId === "endless" ? L.startEndless() : L.startMode(modeId);
    fullRender();
  }

  /** Text kopieren: Clipboard-API, sonst markiertes Textfeld + execCommand. Liefert true/false. */
  async function copyText(text, textarea) {
    try {
      if (navigator.clipboard && root.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* Fallback unten */ }
    try {
      textarea.focus();
      textarea.select();
      return document.execCommand("copy");
    } catch (_) {
      return false;
    }
  }

  /** Teilen-Dialog: Text anzeigen und direkt kopieren (statt alert()). */
  async function shareResult() {
    const text = L.buildShareText(game);
    const body = document.createElement("div");
    body.innerHTML = `<p>Ohne Spoiler – nur Züge, Punkte und Combo.</p><textarea rows="2" readonly></textarea><div class="status"></div>`;
    const ta = body.querySelector("textarea");
    const status = body.querySelector(".status");
    ta.value = text;
    const tryCopy = async () => {
      const ok = await copyText(text, ta);
      status.textContent = ok ? "In die Zwischenablage kopiert ✓" : "Bitte Text markieren und manuell kopieren.";
    };
    const done = View.modal({
      title: "Teilen",
      body,
      actions: [
        { label: "Kopieren", value: "copy", cls: "pill-lavender", icon: "i-share", keepOpen: true, onClick: tryCopy },
        { label: "Fertig", value: "ok", cls: "pill-mint" }
      ]
    });
    tryCopy();
    return done;
  }

  /** Runde beenden: Score festhalten und Zusammenfassung im Dialog zeigen. */
  async function endRoundDialog() {
    L.endRound(game);
    fullRender();
    const fires = game.maxCombo > 0 ? "🔥".repeat(game.maxCombo) : "–";
    const choice = await View.modal({
      title: "Runde beendet",
      body: `<p>${View.esc(MODES_TITLE())}</p><div class="stats"><span>★ ${game.score}</span><span>${game.moves} ${game.moves === 1 ? "Zug" : "Züge"}</span><span>${fires}</span></div>`,
      actions: [
        { label: "Schließen", value: "close", cls: "pill-cream" },
        { label: "Teilen", value: "share", cls: "pill-lavender", icon: "i-share" }
      ]
    });
    if (choice === "share") shareResult();
  }
  const MODES_TITLE = () => L.MODES[game.modeId].title(game);

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
    onUndo: () => { if (!busy && !View.modalOpen && L.undo(game)) fullRender(); },
    onReset: () => { if (busy || View.modalOpen) return; L.reset(game); fullRender(); },
    onEnd: () => { if (!busy && !game.ended && !View.modalOpen) endRoundDialog(); },
    onShare: () => { if (!busy && !View.modalOpen) shareResult(); },
    onToggleMute: () => { Sound.setEnabled(!Sound.enabled); if (Sound.enabled) Sound.unlock(); refreshControls(); },
    onSelect: (r, c) => { View.selection = { r, c }; View.renderBoard(game.grid); },
    isBusy: () => busy || View.modalOpen
  });
  linkManifest();
  fullRender();

  /* Kleiner Debug-/Test-Zugang (wird vom Browser-Smoke-Test genutzt). */
  root.LetterSlideApp = {
    get game() { return game; },
    get busy() { return busy; },
    get modalOpen() { return View.modalOpen; },
    handleSlide
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
