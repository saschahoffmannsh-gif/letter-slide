/*
 * Letter Slide – VERDRAHTUNG / ABLAUFSTEUERUNG
 * ============================================
 * Hält den Spielzustand, verbindet Eingabe -> Logik -> Rendering, steuert
 * Startseite <-> Spiel, speichert Ergebnisse (stats.js) und blockiert Eingaben,
 * solange Animationen laufen oder ein Dialog offen ist.
 */
(function (root) {
  "use strict";

  const L = root.LetterSlideLogic;
  const Stats = root.LetterSlideStats;
  const View = root.LetterSlideView;
  const Input = root.LetterSlideInput;
  const Sound = root.LetterSlideAudio;
  const Particles = root.LetterSlideParticles;

  /** localStorage kann (Privatmodus, file:// in manchen Browsern) fehlen oder werfen. */
  const storage = (() => { try { const s = root.localStorage; s.getItem("x"); return s; } catch (_) { return null; } })();
  let stats = Stats.loadStats(storage);

  let game = null;          // aktueller Spielzustand (null = noch nichts gestartet)
  let busy = false;         // true während Animationen -> Eingaben werden ignoriert
  let screen = "start";     // "start" | "game"
  const SCREEN_MS = 320;    // Dauer des Bildschirmwechsels (passend zu style.css)

  const $ = (id) => document.getElementById(id);
  const btn = {
    undo: $("btn-undo"), reset: $("btn-reset"), share: $("btn-share"), end: $("btn-end"),
    menu: $("btn-menu"), howto: $("btn-howto")
  };
  const startEl = {
    screen: $("start"), daily: $("start-daily"), dailyTitle: $("start-daily-title"), dailySub: $("start-daily-sub"),
    share: $("start-share"), endless: $("start-endless"), endlessSub: $("start-endless-sub"), howto: $("start-howto")
  };
  const gameScreen = $("game");

  /* ------------------------------------------------------------------ Anzeige */

  function refreshControls() {
    const off = busy || !game;
    btn.undo.disabled = off || game.ended || game.history.length === 0;
    btn.reset.disabled = off;
    btn.end.disabled = off || game.ended;
    btn.share.disabled = off;
    btn.menu.disabled = busy;
    for (const b of document.querySelectorAll("button.arrow")) b.disabled = off || game.ended;
    if (game) btn.reset.title = game.modeId === "daily" ? "Tagesrätsel neu starten (gleiches Brett)" : "Gleiches Brett neu starten";
    for (const m of document.querySelectorAll(".btn-mute")) {
      m.querySelector("use").setAttribute("href", Sound.enabled ? "#i-sound" : "#i-mute");
      m.classList.toggle("muted", !Sound.enabled);
      m.setAttribute("aria-label", Sound.enabled ? "Ton aus" : "Ton an");
    }
  }

  function fullRender() {
    if (game) {
      View.renderBoard(game.grid);
      View.updateHud(game);
    }
    refreshControls();
  }

  /** Startseite mit heutigem Tagesrätsel, gespeichertem Ergebnis und Endlos-Rekord füllen. */
  function renderStart() {
    const today = L.formatDateKey(new Date());
    const n = L.dailyPuzzleNumber(today);
    const [y, m, d] = today.split("-");
    const res = Stats.dailyResult(stats, today);
    startEl.dailyTitle.textContent = `Tagesrätsel #${n}`;
    startEl.dailySub.textContent = res
      ? `✓ Geschafft: ${res.score} Punkte · nochmal spielen`
      : `${d}.${m}.${y} · ein Brett für alle`;
    startEl.daily.classList.toggle("done", !!res);
    startEl.share.hidden = !res;
    startEl.endlessSub.textContent = stats.endlessBest > 0 ? `Rekord: ${stats.endlessBest} Punkte` : "Noch kein Rekord";
  }

  /* ------------------------------------------------------------------ Bildschirmwechsel */

  /** Weicher Wechsel zwischen Startseite und Spiel (Ein-/Ausblenden + leichtes Zoomen). */
  async function showScreen(name) {
    if (screen === name) return;
    const from = name === "game" ? startEl.screen : gameScreen;
    const to = name === "game" ? gameScreen : startEl.screen;
    screen = name;
    from.classList.add("off");
    await wait(SCREEN_MS * 0.6);
    from.hidden = true;
    to.hidden = false;
    void to.offsetWidth; // Startzustand rendern, damit die Transition läuft
    to.classList.remove("off");
    if (name === "game") View.introBoard();
  }
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  /* ------------------------------------------------------------------ Spielablauf */

  /** Ein Zug inkl. aller Animationen (Slide -> je Kaskadenstufe: Treffer/Zerbröseln + Fallen). */
  async function handleSlide(axis, index, dir) {
    if (!game || busy || game.ended || View.modalOpen || screen !== "game") return;
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

  /** Neue Runde im gewünschten Modus starten und zum Spiel wechseln. */
  function startGame(modeId) {
    Particles.clear();
    game = modeId === "daily" ? L.startDaily() : modeId === "endless" ? L.startEndless() : L.startMode(modeId);
    View.selection = null;
    fullRender();
    return showScreen("game");
  }

  /** Endlos-Rekord sichern (beim Verlassen/Beenden einer Endlos-Runde). */
  function rememberEndless() {
    if (game && game.modeId === "endless" && game.score > 0) {
      Stats.recordEndless(stats, game.score);
      Stats.saveStats(storage, stats);
    }
  }

  /** Bestätigung im In-Game-Dialog (statt confirm()). Liefert Promise<boolean>. */
  async function confirmLeave() {
    if (!game || game.moves === 0 || game.ended) return true;
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

  /** Zurück zur Startseite (mit Rückfrage, falls eine Runde läuft). */
  async function goToMenu() {
    if (busy || View.modalOpen) return;
    if (!(await confirmLeave())) return;
    rememberEndless();
    Particles.clear();
    renderStart();
    await showScreen("start");
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
  async function shareText(text) {
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

  /** Runde beenden: Score festhalten, Ergebnis speichern, Zusammenfassung zeigen. */
  async function endRoundDialog() {
    const text = L.endRound(game);
    let newBest = false;
    if (game.modeId === "daily") {
      newBest = Stats.recordDaily(stats, {
        dateKey: game.dateKey, puzzleNumber: game.puzzleNumber, score: game.score,
        moves: game.moves, maxCombo: game.maxCombo, shareText: text
      }).isNewBest;
    } else if (game.modeId === "endless") {
      newBest = Stats.recordEndless(stats, game.score).isNewBest && game.score > 0;
    }
    Stats.saveStats(storage, stats);
    fullRender();
    const fires = game.maxCombo > 0 ? "🔥".repeat(game.maxCombo) : "–";
    const title = L.MODES[game.modeId].title(game);
    const choice = await View.modal({
      title: "Runde beendet",
      body: `<p>${View.esc(title)}${newBest ? " · <b>Neuer Rekord!</b>" : ""}</p><div class="stats"><span>★ ${game.score}</span><span>${game.moves} ${game.moves === 1 ? "Zug" : "Züge"}</span><span>${fires}</span></div>`,
      actions: [
        { label: "Menü", value: "menu", cls: "pill-cream", icon: "i-home" },
        { label: "Teilen", value: "share", cls: "pill-lavender", icon: "i-share" }
      ]
    });
    if (choice === "share") shareText(text);
    else if (choice === "menu") goToMenu();
  }

  /** „So geht's“-Dialog mit Regeln und Punktetabelle (Werte live aus config.js). */
  function showHowTo() {
    if (View.modalOpen) return;
    const C = L.CONFIG;
    const rows = Object.entries(C.SCORE_BY_LENGTH)
      .map(([len, pts]) => `<tr><td>${len}${Number(len) === 6 ? "+" : ""} Buchstaben</td><td><b>${pts}</b></td></tr>`).join("");
    const mult = [1, 2, 3, 4].map((lvl) => `×${View.formatMult(L.comboMultiplier(lvl))}`).join(" · ");
    View.modal({
      title: "So geht's",
      body: `
        <ul class="howto">
          <li><b>Schieben:</b> Wische eine Zeile oder Spalte (oder tippe die Pfeile am Rand) – sie rückt um ein Feld, was rausfällt, kommt gegenüber wieder rein.</li>
          <li><b>Wörter:</b> Ab ${C.MIN_WORD_LENGTH} Buchstaben, waagerecht oder senkrecht, zerbröseln und geben Punkte.</li>
          <li><b>Kaskaden:</b> Neue Buchstaben fallen nach – entstehen dabei Wörter, steigt die Combo: ${mult}.</li>
          <li><b>Ziel:</b> Möglichst viele Punkte. Kein Zeitlimit, kein Game Over.</li>
        </ul>
        <table class="score-table"><tbody>${rows}</tbody></table>`,
      actions: [{ label: "Los geht's", value: "ok", cls: "pill-mint" }]
    });
  }

  /** Web-Manifest nur über http(s) einbinden (über file:// würde der Browser einen CORS-Fehler loggen). */
  function linkManifest() {
    if (!/^https?:$/.test(location.protocol)) return;
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "manifest.webmanifest";
    document.head.appendChild(link);
  }

  const toggleMute = () => { Sound.setEnabled(!Sound.enabled); if (Sound.enabled) Sound.unlock(); refreshControls(); };

  /* ------------------------------------------------------------------ Verdrahtung */
  Sound.loadPreference();
  Sound.installUnlock(document);
  Particles.init();
  View.init(handleSlide, () => {});
  Input.bind({
    onSlide: handleSlide,
    onUndo: () => {
      if (!game || busy || View.modalOpen || screen !== "game") return;
      if (L.undo(game)) { Particles.clear(); fullRender(); }
    },
    onReset: () => { if (!game || busy || View.modalOpen) return; Particles.clear(); L.reset(game); fullRender(); View.introBoard(); },
    onEnd: () => { if (game && !busy && !game.ended && !View.modalOpen) endRoundDialog(); },
    onShare: () => { if (game && !busy && !View.modalOpen) shareText(L.buildShareText(game)); },
    onToggleMute: toggleMute,
    onSelect: (r, c) => { if (!game) return; View.selection = { r, c }; View.renderBoard(game.grid); },
    isBusy: () => busy || View.modalOpen || screen !== "game" || !game
  });
  btn.menu.addEventListener("click", goToMenu);
  btn.howto.addEventListener("click", showHowTo);
  startEl.daily.addEventListener("click", () => { if (!View.modalOpen) startGame("daily"); });
  startEl.endless.addEventListener("click", () => { if (!View.modalOpen) startGame("endless"); });
  startEl.howto.addEventListener("click", showHowTo);
  startEl.share.addEventListener("click", () => {
    const res = Stats.dailyResult(stats, L.formatDateKey(new Date()));
    if (res && !View.modalOpen) shareText(res.shareText);
  });
  $("start-mute").addEventListener("click", toggleMute);
  root.addEventListener("pagehide", rememberEndless);

  linkManifest();
  renderStart();
  refreshControls();

  /* Kleiner Debug-/Test-Zugang (wird vom Browser-Smoke-Test genutzt). */
  root.LetterSlideApp = {
    get game() { return game; },
    get busy() { return busy; },
    get screen() { return screen; },
    get modalOpen() { return View.modalOpen; },
    get stats() { return stats; },
    handleSlide, startGame, goToMenu
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
