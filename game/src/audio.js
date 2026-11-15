// audio.js — all sound is synthesised with WebAudio; no audio files, no network.
// One AudioContext, lazily created on the first user gesture (pointer lock).
export function createAudio() {
  let ctx = null;
  let master = null;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      return true;
    } catch { return false; }
  }
  function noiseBuffer(dur) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function burst(freq, dur, type, vol, slideTo) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseHit(dur, vol, filterFreq, q = 1) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
  }
  const api = {
    unlock() { ensure(); },
    shot(kind, dist = 0) {
      const att = 1 / (1 + dist * 0.045);
      if (kind === 'sniper') { noiseHit(0.28, 0.9 * att, 2400); burst(160, 0.16, 'square', 0.25 * att, 50); }
      else if (kind === 'shotgun') { noiseHit(0.22, 0.85 * att, 1600); burst(110, 0.14, 'square', 0.22 * att, 45); }
      else if (kind === 'smg') { noiseHit(0.09, 0.5 * att, 3200); burst(210, 0.06, 'square', 0.12 * att, 90); }
      else if (kind === 'pistol') { noiseHit(0.12, 0.6 * att, 2600); burst(190, 0.08, 'square', 0.15 * att, 70); }
      else { noiseHit(0.14, 0.7 * att, 2800); burst(150, 0.09, 'square', 0.18 * att, 60); }
    },
    dry() { burst(1400, 0.03, 'square', 0.12); },
    reload() { burst(700, 0.05, 'square', 0.1); setTimeout(() => burst(500, 0.05, 'square', 0.1), 180); },
    hit(kill) { burst(kill ? 1900 : 1500, 0.06, 'sine', 0.22, kill ? 900 : 1200); },
    hurt() { burst(220, 0.18, 'sawtooth', 0.2, 90); },
    step() { noiseHit(0.05, 0.07, 500); },
    plant() { burst(880, 0.09, 'sine', 0.2); setTimeout(() => burst(880, 0.09, 'sine', 0.2), 140); },
    beep() { burst(1200, 0.07, 'sine', 0.18); },
    explosion() { noiseHit(0.9, 1.0, 700); burst(70, 0.7, 'sine', 0.5, 28); },
    buy() { burst(660, 0.07, 'sine', 0.16); setTimeout(() => burst(990, 0.09, 'sine', 0.16), 90); },
    win() { [523, 659, 784].forEach((f, i) => setTimeout(() => burst(f, 0.16, 'sine', 0.18), i * 130)); },
    lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => burst(f, 0.2, 'sine', 0.16), i * 150)); },
    grenade() { noiseHit(0.4, 0.5, 1200); },
  };
  return api;
}
