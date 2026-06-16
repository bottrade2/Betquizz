'use strict';

let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'sine', vol = 0.25, delay = 0) {
  try {
    const c = getCtx();
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + delay);
    gain.gain.setValueAtTime(vol, c.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + dur);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + dur);
  } catch {}
}

function isMuted() {
  return localStorage.getItem('sound_enabled') === 'false';
}

export function playCorrect() {
  if (isMuted()) return;
  tone(523, 0.08);           // C5
  tone(659, 0.08, 'sine', 0.25, 0.09);  // E5
  tone(784, 0.18, 'sine', 0.25, 0.18);  // G5
}

export function playWrong() {
  if (isMuted()) return;
  tone(280, 0.12, 'sawtooth', 0.2);
  tone(220, 0.25, 'sawtooth', 0.15, 0.12);
}

export function playTick() {
  if (isMuted()) return;
  tone(1000, 0.04, 'square', 0.08);
}

export function playUrgentTick() {
  if (isMuted()) return;
  tone(1200, 0.06, 'square', 0.12);
}

export function playWin() {
  if (isMuted()) return;
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => tone(f, 0.18, 'sine', 0.22, i * 0.11));
}

export function playLose() {
  if (isMuted()) return;
  const notes = [400, 320, 220];
  notes.forEach((f, i) => tone(f, 0.18, 'sawtooth', 0.18, i * 0.14));
}

export function playDraw() {
  if (isMuted()) return;
  tone(440, 0.2, 'sine', 0.2);
  tone(440, 0.2, 'sine', 0.2, 0.25);
}

export function isSoundEnabled() {
  return localStorage.getItem('sound_enabled') !== 'false';
}

export function setSoundEnabled(val) {
  localStorage.setItem('sound_enabled', val ? 'true' : 'false');
}
