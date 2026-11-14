// 极简 WebAudio 合成音效（无素材依赖）
export class Sfx {
  constructor() {
    this.ctx = null;
    this.volume = parseInt(localStorage.getItem('sdc_volume') || '70', 10) / 100;
  }

  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      } catch (e) { /* 忽略 */ }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    localStorage.setItem('sdc_volume', String(Math.round(v * 100)));
    if (this.master) this.master.gain.value = v;
  }

  noiseBurst(dur, freq, gain, decay) {
    const ctx = this.ensure();
    if (!ctx) return;
    const n = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay || 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.master || ctx.destination);
    src.start();
  }

  tone(freq, dur, gain, type = 'sine', slide = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, ctx.currentTime + dur);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(this.master || ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  shot(weapon, near) {
    const v = near ? 0.24 : 0.07;
    if (weapon === 'lr') { this.noiseBurst(0.35, 900, v * 1.4, 3); this.tone(90, 0.22, v * 0.5, 'sawtooth', -40); }
    else if (weapon === 'ak') { this.noiseBurst(0.16, 1400, v, 3); this.tone(120, 0.1, v * 0.4, 'square', -50); }
    else if (weapon === 'smg') { this.noiseBurst(0.09, 1900, v * 0.8, 3); this.tone(160, 0.06, v * 0.3, 'square', -60); }
    else if (weapon === 'p92') { this.noiseBurst(0.12, 1600, v * 0.8, 3); }
    else { this.noiseBurst(0.08, 1200, v * 0.5, 3); }
  }

  hit() { this.tone(1150, 0.06, 0.16, 'square'); }
  headshot() { this.tone(1500, 0.08, 0.18, 'square'); this.tone(2200, 0.05, 0.1, 'sine'); }
  kill() { this.tone(500, 0.12, 0.18, 'triangle'); this.tone(750, 0.18, 0.16, 'triangle'); }
  hurt() { this.noiseBurst(0.18, 500, 0.3, 2); this.tone(110, 0.15, 0.2, 'sawtooth', -30); }
  reload() { this.tone(700, 0.05, 0.12, 'square'); setTimeout(() => this.tone(500, 0.05, 0.1, 'square'), 130); }
  pickup() { this.tone(880, 0.07, 0.1, 'sine'); this.tone(1320, 0.09, 0.08, 'sine'); }
  heal() { this.tone(520, 0.15, 0.12, 'sine'); this.tone(650, 0.15, 0.1, 'sine'); }
  extract() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 0.16, 'triangle'), i * 130)); }
  death() { this.tone(220, 0.5, 0.2, 'sawtooth', -80); this.noiseBurst(0.4, 300, 0.25, 2); }
  wind() { this.noiseBurst(1.2, 400, 0.08, 1); }
  click() { this.tone(900, 0.03, 0.08, 'square'); }
}

export const sfx = new Sfx();
