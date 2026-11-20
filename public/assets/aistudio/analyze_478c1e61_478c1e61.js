// "Test a change": finds the worst jams, tries fixes on identical (seeded) demand, reports which helps most.
const pause = () => new Promise(r => setTimeout(r, 0));

export const Analyze = {
  base: null, last: null,

  // Runs the same traffic for `steps` tenth-seconds and returns mean delay per finished trip.
  async bench(sim, steps) {
    sim.rebuild(); sim.seed(7); sim.prefill();
    for (let i = 0; i < steps; i++) {
      sim.step(.1);
      if (i === 600) { sim.done = 0; sim.dsum = 0; }
      if (i % 300 === 299) await pause();
    }
    return { d: sim.done >= 5 ? sim.dsum / sim.done : null, n: sim.done };
  },

  candidates(sim) {
    const st = sim.store, C = [];
    const jr = sim.worstRoads(2).filter(x => x.jam > 10);
    const jn = Object.entries(sim.jamN).filter(([id]) => sim.net.nodes[id] && sim.net.nodes[id].deg >= 3).sort((a, b) => b[1] - a[1]).slice(0, 2).filter(x => x[1] > 10);
    for (const { road: r } of jr) if (r.lanes < 4) C.push({ t: `Add a lane each way on ${r.name}`, ap: () => r.lanes++, un: () => r.lanes-- });
    for (const [id] of jn) {
      const k = sim.net.nodes[id].key, old = st.junctions[k];
      if (!old || old.ctrl !== 'signal') C.push({ t: 'Put a traffic light at the busiest junction', ap: () => { st.junctions[k] = { ctrl: 'signal', gA: 20, gB: 20 }; }, un: () => { if (old) st.junctions[k] = old; else delete st.junctions[k]; } });
    }
    return C;
  },

  async suggest(sim, say, after = () => {}) {
    if (sim.busy) return; const C = this.candidates(sim);
    if (!C.length) { say('No clear jam yet. Raise the traffic, let it run for a while, then try again.'); return; }
    const T0 = sim.T; sim.busy = true; say(`Testing ${C.length} option(s) on the same traffic…`); await pause();
    const b = await this.bench(sim, 5400), res = [];
    for (const c of C) { c.ap(); res.push({ c, d: (await this.bench(sim, 5400)).d }); c.un(); }
    sim.T = T0; sim.seed(Date.now() & 0xffff); sim.busy = false; after();
    const ok = res.filter(x => x.d != null).sort((x, y) => x.d - y.d)[0];
    if (b.d == null || !ok) { say('Not enough finished trips to compare. Run longer or raise the traffic.'); return; }
    const gain = (b.d - ok.d) / Math.max(b.d, 1);
    if (gain < .05) { say(`None of the options helped enough (delay now about ${Math.round(b.d)} s per trip).`); return; }
    this.last = ok.c;
    say(`<b>${ok.c.t}</b><br>Average delay ${Math.round(b.d)} s → ${Math.round(ok.d)} s (${Math.round(gain * 100)}% less). Simulation result, not an engineering approval. <button id="bApply">Apply</button>`, true);
  }
,

  // Average number of vehicles on these roads since the stats window began (vehicle-seconds / seconds).
  occupancy(sim, ids, since) { let v = 0; for (const id of ids) { const m = sim.mt[id]; if (m) v += m[0]; } return v / Math.max(1, sim.T - since); },

  // Workbench: tune the traffic scale until these roads carry about as many vehicles as they did on the town map.
  async calibrate(sim, ids, target, rounds = 3) {
    for (let it = 0; it < rounds; it++) {
      sim.rebuild(); sim.seed(11); sim.prefill();
      for (let i = 0; i < 1500; i++) { sim.step(.1); if (i === 300) { sim.mt = {}; sim.t0 = sim.T; } if (i % 300 === 299) await pause(); }
      const occ = this.occupancy(sim, ids, sim.t0), k = occ > 0 ? target / occ : 2;
      sim.scale = Math.max(.03, Math.min(4, sim.scale * k)); if (Math.abs(k - 1) < .12) break;
    }
    return sim.scale;
  },

  // Experiment: run the same seeded traffic for ~10 simulated minutes and measure the chosen roads and the whole town.
  // Run it before and after an edit; because the traffic is identical, differences come from the edit.
  async measure(sim, ids, steps = 6000) {
    const T0 = sim.T; sim.busy = true; sim.rebuild(); sim.seed(7); sim.prefill();
    for (let i = 0; i < steps; i++) {
      sim.step(.1);
      if (i === 600) { sim.mt = {}; sim.pass = {}; sim.done = 0; sim.dsum = 0; } // first minute is warm-up
      if (i % 300 === 299) await pause();
    }
    const hours = (steps - 600) * .1 / 3600; let vt = 0, vs = 0, jam = 0, loss = 0, pass = 0;
    for (const id of ids) { const m = sim.mt[id]; if (m) { vt += m[0]; vs += m[1]; jam += m[2]; loss += m[3]; } pass += sim.pass[id] || 0; }
    const res = { speed: vt ? vs / vt * 3.6 : null, stopped: vt ? jam / vt * 100 : null, flow: pass / hours, loss: loss / 60, trips: sim.done, delay: sim.done >= 5 ? sim.dsum / sim.done : null };
    sim.T = T0; sim.seed(Date.now() & 0xffff); sim.busy = false;
    return res;
  }
};
