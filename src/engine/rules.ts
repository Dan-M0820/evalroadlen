import { Clock } from './clock';
import type { Road, TrafficRule, VehicleType } from '../types';

export interface WindowedItem {
  from?: string;
  to?: string;
}

// Time-based policies: ban a vehicle type from a road, or cap its speed, inside a time window.
export class RuleSet {
  ban = new Map<string, Set<number>>();
  cap = new Map<number, number>();

  static inWindow(r: WindowedItem, sec: number): boolean {
    if (!r.from || !r.to) return true;
    const a = Clock.parse(r.from);
    const b = Clock.parse(r.to);
    return a <= b ? sec >= a && sec < b : sec >= a || sec < b;
  }

  static hit(r: TrafficRule, road: Road): boolean {
    return r.r === 'all' || String(r.r) === String(road.id) || r.r === 'type:' + road.type;
  }

  refresh(rules: TrafficRule[], roads: Road[], vehicles: VehicleType[], sec: number) {
    this.ban = new Map();
    this.cap = new Map();
    for (const r of rules) {
      if (!RuleSet.inWindow(r, sec)) continue;
      for (const road of roads) {
        if (!RuleSet.hit(r, road)) continue;
        if (r.a === 'ban') {
          for (const y of vehicles) {
            if (r.v === 'all' || r.v === y.k) {
              let set = this.ban.get(y.k);
              if (!set) {
                set = new Set();
                this.ban.set(y.k, set);
              }
              set.add(road.id);
            }
          }
        } else {
          this.cap.set(road.id, Math.min(this.cap.get(road.id) || 999, +(r.val ?? 20)));
        }
      }
    }
  }

  blocked(road: Road, k: string): boolean {
    if (road.banned && road.banned.includes(k)) return true;
    const s = this.ban.get(k);
    return !!s && s.has(road.id);
  }

  sig(k: string): string {
    const s = this.ban.get(k);
    return s ? [...s].sort((a, b) => a - b).join(',') : '';
  }
}
