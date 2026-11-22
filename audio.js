// Procedural sound for RoadHunter (Web Audio, no files): wind, birds, river, engine, gravel, footsteps, rifle + echo, elk bugle.
// Phones only allow audio after a tap, so call audio.start() from a click/tap handler.
let ctx = null, master, noiseBuf;
const n = {};
function noise(seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; } // white + brown mix
  return b;
}
function loopNoise(filterType, freq, q = 0.7) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f).connect(g).connect(master); src.start(); return { src, f, g };
}
const set = (param, v, t = 0.25) => param.setTargetAtTime(v, ctx.currentTime, t);

export const audio = {
  on: true,
  start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    noiseBuf = noise(3);
    n.wind = loopNoise('bandpass', 420, 0.5); n.windHi = loopNoise('highpass', 2600, 0.3);
    n.river = loopNoise('lowpass', 900, 0.5);
    n.gravel = loopNoise('bandpass', 1800, 0.6);
    // engine: two detuned saws through a lowpass
    const eg = ctx.createGain(); eg.gain.value = 0; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 2;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square'; o1.frequency.value = 40; o2.frequency.value = 20.3;
    const g2 = ctx.createGain(); g2.gain.value = 0.5; o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(eg).connect(master); o1.start(); o2.start();
    n.engine = { o1, o2, lp, g: eg };
    // shared echo bus for gunshots (valley walls)
    const d1 = ctx.createDelay(4), d2 = ctx.createDelay(4), e1 = ctx.createGain(), e2 = ctx.createGain(), ef = ctx.createBiquadFilter();
    d1.delayTime.value = 0.9; d2.delayTime.value = 2.1; e1.gain.value = 0.32; e2.gain.value = 0.18; ef.type = 'lowpass'; ef.frequency.value = 1400;
    n.echoIn = ctx.createGain(); n.echoIn.connect(ef); ef.connect(d1).connect(e1).connect(master); ef.connect(d2).connect(e2).connect(master);
    n.birdT = 2; n.stepPhase = 0;
  },
  toggle() { this.on = !this.on; if (master) set(master.gain, this.on ? 0.8 : 0, 0.05); return this.on; },
  // called every frame with the game state
  update(dt, s) {
    if (!ctx) return;
    const alt = Math.max(0, s.altitude), windy = 0.05 + Math.min(0.22, alt / 4000) + (s.inVehicle ? Math.min(0.18, s.speed / 160) : 0);
    set(n.wind.g.gain, windy); set(n.wind.f.frequency, 300 + windy * 900 + Math.sin(ctx.currentTime * 0.3) * 120, 1);
    set(n.windHi.g.gain, windy * 0.25);
    set(n.river.g.gain, Math.max(0, 1 - s.waterDist / 120) * 0.25);
    if (s.inVehicle) {
      const sp = Math.abs(s.speed), rpm = 0.25 + (sp % 11) / 11 * 0.6 + Math.min(0.4, sp / 60) + s.throttle * 0.15;
      set(n.engine.o1.frequency, 35 + rpm * 90, 0.08); set(n.engine.o2.frequency, 17.5 + rpm * 45, 0.08);
      set(n.engine.lp.frequency, 300 + rpm * 900 + s.throttle * 500, 0.1); set(n.engine.g.gain, 0.06 + s.throttle * 0.05 + Math.min(0.05, sp / 300), 0.1);
      set(n.gravel.g.gain, s.onRoadPaved ? sp / 600 : Math.min(0.22, sp / 90), 0.1); set(n.gravel.f.frequency, s.onRoadPaved ? 700 : 1800);
    } else { set(n.engine.g.gain, s.engineIdle ? 0.02 : 0, 0.3); set(n.gravel.g.gain, 0, 0.2); }
    // footsteps
    if (!s.inVehicle && s.footSpeed > 0.2) {
      n.stepPhase += dt * (s.footSpeed > 4.5 ? 3.2 : s.footSpeed > 2.2 ? 2.6 : 1.8) * (s.crouch ? 0.7 : 1);
      if (n.stepPhase > 1) { n.stepPhase -= 1; this.step(s.crouch ? 0.25 : s.footSpeed > 4.5 ? 0.9 : 0.55); }
    }
    // birds near trees / low ground, mornings
    n.birdT -= dt;
    if (n.birdT < 0) { n.birdT = 1.5 + Math.random() * 6; if (s.birdChance > Math.random()) this.bird(); }
  },
  step(vol = 0.5) {
    if (!ctx || !this.on) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 500; f.Q.value = 1.2;
    const g = ctx.createGain(), t = ctx.currentTime; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18 * vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 2, 0.15);
  },
  bird() {
    const t = ctx.currentTime, notes = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = t + i * (0.09 + Math.random() * 0.05);
      o.type = 'sine'; o.frequency.setValueAtTime(base * (1 + Math.random() * 0.3), t0); o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.6), t0 + 0.07);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.025, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.08);
      o.connect(g).connect(master); o.start(t0); o.stop(t0 + 0.1);
    }
  },
  shot() {
    if (!ctx) return; const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(6000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(1.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(f).connect(g); g.connect(master); g.connect(n.echoIn); src.start(t, 0, 0.7);
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    og.gain.setValueAtTime(0.9, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(og).connect(master); o.start(t); o.stop(t + 0.35);
  },
  // elk bugle: low grunt rising to a high whistle, then grunts. dist in meters (quieter + duller when far)
  bugle(dist = 600) {
    if (!ctx || !this.on) return; const t = ctx.currentTime + 0.1, vol = Math.max(0.02, 0.22 * (1 - dist / 2000));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000 - Math.min(4000, dist * 2); lp.connect(master);
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'sine'; vib.frequency.value = 6; vg.gain.value = 18; vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    const f = (p, a) => { p.setValueAtTime(a[0], t); p.exponentialRampToValueAtTime(a[1], t + 0.5); p.linearRampToValueAtTime(a[2], t + 1.6); p.exponentialRampToValueAtTime(a[3], t + 2.1); };
    f(o.frequency, [180, 700, 1500, 300]); f(o2.frequency, [360, 1400, 2900, 600]);
    const og = ctx.createGain(); og.gain.value = 0.25; o.connect(og).connect(g); o2.connect(g); g.connect(lp);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.5, t + 0.2); g.gain.linearRampToValueAtTime(vol, t + 0.7); g.gain.linearRampToValueAtTime(vol * 0.9, t + 1.6); g.gain.exponentialRampToValueAtTime(0.0005, t + 2.2);
    [o, o2, vib].forEach((x) => { x.start(t); x.stop(t + 2.3); });
    for (let i = 0; i < 3; i++) { // chuckles
      const c = ctx.createOscillator(), cg = ctx.createGain(), t0 = t + 2.35 + i * 0.28; c.type = 'sawtooth'; c.frequency.value = 160; cg.gain.setValueAtTime(0, t0);
      cg.gain.linearRampToValueAtTime(vol * 0.4, t0 + 0.03); cg.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.18); c.connect(cg).connect(lp); c.start(t0); c.stop(t0 + 0.2);
    }
  },
  // simple tones: phone ring, tin pop, ability whoosh, mission chime
  tone(freqs, dur = 0.12, gap = 0.02, type = 'sine', vol = 0.12) {
    if (!ctx || !this.on) return; let t = ctx.currentTime;
    for (const f of freqs) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + dur); o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02); t += dur + gap; }
  },
  ring() { for (let i = 0; i < 3; i++) setTimeout(() => this.tone([1320, 1660, 1320, 1660, 1320, 1660], 0.05, 0.005, 'square', 0.06), i * 700); },
  pop() { this.tone([880, 1320], 0.06, 0.01, 'triangle', 0.15); },
  power() { this.tone([330, 495, 660, 990], 0.07, 0, 'triangle', 0.1); },
  chime() { this.tone([660, 830, 990, 1320], 0.14, 0.03, 'sine', 0.12); },
  fail() { this.tone([400, 300, 220], 0.18, 0.03, 'triangle', 0.12); },
  thwack(dist = 200) { // bullet hitting the animal, heard a moment later
    if (!ctx || !this.on) return; const t = ctx.currentTime, v = Math.max(0.08, 0.5 * (1 - dist / 900));
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(f).connect(g).connect(master); src.start(t, 0.5, 0.18);
    const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); og.gain.setValueAtTime(v * 0.8, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14); o.connect(og).connect(master); o.start(t); o.stop(t + 0.16);
  },
  coyotes() { // a few rising yips and a howl, far off
    if (!ctx || !this.on) return; const t0 = ctx.currentTime + 0.1, lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.connect(master);
    for (let i = 0; i < 9; i++) { const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + i * 0.22 + Math.random() * 0.1, f = 700 + Math.random() * 500; o.type = 'triangle';
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.08); o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.16);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18); o.connect(g).connect(lp); o.start(t); o.stop(t + 0.2); }
    const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + 2.2; o.type = 'sine'; o.frequency.setValueAtTime(500, t); o.frequency.exponentialRampToValueAtTime(950, t + 0.6); o.frequency.linearRampToValueAtTime(900, t + 1.6); o.frequency.exponentialRampToValueAtTime(520, t + 2.2);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0005, t + 2.3); o.connect(g).connect(lp); o.start(t); o.stop(t + 2.4);
  },
  door() {
    if (!ctx) return; const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(f).connect(g).connect(master); src.start(t, 1, 0.25);
  },
};
