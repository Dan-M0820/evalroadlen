import { Clock } from './clock.js';
// Time-based policies: ban a vehicle type from a road, or cap its speed, inside a time window.
export class RuleSet {
  constructor() { this.ban = new Map(); this.cap = new Map(); }
  static inWindow(r, sec) { const a = Clock.parse(r.from), b = Clock.parse(r.to); return a <= b ? (sec >= a && sec < b) : (sec >= a || sec < b); }
  static hit(r, road) { return r.r === 'all' || r.r == road.id || r.r === 'type:' + road.type; }
  refresh(rules, roads, vehicles, sec) {
    this.ban = new Map(); this.cap = new Map();
    for (const r of rules) {
      if (!RuleSet.inWindow(r, sec)) continue;
      for (const road of roads) {
        if (!RuleSet.hit(r, road)) continue;
        if (r.a === 'ban') { for (const y of vehicles) if (r.v === 'all' || r.v === y.k) (this.ban.get(y.k) || this.ban.set(y.k, new Set()).get(y.k)).add(road.id); }
        else this.cap.set(road.id, Math.min(this.cap.get(road.id) || 999, +r.val));
      }
    }
  }
  blocked(road, k) { if (road.banned && road.banned.includes(k)) return true; const s = this.ban.get(k); return !!s && s.has(road.id); }
  sig(k) { const s = this.ban.get(k); return s ? [...s].sort().join(',') : ''; }
}
