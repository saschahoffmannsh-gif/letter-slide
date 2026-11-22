/*
 * Wortgarten – VERDRAHTUNG / ABLAUFSTEUERUNG
 * ==========================================
 * Hält den Spielzustand, verbindet Eingabe -> Logik -> Rendering, steuert Startseite <-> Spiel,
 * Level-Fortschritt, Hinweise, Tutorial-Tipps und Level-Abschluss, speichert den
 * Spielstand (stats.js) und blockiert Eingaben, solange Animationen laufen oder ein Dialog offen ist.
 */
(function (root) {
  "use strict";

  const L = root.LetterSlideLogic;
  const Stats = root.LetterSlideStats;
  const View = root.LetterSlideView;
  const Input = root.LetterSlideInput;
  const Sound = root.LetterSlideAudio;
  const Particles = root.LetterSlideParticles;
  const Tut = root.LetterSlideTutorial;
  const Coach = root.LetterSlideCoach;
  const C = L.CONFIG;

  /** localStorage kann (Privatmodus, file:// in manchen Browsern) fehlen oder werfen. */
  const storage = (() => { try { const s = root.localStorage; s.getItem("x"); return s; } catch (_) { return null; } })();
  // Link mit ?reset: kompletten Spielstand (Fortschritt, Tutorial, Tipps, Statistik) löschen, Ton-Einstellung bleibt.
  try {
    if (storage && /[?&]reset(=|&|$)/.test(root.location.search)) {
      storage.removeItem(Stats.STORAGE_KEY);
      root.history.replaceState(null, "", root.location.pathname + root.location.hash);
    }
  } catch (_) { /* egal */ }
  let stats = Stats.loadStats(storage);
  const save = () => Stats.saveStats(storage, stats);

  let game = null;          // aktueller Spielzustand (null = noch nichts gestartet)
  let busy = false;         // true während Animationen -> Eingaben werden ignoriert
  let screen = "start";     // "start" | "game"
  let session = null;       // laufendes Lehr-Level: { levelId, covers, game, ctx, finished, stepsDone }
  const SCREEN_MS = 320;

  const $ = (id) => document.getElementById(id);
  const btn = {
    undo: $("btn-undo"), reset: $("btn-reset"), hint: $("btn-hint"), share: $("btn-share"),
    menu: $("btn-menu"), howto: $("btn-howto")
  };
  const startEl = {
    screen: $("start"), level: $("start-level"), levelTitle: $("start-level-title"), levelSub: $("start-level-sub"),
    daily: $("start-daily"), dailyTitle: $("start-daily-title"), dailySub: $("start-daily-sub"),
    share: $("start-share"), free: $("start-free"), howto: $("start-howto"), tutorial: $("start-tutorial")
  };
  const gameScreen = $("game");
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  /** Tutorial-Texte. intro = beim Levelstart, protect = sobald Zielbuchstaben auf dem Brett liegen. */
  const TIPS = {
    intro1: { level: 1, title: "Willkommen im Wortgarten", body: "Jedes Level versteckt ein <b>Zielwort</b>. Du kennst nur den Hinweis und die Länge. Schiebe Zeilen und Spalten, bis das Wort waagerecht oder senkrecht dasteht." },
    protect: { any: true, minLevel: 2, title: "Zielbuchstaben sind geschützt", body: "Die hellen, lila unterstrichenen Kacheln gehören zu deinem Zielwort (je so viele, wie das Wort braucht). Sie <b>zerbröseln nie und bleiben stehen</b>, wenn darunter etwas wegfällt. Schieben bewegt sie ganz normal." }
  };

  /* ------------------------------------------------------------------ Anzeige */

  function refreshControls() {
    const off = busy || !game;
    btn.undo.disabled = off || game.ended || game.history.length === 0;
    btn.reset.disabled = off;
    btn.hint.disabled = off || !game.target || game.ended || game.hintsUsed >= C.HINTS_PER_LEVEL;
    btn.share.disabled = off;
    btn.menu.disabled = busy;
    // Pfeile: aus, wenn Level gelöst
    for (const b of document.querySelectorAll("button.arrow")) {
      b.disabled = off || game.ended || !L.canSlide(game, b.dataset.axis, Number(b.dataset.index));
    }
    for (const m of document.querySelectorAll(".btn-mute")) {
      m.querySelector("use").setAttribute("href", Sound.enabled ? "#i-sound" : "#i-mute");
      m.classList.toggle("muted", !Sound.enabled);
      m.setAttribute("aria-label", Sound.enabled ? "Ton aus" : "Ton an");
    }
  }

  function fullRender() {
    if (game) {
      View.renderBoard(game.grid, game);
      View.updateHud(game);
    }
    refreshControls();
  }

  /** Nächstes zu spielendes Level (Fortschritt). */
  const currentLevelId = () => Math.min(stats.progress.unlocked, L.LEVELS.length);

  /** Startseite: Level-Fortschritt, heutiges Tagesrätsel, Freies Spiel. */
  function renderStart() {
    const n = L.LEVELS.length;
    const solved = Stats.solvedCount(stats);
    const total = Stats.totalScore(stats);
    const allDone = stats.progress.unlocked > n;
    startEl.levelTitle.textContent = allDone ? "Alle Level gelöst" : `Level ${currentLevelId()} spielen`;
    startEl.levelSub.textContent = allDone
      ? `Gesamt ${total} Punkte · nochmal ab Level 1`
      : solved ? `Gesamt ${total} Punkte · ${solved}/${n} gelöst`
      : guidedFor(1) ? "Lehr-Level · Schritt für Schritt erklärt" : `${n} Level · vom Tutorial bis zum letzten Garten`;
    // „Tutorial wiederholen“ erst zeigen, wenn es schon einmal lief oder übersprungen wurde
    startEl.tutorial.hidden = !(stats.tutorial.skipped || Object.keys(stats.tutorial.done).length || stats.progress.unlocked > 1);
    const today = L.formatDateKey(new Date());
    const [y, m, d] = today.split("-");
    const res = Stats.dailyResult(stats, today);
    startEl.dailyTitle.textContent = `Tagesrätsel #${L.dailyPuzzleNumber(today)}`;
    startEl.dailySub.textContent = res ? `✓ Gelöst: ${res.score} Punkte · nochmal spielen` : `${d}.${m}.${y} · ein Level für alle`;
    startEl.daily.classList.toggle("done", !!res);
    startEl.share.hidden = !res;
  }

  /* ------------------------------------------------------------------ Bildschirmwechsel */

  async function showScreen(name) {
    if (screen === name) return;
    const from = name === "game" ? startEl.screen : gameScreen;
    const to = name === "game" ? gameScreen : startEl.screen;
    screen = name;
    from.classList.add("off");
    await wait(SCREEN_MS * 0.6);
    from.hidden = true;
    to.hidden = false;
    void to.offsetWidth;
    to.classList.remove("off");
    if (name === "game") View.introBoard();
  }

  /* ------------------------------------------------------------------ Spielablauf */

  /**
   * Ein Zug inkl. aller Animationen:
   * Slide -> je Kaskadenstufe Zerbröseln + Fallen -> ggf. Zielwort blüht auf -> Level-Abschluss.
   */
  async function handleSlide(axis, index, dir) {
    if (!game || busy || game.ended || View.modalOpen || screen !== "game") return;
    if (!L.canSlide(game, axis, index)) return;
    // Lehr-Level: nur der geforderte Zug ist erlaubt, alles andere wackelt sanft
    if (!gate({ type: "slide", axis, index, dir }, document.querySelector(`button.arrow[data-axis="${axis}"][data-index="${index}"][data-dir="${dir}"]`))) return;
    busy = true;
    Coach.busy(true);
    refreshControls();
    let result = null;
    try {
      Sound.click();
      const scoreBefore = game.score;
      result = L.performSlide(game, axis, index, dir);
      View.updateHud(game, { score: scoreBefore, comboLevel: 0, grid: result.gridBefore, hideOverlay: true });
      await View.animateSlide(result.gridBefore, axis, index, dir);
      View.renderBoard(result.gridAfterSlide, { target: game.target });
      for (const step of result.steps) {
        Sound.word(Math.max(...step.matches.map((m) => m.length)), step.level);
        View.updateHud(game, { score: scoreBefore, comboLevel: step.level, bump: step.level >= 2, grid: step.gridBefore, hideOverlay: true });
        await View.animateClear(step);
        await View.animateFall(step);
      }
      if (game.solved) {
        View.updateHud(game, { hideOverlay: true });
        await View.bloom(game);
      }
    } finally {
      busy = false;
      Coach.busy(false);
      fullRender();
    }
    if (Coach.active) Coach.satisfy({ type: "slide", axis, index, dir }, result);
    if (game.solved) return levelComplete();
    if (L.neededCells(game.grid, game.target).size) await maybeTip("protect");
  }

  /** Spielstand/Level starten und zum Spiel wechseln. */
  function begin(state) {
    stopTutorial();
    Particles.clear();
    game = state;
    View.selection = null;
    fullRender();
    const shown = showScreen("game");
    shown.then(() => levelIntro());
    return shown;
  }

  /** Level n starten (Gesamtpunkte = Summe der anderen Level). */
  function startLevel(id = currentLevelId()) {
    const st = L.loadLevel(id, { totalScore: Stats.totalScore(stats, id) });
    return begin(st);
  }
  const startDaily = () => begin(L.startDaily());
  const startFree = (seed) => begin(L.startFree(seed));

  /** Tipp-Dialog (einmalig, gemerkt in localStorage). */
  async function maybeTip(key) {
    const tip = TIPS[key];
    if (!tip || !game || game.modeId !== "level" || stats.tips[key]) return;
    if (Coach.active || (session && session.game === game)) return; // im Lehr-Level erklärt der Coach
    if (tip.any ? game.level.id < tip.minLevel : game.level.id !== tip.level) return;
    stats.tips[key] = true;
    save();
    await View.modal({ title: tip.title, body: `<p>${tip.body}</p>`, actions: [{ label: "Verstanden", value: "ok", cls: "pill-mint" }] });
  }
  async function levelIntro() {
    if (!game || game.modeId !== "level") return;
    if (guidedFor(game.level.id)) return runTutorial(game.level.id);
    await maybeTip(`intro${game.level.id}`);
  }

  /* ------------------------------------------------------------------ Lehr-Level (geführtes Tutorial) */

  /** Wird dieses Level geführt? (Skript vorhanden, Tutorial nicht übersprungen, Level noch nicht geführt gespielt) */
  const guidedFor = (id) => !!Tut.scriptFor(id) && !stats.tutorial.skipped && !stats.tutorial.done[id];

  /** Aktion erlaubt? Sonst sanftes Wackeln (Blase + Element). Ohne laufendes Tutorial immer erlaubt. */
  function gate(action, el) {
    if (!Coach.active || Coach.allow(action)) return true;
    Coach.reject(el);
    return false;
  }

  /** Lehr-Level-Schritte nacheinander zeigen. Ende: durchlaufen, übersprungen oder abgebrochen. */
  function runTutorial(id) {
    const script = Tut.scriptFor(id);
    const g = game;
    const ctx = { game: g, lastResult: null, index: 0, total: script.steps.length + (script.afterSolve || []).length };
    const me = { levelId: id, covers: script.covers, game: g, ctx, stepsDone: false };
    session = me;
    me.finished = (async () => {
      let res = "next";
      for (let k = 0; k < script.steps.length && res === "next"; k++) {
        ctx.index = k;
        res = await Coach.show(script.steps[k], ctx);
      }
      if (session !== me) return;
      if (res === "skip") return skipTutorial();
      if (res !== "next") { session = null; return; }
      // durchlaufen: Level als geführt gespielt merken, ersetzte Tipp-Popups gelten als gesehen
      me.stepsDone = true;
      stats.tutorial.done[id] = true;
      for (const k of script.covers) stats.tips[k] = true;
      save();
    })();
    return me.finished;
  }

  /** Nach dem Lösen eines Lehr-Levels: Abschluss-Schritte (Jubel, Punkte) vor dem Dialog. */
  async function tutorialAfterSolve() {
    const me = session;
    if (!me || me.game !== game) return;
    await me.finished;
    const after = (Tut.scriptFor(me.levelId).afterSolve || []);
    if (session === me && me.stepsDone) {
      for (let k = 0; k < after.length; k++) {
        me.ctx.index = Tut.scriptFor(me.levelId).steps.length + k;
        const r = await Coach.show(after[k], me.ctx);
        if (r === "skip") { skipTutorial(); break; }
        if (r !== "next") break;
      }
    }
    if (session === me) session = null;
  }

  /** „Überspringen“: ganzes Tutorial aus (Tipp-Popups übernehmen wieder als Kurzhilfe). */
  function skipTutorial() {
    stats.tutorial.skipped = true;
    save();
    session = null;
    refreshControls();
  }

  /** Laufendes Lehr-Level beenden (Menü, anderes Level). */
  function stopTutorial() {
    session = null;
    if (Coach.active) Coach.abort();
  }

  /** „Tutorial wiederholen“: Tutorial zurücksetzen und Level 1 geführt starten. */
  async function replayTutorial() {
    if (busy) return;
    if (View.modalOpen) View.closeModal("cancel");
    if (screen === "game" && !(await confirmLeave())) return;
    stopTutorial();
    stats.tutorial = { done: {}, skipped: false };
    for (const id of Tut.levelIds()) for (const k of Tut.scriptFor(id).covers) delete stats.tips[k];
    save();
    return startLevel(1);
  }

  /** Level gelöst: speichern, Dialog „Level X gelöst! Y Punkte. Züge: N.“ mit „Nächstes Level“. */
  async function levelComplete() {
    await tutorialAfterSolve();
    const sol = game.solved;
    const text = L.buildShareText(game);
    let newBest = false;
    if (game.modeId === "level") {
      newBest = Stats.recordLevel(stats, game.level.id, game.levelPoints).isNewBest;
    } else if (game.modeId === "daily") {
      newBest = Stats.recordDaily(stats, { dateKey: game.dateKey, puzzleNumber: game.puzzleNumber, score: game.levelPoints, moves: game.moves, maxCombo: game.maxCombo, shareText: text }).isNewBest;
    }
    save();
    const parts = [`${sol.length} × ${C.POINTS_PER_LETTER}`];
    if (sol.cascades) parts.push(`Kaskade ×${View.formatMult(sol.cascadeMult)}`);
    if (sol.hintsUsed) parts.push(`− ${Math.round(sol.hintsUsed * C.HINT_PENALTY * 100)} % (Hinweise)`);
    const last = game.modeId === "level" && game.level.id >= L.LEVELS.length;
    const title = game.modeId === "daily" ? "Tagesrätsel gelöst!" : last ? "Alle Level gelöst!" : `Level ${game.level.id} gelöst!`;
    const body = `<p><b>${View.esc(game.target)}</b> · ${game.levelPoints} Punkte. Züge: ${game.moves}.${newBest && game.modeId === "level" ? " <b>Bestwert!</b>" : ""}</p>
      <p class="formula">${parts.join(" · ")}</p>
      <div class="stats"><span>★ ${game.levelPoints}</span><span>${game.moves} ${game.moves === 1 ? "Zug" : "Züge"}</span><span>Σ ${game.modeId === "level" ? Stats.totalScore(stats) : game.levelPoints}</span></div>
      ${game.modeId === "level" && !last ? "<p>Weiter?</p>" : ""}`;
    const actions = [{ label: "Teilen", value: "share", cls: "pill-lavender", icon: "i-share" }];
    if (game.modeId === "level" && !last) actions.push({ label: "Nächstes Level", value: "next", cls: "pill-mint", icon: "i-play" });
    else actions.push({ label: "Menü", value: "menu", cls: "pill-mint", icon: "i-home" });
    const choice = await View.modal({ title, body, actions });
    if (choice === "share") { await shareText(text); return levelComplete(); }
    if (choice === "next") return nextLevel();
    if (choice === "menu") return goToMenu();
  }

  /** Nächstes Level laden (Gesamtpunkte übernehmen). */
  function nextLevel() {
    const next = L.nextLevel(game);
    if (!next) return goToMenu();
    stopTutorial();
    next.baseScore = Stats.totalScore(stats, next.level.id);
    next.score = next.baseScore;
    Particles.clear();
    game = next;
    View.selection = null;
    fullRender();
    View.introBoard();
    return levelIntro();
  }

  /** Hinweis: Rückfrage (kostet 20 %), dann Buchstabe + ungefähre Lage anzeigen. */
  async function showHint() {
    if (!game || busy || View.modalOpen || !game.target || game.ended) return;
    const left = C.HINTS_PER_LEVEL - game.hintsUsed;
    if (left <= 0) return;
    const pct = Math.round(C.HINT_PENALTY * 100);
    const ok = await View.modal({
      title: "Hinweis nehmen?",
      body: `<p>Ein Hinweis zeigt einen fehlenden Buchstaben des Zielworts und wo ungefähr er liegt.</p><div class="stats"><span>− ${pct} % Level-Punkte</span><span>noch ${left}</span></div>`,
      actions: [{ label: "Abbrechen", value: "cancel", cls: "pill-cream" }, { label: "Hinweis zeigen", value: "ok", cls: "pill-lavender", icon: "i-bulb" }]
    });
    if (ok !== "ok") return;
    const h = L.useHint(game);
    fullRender();
    if (!h) return;
    await View.modal({ title: `Hinweis ${game.hintsUsed}/${C.HINTS_PER_LEVEL}`, body: `<p>${View.esc(h.text)}</p>`, actions: [{ label: "Danke", value: "ok", cls: "pill-mint" }] });
  }

  /** Bestätigung im In-Game-Dialog. Liefert Promise<boolean>. */
  async function confirmLeave() {
    if (!game || game.moves === 0 || game.ended) return true;
    const choice = await View.modal({
      title: "Level verlassen?",
      body: `<p>Dein Fortschritt in diesem Level geht verloren.</p><div class="stats"><span>${game.moves} ${game.moves === 1 ? "Zug" : "Züge"}</span></div>`,
      actions: [{ label: "Abbrechen", value: "cancel", cls: "pill-cream" }, { label: "Verlassen", value: "ok", cls: "pill-peach", icon: "i-home" }]
    });
    return choice === "ok";
  }

  async function goToMenu() {
    if (busy || View.modalOpen) return;
    if (!(await confirmLeave())) return;
    stopTutorial();
    Particles.clear();
    renderStart();
    await showScreen("start");
  }

  async function copyText(text, textarea) {
    try {
      if (navigator.clipboard && root.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (_) { /* Fallback unten */ }
    try { textarea.focus(); textarea.select(); return document.execCommand("copy"); } catch (_) { return false; }
  }

  /** Teilen-Dialog: „Wortgarten Level X · Y Punkte · Z Züge“ anzeigen und kopieren. */
  async function shareText(text) {
    const body = document.createElement("div");
    body.innerHTML = `<p>Ohne Spoiler – nur Level, Punkte und Züge.</p><textarea rows="2" readonly></textarea><div class="status"></div>`;
    const ta = body.querySelector("textarea");
    const status = body.querySelector(".status");
    ta.value = text;
    const tryCopy = async () => {
      const ok = await copyText(text, ta);
      status.textContent = ok ? "In die Zwischenablage kopiert ✓" : "Bitte Text markieren und manuell kopieren.";
    };
    const done = View.modal({
      title: "Teilen", body,
      actions: [{ label: "Kopieren", value: "copy", cls: "pill-lavender", icon: "i-share", keepOpen: true, onClick: tryCopy }, { label: "Fertig", value: "ok", cls: "pill-mint" }]
    });
    tryCopy();
    return done;
  }

  /** „So geht's“ mit den neuen Regeln (Werte live aus config.js). */
  function showHowTo() {
    if (View.modalOpen) return;
    const pct = Math.round(C.HINT_PENALTY * 100);
    View.modal({
      title: "So geht's",
      body: `
        <ul class="howto">
          <li><b>Zielwort:</b> Jedes Level versteckt ein Wort – du siehst nur Hinweis und Länge. Bilde es waagerecht oder senkrecht am Stück.</li>
          <li><b>Schieben:</b> Wische eine Zeile oder Spalte (oder tippe die Pfeile) – sie rückt um ein Feld, was rausfällt, kommt gegenüber wieder rein.</li>
          <li><b>Kurze Wörter (${C.SHORT_MIN}–${C.SHORT_MAX}):</b> zerbröseln, geben keine Punkte; von oben fällt Neues nach. Das kann Kaskaden auslösen.</li>
          <li><b>Zielbuchstaben geschützt:</b> Die hellen, lila unterstrichenen Kacheln gehören zum Zielwort (bei Doppelbuchstaben nur so viele, wie das Wort braucht). Sie zerbröseln nie und bleiben stehen, wenn darunter etwas wegfällt. Schieben bewegt sie ganz normal.</li>
          <li><b>Punkte:</b> Länge × ${C.POINTS_PER_LETTER} × Kaskade. ${C.HINTS_PER_LEVEL} Hinweise pro Level, je −${pct} %.</li>
        </ul>`,
      actions: [{ label: "Tutorial wiederholen", value: "tutorial", cls: "pill-cream", icon: "i-bulb" }, { label: "Los geht's", value: "ok", cls: "pill-mint" }]
    }).then((v) => { if (v === "tutorial") replayTutorial(); });
  }

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
  Coach.init();
  View.onRender = () => Coach.refresh();
  /** Knopf-Aktion mit Tutorial-Prüfung; bei einem tap-Schritt gilt er nach der Aktion als erledigt. */
  const tapped = (what, fn) => async () => {
    if (!gate({ type: "tap", what }, btn[what])) return;
    await fn();
    if (Coach.active) Coach.satisfy({ type: "tap", what });
  };
  Input.bind({
    onSlide: handleSlide,
    onUndo: tapped("undo", () => {
      if (!game || busy || View.modalOpen || screen !== "game") return;
      if (L.undo(game)) { Particles.clear(); fullRender(); }
    }),
    onReset: tapped("reset", () => { if (!game || busy || View.modalOpen) return; Particles.clear(); L.reset(game); fullRender(); View.introBoard(); }),
    onShare: tapped("share", () => { if (game && !busy && !View.modalOpen) return shareText(L.buildShareText(game)); }),
    onHint: tapped("hint", showHint),
    onToggleMute: toggleMute,
    onSelect: (r, c) => { if (!game) return; View.selection = { r, c }; View.renderBoard(game.grid, game); },
    isBusy: () => busy || View.modalOpen || screen !== "game" || !game
  });
  btn.menu.addEventListener("click", goToMenu);
  btn.howto.addEventListener("click", showHowTo);
  startEl.level.addEventListener("click", () => {
    if (View.modalOpen) return;
    startLevel(stats.progress.unlocked > L.LEVELS.length ? 1 : currentLevelId());
  });
  startEl.daily.addEventListener("click", () => { if (!View.modalOpen) startDaily(); });
  startEl.free.addEventListener("click", () => { if (!View.modalOpen) startFree(); });
  startEl.howto.addEventListener("click", showHowTo);
  startEl.tutorial.addEventListener("click", () => { if (!View.modalOpen) replayTutorial(); });
  startEl.share.addEventListener("click", () => {
    const res = Stats.dailyResult(stats, L.formatDateKey(new Date()));
    if (res && !View.modalOpen) shareText(res.shareText);
  });
  $("start-mute").addEventListener("click", toggleMute);

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
    get session() { return session; },
    Coach,
    handleSlide, startLevel, startDaily, startFree, goToMenu, nextLevel, showHint, replayTutorial
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
