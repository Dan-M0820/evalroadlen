import type { Sim } from './sim';

const pause = () => new Promise<void>(r => setTimeout(r, 0));

export interface SuggestionCandidate {
  t: string;
  ap: () => void;
  un: () => void;
}

export interface MeasureResult {
  speed: number | null;
  stopped: number | null;
  flow: number;
  loss: number;
  trips: number;
  delay: number | null;
}

export const Analyze = {
  base: null as number | null,
  last: null as SuggestionCandidate | null,

  async bench(sim: Sim, steps: number): Promise<{ d: number | null; n: number }> {
    sim.rebuild();
    sim.seed(7);
    sim.prefill();
    for (let i = 0; i < steps; i++) {
      sim.step(0.1);
      if (i === 600) {
        sim.done = 0;
        sim.dsum = 0;
      }
      if (i % 300 === 299) await pause();
    }
    return { d: sim.done >= 5 ? sim.dsum / sim.done : null, n: sim.done };
  },

  candidates(sim: Sim): SuggestionCandidate[] {
    const st = sim.store;
    const C: SuggestionCandidate[] = [];
    const jr = sim.worstRoads(2).filter(x => x.jam > 10);
    const jn = Object.entries(sim.jamN)
      .filter(([id]) => sim.net.nodes[+id] && sim.net.nodes[+id].deg >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .filter(x => x[1] > 10);
    for (const { road: r } of jr) {
      if (r.lanes < 4) {
        C.push({ t: `Add a lane each way on ${r.name}`, ap: () => r.lanes++, un: () => r.lanes-- });
      }
    }
    for (const [id] of jn) {
      const k = sim.net.nodes[+id].key;
      const old = st.junctions[k];
      if (!old || old.ctrl !== 'signal') {
        C.push({
          t: 'Put a traffic light at the busiest junction',
          ap: () => {
            st.junctions[k] = { ctrl: 'signal', gA: 20, gB: 20 };
          },
          un: () => {
            if (old) st.junctions[k] = old;
            else delete st.junctions[k];
          },
        });
      }
    }
    return C;
  },

  async suggest(sim: Sim, say: (t: string, hasApply?: boolean) => void, after = () => {}) {
    if (sim.busy) return;
    const C = this.candidates(sim);
    if (!C.length) {
      say('No clear jam yet. Raise the traffic, let it run for a while, then try again.');
      return;
    }
    const T0 = sim.T;
    sim.busy = true;
    say(`Testing ${C.length} option(s) on the same traffic…`);
    await pause();
    const b = await this.bench(sim, 5400);
    const res: { c: SuggestionCandidate; d: number | null }[] = [];
    for (const c of C) {
      c.ap();
      res.push({ c, d: (await this.bench(sim, 5400)).d });
      c.un();
    }
    sim.T = T0;
    sim.seed(Date.now() & 0xffff);
    sim.busy = false;
    after();
    const ok = res.filter((x): x is { c: SuggestionCandidate; d: number } => x.d != null).sort((x, y) => x.d - y.d)[0];
    if (b.d == null || !ok) {
      say('Not enough finished trips to compare. Run longer or raise the traffic.');
      return;
    }
    const gain = (b.d - ok.d) / Math.max(b.d, 1);
    if (gain < 0.05) {
      say(`None of the options helped enough (delay now about ${Math.round(b.d)} s per trip).`);
      return;
    }
    this.last = ok.c;
    say(
      `${ok.c.t} — Average delay ${Math.round(b.d)} s → ${Math.round(ok.d)} s (${Math.round(gain * 100)}% less). Simulation result, not an engineering approval.`,
      true
    );
  },

  occupancy(sim: Sim, ids: number[], since: number): number {
    let v = 0;
    for (const id of ids) {
      const m = sim.mt[id];
      if (m) v += m[0];
    }
    return v / Math.max(1, sim.T - since);
  },

  async calibrate(sim: Sim, ids: number[], target: number, rounds = 3): Promise<number> {
    for (let it = 0; it < rounds; it++) {
      sim.rebuild();
      sim.seed(11);
      sim.prefill();
      for (let i = 0; i < 1500; i++) {
        sim.step(0.1);
        if (i === 300) {
          sim.mt = {};
          sim.t0 = sim.T;
        }
        if (i % 300 === 299) await pause();
      }
      const occ = this.occupancy(sim, ids, sim.t0);
      const k = occ > 0 ? target / occ : 2;
      sim.scale = Math.max(0.03, Math.min(4, sim.scale * k));
      if (Math.abs(k - 1) < 0.12) break;
    }
    return sim.scale;
  },

  async measure(sim: Sim, ids: number[], steps = 6000): Promise<MeasureResult> {
    const T0 = sim.T;
    sim.busy = true;
    sim.rebuild();
    sim.seed(7);
    sim.prefill();
    for (let i = 0; i < steps; i++) {
      sim.step(0.1);
      if (i === 600) {
        sim.mt = {};
        sim.pass = {};
        sim.done = 0;
        sim.dsum = 0;
      }
      if (i % 300 === 299) await pause();
    }
    const hours = ((steps - 600) * 0.1) / 3600;
    let vt = 0;
    let vs = 0;
    let jam = 0;
    let loss = 0;
    let pass = 0;
    for (const id of ids) {
      const m = sim.mt[id];
      if (m) {
        vt += m[0];
        vs += m[1];
        jam += m[2];
        loss += m[3];
      }
      pass += sim.pass[id] || 0;
    }
    const res: MeasureResult = {
      speed: vt ? (vs / vt) * 3.6 : null,
      stopped: vt ? (jam / vt) * 100 : null,
      flow: pass / hours,
      loss: loss / 60,
      trips: sim.done,
      delay: sim.done >= 5 ? sim.dsum / sim.done : null,
    };
    sim.T = T0;
    sim.seed(Date.now() & 0xffff);
    sim.busy = false;
    return res;
  },
};
