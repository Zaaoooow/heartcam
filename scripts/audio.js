/* ============================================================
   audio.js — synthesized shutter / focus / preflash sounds.
   No audio files needed; everything is a tiny WebAudio patch.
   ============================================================ */

let ctx = null;
export let muted = false;

export function setMuted(m) { muted = m; }

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(a, seconds, gainFn) {
  const len = Math.floor(a.sampleRate * seconds);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * gainFn(i / len);
  return buf;
}

/** soft mechanical shutter: two clicks + a tiny motor whir */
export function playShutter() {
  if (muted) return;
  const a = ac();
  const t = a.currentTime;

  // click 1 (curtain open)
  for (const [delay, freq, dur, vol] of [[0, 2600, 0.05, 0.35], [0.055, 1500, 0.07, 0.5]]) {
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t + delay);
    g.gain.exponentialRampToValueAtTime(0.0006, t + delay + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t + delay);
    osc.stop(t + delay + dur + 0.03);
  }
  // motor whir
  const nb = noiseBuffer(a, 0.16, (k) => (1 - k) * 0.5);
  const src = a.createBufferSource();
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 1.4;
  const ng = a.createGain();
  ng.gain.value = 0.14;
  src.buffer = nb;
  src.connect(bp).connect(ng).connect(a.destination);
  src.start(t + 0.02);
}

/** beep before a self-timer shot (3 counts) */
export function playTimerTick(final = false) {
  if (muted) return;
  const a = ac();
  const t = a.currentTime;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = 'sine';
  osc.frequency.value = final ? 1560 : 880;
  g.gain.setValueAtTime(final ? 0.28 : 0.18, t);
  g.gain.exponentialRampToValueAtTime(0.0006, t + (final ? 0.34 : 0.16));
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + (final ? 0.4 : 0.2));
}

/** soft *pop* when photo lands in album */
export function playSaved() {
  if (muted) return;
  const a = ac();
  const t = a.currentTime;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(660, t);
  osc.frequency.exponentialRampToValueAtTime(1580, t + 0.16);
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.0006, t + 0.22);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + 0.25);
}
