/*
 * Letter Slide – SOUND (optional)
 * ===============================
 * Simpler WebAudio-Klick beim Slide und ein Ton pro Wortlänge (höher bei längeren
 * Wörtern und höheren Kaskadenstufen). Keine Audiodateien.
 *
 * iOS/Safari: Ein AudioContext darf erst nach einer Nutzergeste starten.
 * installUnlock() hängt sich an die erste Berührung/den ersten Klick und spielt
 * dort einen stillen Puffer ab, danach funktionieren alle späteren Töne.
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "letterSlideMuted";

  const Sound = {
    enabled: true,
    ctx: null,
    unlocked: false,

    /** AudioContext anlegen bzw. fortsetzen (nur innerhalb/nach einer Nutzergeste sinnvoll). */
    ensure() {
      if (!this.enabled) return null;
      try {
        if (!this.ctx) {
          const Ctx = root.AudioContext || root.webkitAudioContext;
          if (!Ctx) return null;
          this.ctx = new Ctx();
        }
        if (this.ctx.state === "suspended") this.ctx.resume();
      } catch (e) {
        this.ctx = null;
      }
      return this.ctx;
    },

    /** iOS-Unlock: stiller 1-Sample-Puffer innerhalb der ersten Geste. */
    unlock() {
      if (this.unlocked) return;
      const ctx = this.ensure();
      if (!ctx) return;
      try {
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
        this.unlocked = true;
      } catch (e) { /* ignorieren */ }
    },

    /** Unlock an die ersten Gesten hängen (touchend ist auf iOS die zuverlässigste). */
    installUnlock(doc) {
      const handler = () => {
        this.unlock();
        if (this.unlocked) for (const ev of ["touchend", "pointerdown", "keydown", "click"]) doc.removeEventListener(ev, handler, true);
      };
      for (const ev of ["touchend", "pointerdown", "keydown", "click"]) doc.addEventListener(ev, handler, { capture: true, passive: true });
    },

    tone(freq, dur, type = "sine", vol = 0.15, delay = 0) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    click() { this.tone(1400, 0.035, "square", 0.05); },

    /** Ton pro Wortlänge: 3 = Grundton, 4 = große Terz, 5 = Quinte, 6 = Oktave; +2 Halbtöne pro Kaskadenstufe. */
    word(length, level) {
      const semis = { 3: 0, 4: 4, 5: 7, 6: 12 }[Math.min(length, 6)] + (level - 1) * 2;
      const f = 523.25 * Math.pow(2, semis / 12);
      this.tone(f, 0.22, "triangle", 0.16);
      this.tone(f * 1.5, 0.18, "sine", 0.06, 0.05);
    },

    setEnabled(on) {
      this.enabled = on;
      try { root.localStorage.setItem(STORAGE_KEY, on ? "0" : "1"); } catch (_) { /* privat/file:// */ }
    },

    loadPreference() {
      try { this.enabled = root.localStorage.getItem(STORAGE_KEY) !== "1"; } catch (_) { /* egal */ }
      return this.enabled;
    }
  };

  root.LetterSlideAudio = Sound;
})(typeof globalThis !== "undefined" ? globalThis : this);
