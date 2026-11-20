import { DAY_TYPES } from '../config';
import type { DayTypeKey } from '../types';

export interface ClockStoreLike {
  demand: number[];
  day: DayTypeKey;
}

// Time of day and hourly demand. Demand and day type live in the store so they are saved with the project.
export class Clock {
  store: ClockStoreLike;
  start = 6 * 3600;

  constructor(store: ClockStoreLike) {
    this.store = store;
  }

  now(T: number): number {
    return (((this.start + T) % 86400) + 86400) % 86400;
  }

  hour(T: number): number {
    return this.now(T) / 3600;
  }

  mult(T: number): number {
    const d = this.store.demand;
    const h = this.hour(T);
    const i = Math.floor(h) % 24;
    const f = h - Math.floor(h);
    return (d[i] * (1 - f) + d[(i + 1) % 24] * f) * DAY_TYPES[this.store.day].m;
  }

  fmt(T: number): string {
    const s = this.now(T);
    return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0');
  }

  static parse(t: string | undefined): number {
    const [h, m] = (t || '0:0').split(':');
    return (+h * 60 + (+m || 0)) * 60;
  }
}
