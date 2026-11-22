/*
 * Wortgarten – SOUND (optional)
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
    /** Modifikator gepflanzt: Stein dumpf, Brunnen „blubb“, Trieb hell. */
    plant(type) {
      if (type === "stein") { this.tone(180, 0.12, "triangle", 0.16); this.tone(120, 0.1, "sine", 0.1, 0.03); }
      else if (type === "brunnen") { this.tone(520, 0.08, "sine", 0.12); this.tone(780, 0.1, "sine", 0.1, 0.06); }
      else { this.tone(880, 0.08, "triangle", 0.1); this.tone(1320, 0.12, "sine", 0.08, 0.07); }
    },
    /** Vorschau-Aufblitzen: leises Doppel-Ping. */
    previewPing() { this.tone(1046, 0.06, "sine", 0.07); this.tone(1318, 0.07, "sine", 0.06, 0.11); },
    /** Zielwort gelöst: aufsteigender Dur-Akkord. */
    bloom(length = 5) {
      const base = 392;
      [1, 1.25, 1.5, 2].forEach((m, k) => this.tone(base * m, 0.35, "triangle", 0.12, k * 0.09));
      this.tone(base * 2.5, 0.5, "sine", 0.06, 0.4 + length * 0.01);
    },

    /** Ton pro Wortlänge: 3 = Grundton, 4 = große Terz, 5 = Quinte, 6 = Oktave; +2 Halbtöne pro Kaskadenstufe. */
    word(length, level) {
      const semis = { 3: 0, 4: 4, 5: 7, 6: 12 }[Math.min(length, 6)] + (level - 1) * 2;
      const f = 523.25 * Math.pow(2, semis / 12);
      this.tone(f, 0.22, "triangle", 0.16);
      this.tone(f * 1.5, 0.18, "sine", 0.06, 0.05);
    },

    /**
     * Rieselgeräusch (Sand/Zucker), synchron zum Auflösen von oben nach unten.
     * Granular: pro Kachel viele winzige Rausch-Körner (4–22 ms) mit zufälligem Timing,
     * Tonhöhe (playbackRate) und Filterfrequenz über einen Bandpass; dazu ein leiser
     * Rausch-Teppich. Hüllkurve folgt der Auflösedauer, Kacheln überlappen leicht.
     * @param starts   Startzeiten der Kacheln in s (relativ zu jetzt)
     * @param duration Auflösedauer pro Kachel in s
     * @param density  Partikeldichte (1 = ~300 Körner pro Kachel); mehr Körner -> dichteres Rieseln
     */
    trickle(starts, duration = 0.55, density = 1) {
      const ctx = this.ensure();
      if (!ctx || !starts || !starts.length) return;
      try {
        if (!this._noise || this._noise.sampleRate !== ctx.sampleRate) {
          const len = Math.floor(ctx.sampleRate * 1.0);
          this._noise = ctx.createBuffer(1, len, ctx.sampleRate);
          const d = this._noise.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        const now = ctx.currentTime + 0.01;
        // gemeinsame Kette: Hochpass (nimmt Rumpeln) -> Master-Lautstärke
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = 1400; hp.Q.value = 0.7;
        const master = ctx.createGain();
        master.gain.value = Math.min(0.5, 0.22 + 0.4 / starts.length); // moderat, auch bei vielen Kacheln
        hp.connect(master).connect(ctx.destination);
        const bufDur = this._noise.duration;
        const env = (x) => Math.sin(Math.PI * Math.min(1, Math.max(0, x))); // 0 -> 1 -> 0

        for (const s0 of starts) {
          const t0 = now + s0, d = duration * 1.1; // leicht überlappend
          // 1) leiser Rausch-Teppich mit Hüllkurve über die Auflösedauer
          const bed = ctx.createBufferSource();
          bed.buffer = this._noise;
          const bedBp = ctx.createBiquadFilter();
          bedBp.type = "bandpass"; bedBp.Q.value = 0.8;
          bedBp.frequency.setValueAtTime(5200, t0);
          bedBp.frequency.linearRampToValueAtTime(3200, t0 + d); // wird zum Ende hin etwas dunkler
          const bedGain = ctx.createGain();
          bedGain.gain.setValueAtTime(0.0001, t0);
          bedGain.gain.linearRampToValueAtTime(0.045 + 0.012 * Math.min(3, density || 1), t0 + d * 0.3);
          bedGain.gain.linearRampToValueAtTime(0.0001, t0 + d);
          bed.connect(bedBp).connect(bedGain).connect(hp);
          bed.start(t0, Math.random() * (bufDur - d - 0.05));
          bed.stop(t0 + d + 0.02);

          // 2) Körner: dichter in der Mitte der Auflösung
          // Kornzahl wächst mit der Partikeldichte; gesamt gedeckelt (Knotenzahl auf iOS)
          const dens = Math.max(1, Math.min(3.5, density || 1));
          const count = Math.min(Math.round(34 * dens), Math.floor(420 / starts.length));
          const quiet = 1 / Math.sqrt(dens);   // dichter, aber nicht lauter
          for (let k = 0; k < count; k++) {
            const x = Math.random();
            if (Math.random() > 0.35 + 0.65 * env(x)) continue;
            const gt = t0 + x * d;
            const gd = 0.003 + Math.random() * 0.016;
            const src = ctx.createBufferSource();
            src.buffer = this._noise;
            src.playbackRate.value = 0.6 + Math.random() * 1.2;   // Tonhöhe variieren
            const bp = ctx.createBiquadFilter();
            bp.type = "bandpass";
            bp.frequency.value = crackle ? 6500 + Math.random() * 4000 : 2400 + Math.random() * 5200;
            bp.Q.value = crackle ? 6 + Math.random() * 6 : 1.5 + Math.random() * 4;
            const g = ctx.createGain();
            const crackle = Math.random() < 0.3;   // feines Knistern: kürzer, höher
            const peak = (0.12 + Math.random() * 0.3) * (0.4 + 0.6 * env(x)) * quiet * (crackle ? 0.8 : 1);
            g.gain.setValueAtTime(0.0001, gt);
            g.gain.exponentialRampToValueAtTime(peak, gt + 0.0015); // knackiger Einsatz
            const len = crackle ? Math.min(gd, 0.004) : gd;
            g.gain.exponentialRampToValueAtTime(0.0001, gt + len);
            src.connect(bp).connect(g).connect(hp);
            src.start(gt, Math.random() * (bufDur - 0.05));
            src.stop(gt + len + 0.01);
          }
        }
      } catch (_) { /* Sound ist optional */ }
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
