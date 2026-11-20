import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/data/store';
import { Sim } from '../src/engine/sim';
import { Network } from '../src/engine/network';
import { Analyze } from '../src/engine/analyze';
import { demoTown } from '../src/data/demo';
import { defaultControl, HOT_KINDS } from '../src/config';
import { Geo } from '../src/engine/geo';

const town = () => {
  const s = new Store();
  s.setDataset(demoTown());
  return s;
};
const ll = (x: number, y: number): [number, number] =>
  Geo.ll(x, y).map(v => Math.round(v * 1e6) / 1e6) as [number, number];
const run = (sim: Sim, secs: number) => {
  for (let i = 0; i < secs * 10; i++) sim.step(0.1);
};

test('hotspot pulls trips toward it while active, and not outside its hours', () => {
  const endsNear = (hotspot: 'on' | 'off' | null, startSec: number) => {
    const s = town();
    if (hotspot) {
      const h = s.addHotspot([700, 500], 'market');
      h.weight = 10;
      h.radius = 150;
      h.from = '00:00';
      h.to = '23:59';
      if (hotspot === 'off') {
        h.from = '20:00';
        h.to = '21:00';
      }
    }
    const sim = new Sim(s);
    sim.clock.start = startSec;
    sim.seed(2);
    sim.params.load = 40;
    sim.refreshRules();
    let near = 0;
    let tot = 0;
    for (let i = 0; i < 300; i++) {
      const t = sim.pickTrip();
      if (!t) continue;
      tot++;
      if (Math.hypot(t.d.x - 700, t.d.y - 500) < 200 || Math.hypot(t.o.x - 700, t.o.y - 500) < 200) near++;
    }
    return near / tot;
  };
  const none = endsNear(null, 8 * 3600);
  const on = endsNear('on', 8 * 3600);
  const off = endsNear('off', 8 * 3600);
  assert.ok(on > none + 0.25, `active hotspot should add many trips near it (${on} vs ${none})`);
  assert.ok(Math.abs(off - none) < 0.08, 'outside active hours it must not change trips');
});

test('hotspot priority slider shifts trip share between school, out_of_town, and hospital', () => {
  const s = town();
  const school = s.addHotspot([-480, 480], 'school');
  school.weight = 6;
  school.from = '00:00';
  school.to = '23:59';
  school.priority = 90;

  const outOfTown = s.addHotspot([960, 0], 'out_of_town');
  outOfTown.weight = 6;
  outOfTown.from = '00:00';
  outOfTown.to = '23:59';
  outOfTown.priority = 40;

  const hospital = s.addHotspot([-480, -480], 'hospital');
  hospital.weight = 6;
  hospital.from = '00:00';
  hospital.to = '23:59';
  hospital.priority = 10;

  const sim = new Sim(s);
  sim.seed(12);
  const shares = sim.hotspotShares();
  assert.ok(shares[school.id] > 60 && shares[school.id] < 70, `expected school ~64%, got ${shares[school.id]}`);
  assert.ok(shares[hospital.id] > 5 && shares[hospital.id] < 10, `expected hospital ~7%, got ${shares[hospital.id]}`);

  const counts: Record<number, number> = { [school.id]: 0, [outOfTown.id]: 0, [hospital.id]: 0 };
  for (let i = 0; i < 1200; i++) {
    const t = sim.pickTrip();
    if (t && t.hot) counts[t.hot] = (counts[t.hot] || 0) + 1;
  }
  assert.ok(
    counts[school.id] > counts[outOfTown.id] * 1.6 && counts[outOfTown.id] > counts[hospital.id] * 2,
    `school (${counts[school.id]}) > outOfTown (${counts[outOfTown.id]}) > hospital (${counts[hospital.id]})`
  );

  // Turning hospital priority to 0 stops all hotspot trips to hospital; boosting out_of_town redirects traffic there
  hospital.priority = 0;
  school.priority = 20;
  outOfTown.priority = 95;
  sim.updateActive();
  const shares2 = sim.hotspotShares();
  assert.equal(shares2[hospital.id], 0);
  assert.ok(shares2[outOfTown.id] > 80);

  const counts2: Record<number, number> = { [school.id]: 0, [outOfTown.id]: 0, [hospital.id]: 0 };
  for (let i = 0; i < 800; i++) {
    const t = sim.pickTrip();
    if (t && t.hot) counts2[t.hot] = (counts2[t.hot] || 0) + 1;
  }
  assert.equal(counts2[hospital.id], 0, 'priority 0 must receive 0 hotspot trips');
  assert.ok(counts2[outOfTown.id] > counts2[school.id] * 3, 'out of town should capture most trips when prioritized');
});

test('out_of_town hotspot kind exists and legacy saves without priority default cleanly', () => {
  assert.ok(HOT_KINDS.out_of_town, 'HOT_KINDS should include out_of_town');
  const s = town();
  const h = s.addHotspot([900, 0], 'out_of_town', 88);
  assert.equal(h.priority, 88);
  const packed = s.pack();
  // Simulate legacy save by deleting priority
  delete (packed.hotspots![0] as { priority?: number }).priority;
  const loaded = new Store();
  loaded.unpack(packed);
  assert.equal(loaded.hotspots[0].kind, 'out_of_town');
  assert.equal(loaded.hotspots[0].priority, HOT_KINDS.out_of_town.priority);
});

test('hotspot roles: destination-only hotspots are only trip ends', () => {
  const s = town();
  const h = s.addHotspot([700, 500], 'market');
  h.role = 'dest';
  h.weight = 10;
  h.from = '00:00';
  h.to = '23:59';
  const sim = new Sim(s);
  sim.seed(4);
  let asOrigin = 0;
  let asDest = 0;
  for (let i = 0; i < 400; i++) {
    const t = sim.pickTrip();
    if (t && t.hot) {
      if (Math.hypot(t.o.x - 700, t.o.y - 500) < 150) asOrigin++;
      if (Math.hypot(t.d.x - 700, t.d.y - 500) < 150) asDest++;
    }
  }
  assert.ok(asDest > 40 && asOrigin < asDest * 0.2, `dest ${asDest}, origin ${asOrigin}`);
});

test('a hotspot raises traffic on the roads around it', () => {
  const load = (withHot: boolean) => {
    const s = town();
    if (withHot) {
      const h = s.addHotspot([700, 500], 'terminal');
      h.weight = 10;
      h.from = '00:00';
      h.to = '23:59';
    }
    const sim = new Sim(s);
    sim.seed(3);
    sim.params.load = 40;
    sim.prefill();
    run(sim, 400);
    const ids = new Set<number>();
    sim.net.nodes
      .filter(n => Math.hypot(n.x - 700, n.y - 500) < 200)
      .forEach(n => n.in.concat(n.out).forEach(e => ids.add(e.road.id)));
    return [...ids].reduce((a, id) => a + (sim.pass[id] || 0), 0);
  };
  assert.ok(load(true) > load(false) * 1.25);
});

test('a control placed mid-block becomes a node and splits the road', () => {
  const s = town();
  const r = s.roads.find(x => x.name === 'Demo Street 5')!;
  const a = r.pts[1];
  const b = r.pts[2];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2].map(v => Math.round(v * 1e6) / 1e6) as [number, number];
  const before = Network.build(s.roads, {}).nodes.length;
  s.insertPoint(r, mid);
  s.junctions[Geo.key(mid)] = defaultControl('signal');
  const net = Network.build(s.roads, s.junctions);
  assert.equal(net.nodes.length, before + 1);
  assert.ok(net.byKey.get(Geo.key(mid)));
});

test('red light holds vehicles; stop sign discharges slower than free flow', () => {
  const flow = (ctrl: 'stop' | 'signal' | null) => {
    Geo.setOrigin(16.5, 121.16);
    const A = ll(-400, 0);
    const C = ll(0, 0);
    const B = ll(400, 0);
    const s = new Store();
    s.setDataset({
      roads: [
        { id: 1, name: 'E', type: 'street', lanes: 1, speed: 40, dir: 'both', pts: [A, C, B] },
        { id: 2, name: 'stub', type: 'lane', lanes: 1, speed: 20, dir: 'both', pts: [C, ll(0, 60)] },
      ],
      buildings: [],
      name: 't',
    });
    if (ctrl) s.junctions[Geo.key(C)] = { ...defaultControl(ctrl), gA: 20, gB: 20 };
    const sim = new Sim(s);
    sim.seed(1);
    sim.params.load = 100;
    run(sim, 600);
    return sim.done;
  };
  const free = flow(null);
  const stop = flow('stop');
  const signal = flow('signal');
  assert.ok(stop < free, `stop ${stop} should be below free ${free}`);
  assert.ok(signal < free, `signal ${signal} below free ${free}`);
});

test('stop sign with a priority road makes the minor road wait', () => {
  const s = town();
  const n = Network.build(s.roads, {});
  const hw = s.roads.find(r => r.name === 'Demo Highway')!;
  const key = [...n.byKey.keys()].find(k => {
    const nd = n.byKey.get(k)!;
    return nd.deg === 4 && Math.abs(nd.y) < 30 && Math.abs(nd.x - 240) < 30;
  })!;
  s.junctions[key] = { ...defaultControl('stop'), major: hw.id };
  const sim = new Sim(s);
  const node = sim.net.byKey.get(key)!;
  const minorEdge = node.in.find(e => e.road !== hw && e.road.name !== 'Demo Highway')!;
  const hwEdge = node.in.find(e => e.road === hw)!;
  hwEdge.ln[0].push({ s: hwEdge.len - 5 } as never);
  assert.equal(sim.can(minorEdge, node.out.find(e => e.road !== minorEdge.road)!), -1);
  hwEdge.ln[0].pop();
  assert.ok(sim.can(minorEdge, node.out.find(e => e.road !== minorEdge.road)!) >= 0);
});

test('closed road carries no traffic; banned vehicle types are routed away; friction slows traffic', () => {
  const s = town();
  s.roads.find(r => r.name === 'Demo Road 6')!.closed = true;
  const net = Network.build(s.roads, {});
  assert.ok(!net.edges.some(e => e.road.name === 'Demo Road 6'));
  const t = town();
  const r = t.roads.find(x => x.name === 'Demo Highway')!;
  r.banned = ['tk'];
  r.friction = 1;
  t.prepare();
  const sim = new Sim(t);
  const A = sim.net.nodes.find(n => n.out.some(e => e.road === r))!;
  const B = sim.net.nodes.find(n => n.in.some(e => e.road === r) && n !== A)!;
  const p = sim.router.route(A, B, 'tk');
  assert.ok(!p || p.every(e => e.road !== r), 'trucks must avoid the banned road');
  assert.ok(sim.net.edges.find(e => e.road === r)!.vm < sim.net.edges.find(e => e.road === r)!.vm0 * 0.6);
});

test('splitting a road makes two independently editable roads', () => {
  const s = town();
  const r = s.roads.find(x => x.name === 'Demo Street 5')!;
  const n0 = s.roads.length;
  const len = r.pts.length;
  const pt = ll(100, 480);
  const b = s.split(r, pt)!;
  assert.ok(b);
  assert.equal(s.roads.length, n0 + 1);
  assert.equal(r.pts.length + b.pts.length, len + 2);
  assert.notEqual(r.id, b.id);
  b.dir = 'fwd';
  s.prepare();
  const net = Network.build(s.roads, {});
  assert.ok(net.edges.some(e => e.road === b) && net.edges.some(e => e.road === r));
});

test('hotspots (with priority), closures and controls survive save and load', () => {
  const s = town();
  const h = s.addHotspot([100, 100], 'school', 82);
  s.roads[0].closed = true;
  s.roads[1].friction = 0.4;
  s.junctions['k'] = defaultControl('crossing');
  const t = new Store();
  t.fromText(JSON.stringify(s.pack()));
  assert.equal(t.hotspots.length, 1);
  assert.equal(t.hotspots[0].priority, h.priority);
  assert.deepEqual(t.hotspots[0].xy.map(Math.round), [100, 100]);
  assert.equal(t.roads[0].closed, true);
  assert.equal(t.roads[1].friction, 0.4);
  assert.equal(t.junctions.k.ctrl, 'crossing');
});

test('experiment: identical traffic gives identical results; a closure shows up in the numbers', async () => {
  const s = town();
  const sim = new Sim(s);
  sim.params.load = 40;
  const road = s.roads.find(r => r.name === 'Demo Boulevard')!;
  const ids = [road.id];
  const a = await Analyze.measure(sim, ids, 3000);
  const b = await Analyze.measure(sim, ids, 3000);
  assert.deepEqual(a, b);
  road.closed = true;
  const c = await Analyze.measure(sim, ids, 3000);
  assert.ok(a.flow > 0 && c.flow === 0);
});

const snap = (s: Store) => JSON.stringify(s.pack());
const centreOf = (s: Store, name: string): [number, number] => {
  const r = s.roads.find(x => x.name === name)!;
  return [(r._bb![0] + r._bb![2]) / 2, (r._bb![1] + r._bb![3]) / 2];
};

test('workbench copies only the area, and discarding restores the town exactly', () => {
  const s = town();
  const before = snap(s);
  const n = s.roads.length;
  const ids = s.enterWorkbench(centreOf(s, 'Demo Street 6'), 300);
  assert.ok(s.roads.length < n && s.roads.length > 3 && ids.size === s.roads.length);
  assert.ok(s.buildings.length < s.main!.buildings.length);
  s.roads[0].speed = 5;
  s.roads.push({
    id: 9999,
    name: 'x',
    type: 'street',
    lanes: 1,
    speed: 30,
    dir: 'both',
    pts: [ll(0, 0), ll(10, 10)],
    closed: false,
    friction: 0,
    banned: [],
  });
  s.discardWorkbench();
  assert.equal(snap(s), before);
  assert.equal(s.wb, null);
});

test('applying a workbench merges edits back; untouched roads are unchanged', () => {
  const s = town();
  const n = s.roads.length;
  const target = s.roads.find(r => r.name === 'Demo Street 6')!;
  const far = s.roads.find(r => r.name === 'Demo Street 1')!;
  const farBefore = JSON.stringify([far.speed, far.pts]);
  s.enterWorkbench(centreOf(s, 'Demo Street 6'), 300);
  assert.ok(!s.roads.some(r => r.name === 'Demo Street 1'));
  const w = s.roads.find(r => r.id === target.id)!;
  w.speed = 17;
  w.closed = false;
  const k = Geo.key(w.pts[2]);
  s.junctions[k] = defaultControl('signal');
  const b = s.split(w, ll(-300, 480))!;
  assert.ok(b);
  b.dir = 'fwd';
  const msg = s.applyWorkbench();
  assert.equal(s.roads.length, n + 1);
  assert.equal(s.roads.find(r => r.id === target.id)!.speed, 17);
  assert.equal(s.roads.find(r => r.name === 'Demo Street 1')!.id, far.id);
  assert.equal(JSON.stringify([far.speed, far.pts]), farBefore);
  assert.equal(s.junctions[k].ctrl, 'signal');
  assert.equal(new Set(s.roads.map(r => r.id)).size, s.roads.length);
  assert.match(msg, /1 added/);
  assert.match(msg, /junction controls updated/);
  assert.equal(s.main, null);
  assert.ok(new Sim(s).net.edges.length > 0);
});

test('deleting roads and hotspots in a workbench removes them from the town on apply', () => {
  const s = town();
  s.addHotspot(centreOf(s, 'Demo Street 6'), 'school');
  s.prepare();
  s.enterWorkbench(centreOf(s, 'Demo Street 6'), 300);
  const victim = s.roads.find(r => r.name === 'Demo Street 6')!;
  const vid = victim.id;
  s.del(victim);
  s.hotspots = [];
  s.applyWorkbench();
  assert.ok(!s.roads.some(r => r.id === vid));
  assert.equal(s.hotspots.length, 0);
});

test('workbench simulation is much smaller, with through-traffic gates at its edge', () => {
  const s = town();
  const full = new Sim(s);
  const c = centreOf(s, 'Demo Street 6');
  s.enterWorkbench(c, 300);
  const sim = new Sim(s);
  assert.ok(sim.net.edges.length < full.net.edges.length / 2);
  const out = sim.net.core.filter(n => Math.hypot(n.x - c[0], n.y - c[1]) > 300);
  const inn = sim.net.core.filter(n => Math.hypot(n.x - c[0], n.y - c[1]) <= 300);
  assert.ok(out.length && out[0].w > 1);
  assert.ok(out.reduce((a, n) => a + n.w, 0) > 0.3 * inn.reduce((a, n) => a + n.w, 0));
  sim.params.load = 40;
  sim.prefill();
  run(sim, 200);
  assert.ok(sim.done > 5);
});

test('deleteRoad removes multiple roads and undoDeleteRoad / restoreAllDeletedRoads restore them cleanly', async () => {
  const { RoadLensApp } = await import('../src/ui/appState');
  const app = new RoadLensApp();
  app.loadDemo(true);
  const before = app.store.roads.length;
  const v1 = app.store.roads.find(r => r.name === 'Demo Street 5')!;
  const v2 = app.store.roads.find(r => r.name === 'Demo Street 6')!;
  const v3 = app.store.roads.find(r => r.name === 'Demo Street 7')!;
  assert.ok(v1 && v2 && v3);
  app.deleteRoad(v1);
  app.deleteRoad(v2);
  app.deleteRoad(v3);
  assert.equal(app.store.roads.length, before - 3);
  assert.equal(app.deletedRoads.length, 3);
  assert.equal(app.lastDeletedRoad?.road, v3);
  app.undoDeleteRoad();
  assert.equal(app.store.roads.length, before - 2);
  assert.ok(app.store.roads.includes(v3));
  app.restoreAllDeletedRoads();
  assert.equal(app.store.roads.length, before);
  assert.ok(app.store.roads.includes(v1) && app.store.roads.includes(v2));
  assert.equal(app.lastDeletedRoad, null);
});
