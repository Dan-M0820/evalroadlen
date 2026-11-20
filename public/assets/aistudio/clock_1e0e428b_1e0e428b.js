import { DAY_TYPES } from '../config.js';
// Time of day and hourly demand. Demand and day type live in the store so they are saved with the project.
export class Clock {
  constructor(store) { this.store = store; this.start = 6 * 3600; }
  now(T) { return (((this.start + T) % 86400) + 86400) % 86400; }
  hour(T) { return this.now(T) / 3600; }
  mult(T) {
    const d = this.store.demand, h = this.hour(T), i = Math.floor(h) % 24, f = h - Math.floor(h);
    return (d[i] * (1 - f) + d[(i + 1) % 24] * f) * DAY_TYPES[this.store.day].m;
  }
  fmt(T) { const s = this.now(T); return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0'); }
  static parse(t) { const [h, m] = (t || '0:0').split(':'); return (+h * 60 + (+m || 0)) * 60; }
}
