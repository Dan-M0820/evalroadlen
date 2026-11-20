import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/data/store.js';
import { Sim } from '../src/engine/sim.js';
import { Network } from '../src/engine/network.js';
import { Analyze } from '../src/engine/analyze.js';
import { demoTown } from '../src/data/demo.js';
import { defaultControl } from '../src/config.js';
import { Geo } from '../src/engine/geo.js';

const town = () => { const s = new Store(); s.setDataset(demoTown()); return s; };
const ll = (x, y) => Geo.ll(x, y).map(v => Math.round(v * 1e6) / 1e6);
const run = (sim, secs) => { for (let i = 0; i < secs * 10; i++) sim.step(.1); };

test('hotspot pulls trips toward it while active, and not outside its hours', () => {
  const endsNear = (hotspot, startSec) => {
    const s = town(); if (hotspot) { const h = s.addHotspot([700, 500], 'market'); h.weight = 10; h.radius = 150; h.from = '00:00'; h.to = '23:59'; if (hotspot === 'off') { h.from = '20:00'; h.to = '21:00'; } }
    const sim = new Sim(s); sim.clock.start = startSec; sim.seed(2); sim.params.load = 40; sim.refreshRules();
    let near = 0, tot = 0; for (let i = 0; i < 300; i++) { const t = sim.pickTrip(); if (!t) continue; tot++; if (Math.hypot(t.d.x - 700, t.d.y - 500) < 200 || Math.hypot(t.o.x - 700, t.o.y - 500) < 200) near++; }
    return near / tot;
  };
  const none = endsNear(null, 8 * 3600), on = endsNear('on', 8 * 3600), off = endsNear('off', 8 * 3600);
  assert.ok(on > none + .25, `active hotspot should add many trips near it (${on} vs ${none})`);
  assert.ok(Math.abs(off - none) < .08, 'outside active hours it must not change trips');
});

test('hotspot roles: destination-only hotspots are only trip ends', () => {
  const s = town(), h = s.addHotspot([700, 500], 'market'); h.role = 'dest'; h.weight = 10; h.from = '00:00'; h.to = '23:59';
  const sim = new Sim(s); sim.seed(4); let asOrigin = 0, asDest = 0;
  for (let i = 0; i < 400; i++) { const t = sim.pickTrip(); if (t && t.hot) { if (Math.hypot(t.o.x - 700, t.o.y - 500) < 150) asOrigin++; if (Math.hypot(t.d.x - 700, t.d.y - 500) < 150) asDest++; } }
  assert.ok(asDest > 40 && asOrigin < asDest * .2, `dest ${asDest}, origin ${asOrigin}`);
});

test('a hotspot raises traffic on the roads around it', () => {
  const load = withHot => { const s = town(); if (withHot) { const h = s.addHotspot([700, 500], 'terminal'); h.weight = 10; h.from = '00:00'; h.to = '23:59'; }
    const sim = new Sim(s); sim.seed(3); sim.params.load = 40; sim.prefill(); run(sim, 400); const ids = new Set(); sim.net.nodes.filter(n => Math.hypot(n.x - 700, n.y - 500) < 200).forEach(n => n.in.concat(n.out).forEach(e => ids.add(e.road.id)));
    return [...ids].reduce((a, id) => a + (sim.pass[id] || 0), 0); };
  assert.ok(load(true) > load(false) * 1.25);
});

test('a control placed mid-block becomes a node and splits the road', () => {
  const s = town(), r = s.roads.find(x => x.name === 'Demo Street 5'), a = r.pts[1], b = r.pts[2];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2].map(v => Math.round(v * 1e6) / 1e6);
  const before = Network.build(s.roads, {}).nodes.length; s.insertPoint(r, mid); s.junctions[Geo.key(mid)] = defaultControl('signal');
  const net = Network.build(s.roads, s.junctions); assert.equal(net.nodes.length, before + 1); assert.ok(net.byKey.get(Geo.key(mid)));
});

test('red light holds vehicles; stop sign discharges slower than free flow', () => {
  const flow = ctrl => { Geo.setOrigin(16.5, 121.16); const A = ll(-400, 0), C = ll(0, 0), B = ll(400, 0);
    const s = new Store(); s.setDataset({ roads: [{ id: 1, name: 'E', type: 'street', lanes: 1, speed: 40, dir: 'both', pts: [A, C, B] }, { id: 2, name: 'stub', type: 'lane', lanes: 1, speed: 20, dir: 'both', pts: [C, ll(0, 60)] }], buildings: [], name: 't' }); // stub makes C a node even without a control
    if (ctrl) s.junctions[Geo.key(C)] = { ...defaultControl(ctrl), gA: 20, gB: 20 };
    const sim = new Sim(s); sim.seed(1); sim.params.load = 100; run(sim, 600); return sim.done; };
  const free = flow(null), stop = flow('stop'), signal = flow('signal');
  assert.ok(stop < free, `stop ${stop} should be below free ${free}`); assert.ok(signal < free, `signal ${signal} below free ${free}`);
});

test('stop sign with a priority road makes the minor road wait', () => {
  const s = town(), n = Network.build(s.roads, {}), hw = s.roads.find(r => r.name === 'Demo Highway');
  const key = [...n.byKey.keys()].find(k => { const nd = n.byKey.get(k); return nd.deg === 4 && Math.abs(nd.y) < 30 && Math.abs(nd.x - 240) < 30; });
  s.junctions[key] = { ...defaultControl('stop'), major: hw.id };
  const sim = new Sim(s), node = sim.net.byKey.get(key), minorEdge = node.in.find(e => e.road !== hw && e.road.name !== 'Demo Highway'), hwEdge = node.in.find(e => e.road === hw);
  const fake = { s: hwEdge.len - 5 }; hwEdge.ln[0].push(fake); // a car arriving on the priority road
  assert.equal(sim.can(minorEdge, node.out.find(e => e.road !== minorEdge.road)), -1, 'minor road must wait for the priority road');
  hwEdge.ln[0].pop(); assert.ok(sim.can(minorEdge, node.out.find(e => e.road !== minorEdge.road)) >= 0, 'and go when it is clear');
});

test('closed road carries no traffic; banned vehicle types are routed away; friction slows traffic', () => {
  const s = town(); s.roads.find(r => r.name === 'Demo Road 6').closed = true;
  const net = Network.build(s.roads, {}); assert.ok(!net.edges.some(e => e.road.name === 'Demo Road 6'));
  const t = town(), r = t.roads.find(x => x.name === 'Demo Highway'); r.banned = ['tk']; r.friction = 1; t.prepare();
  const sim = new Sim(t); const A = sim.net.nodes.find(n => n.out.some(e => e.road === r)), B = sim.net.nodes.find(n => n.in.some(e => e.road === r) && n !== A);
  const p = sim.router.route(A, B, 'tk'); assert.ok(!p || p.every(e => e.road !== r), 'trucks must avoid the banned road');
  assert.ok(sim.net.edges.find(e => e.road === r).vm < sim.net.edges.find(e => e.road === r).vm0 * .6, 'friction cuts free speed');
});

test('splitting a road makes two independently editable roads', () => {
  const s = town(), r = s.roads.find(x => x.name === 'Demo Street 5'), n0 = s.roads.length, len = r.pts.length;
  const pt = ll(100, 480), b = s.split(r, pt); assert.ok(b); assert.equal(s.roads.length, n0 + 1); assert.equal(r.pts.length + b.pts.length, len + 2);
  assert.notEqual(r.id, b.id); b.dir = 'fwd'; s.prepare(); const net = Network.build(s.roads, {});
  assert.ok(net.edges.some(e => e.road === b) && net.edges.some(e => e.road === r));
});

test('hotspots, closures and controls survive save and load', () => {
  const s = town(); s.addHotspot([100, 100], 'school'); s.roads[0].closed = true; s.roads[1].friction = .4; s.junctions['k'] = defaultControl('crossing');
  const t = new Store(); t.fromText(JSON.stringify(s.pack()));
  assert.equal(t.hotspots.length, 1); assert.deepEqual(t.hotspots[0].xy.map(Math.round), [100, 100]); assert.equal(t.roads[0].closed, true); assert.equal(t.roads[1].friction, .4); assert.equal(t.junctions.k.ctrl, 'crossing');
});

test('experiment: identical traffic gives identical results; a closure shows up in the numbers', async () => {
  const s = town(), sim = new Sim(s); sim.params.load = 40; const road = s.roads.find(r => r.name === 'Demo Boulevard'), ids = [road.id];
  const a = await Analyze.measure(sim, ids, 3000), b = await Analyze.measure(sim, ids, 3000);
  assert.deepEqual(a, b, 'same seeded traffic must reproduce exactly');
  road.closed = true; const c = await Analyze.measure(sim, ids, 3000);
  assert.ok(a.flow > 0 && c.flow === 0, `flow on closed road should be 0 (was ${a.flow})`);
});

// ---------------- workbench ----------------
const snap = s => JSON.stringify(s.pack());
const centreOf = (s, name) => { const r = s.roads.find(x => x.name === name); return [(r._bb[0] + r._bb[2]) / 2, (r._bb[1] + r._bb[3]) / 2]; };

test('workbench copies only the area, and discarding restores the town exactly', () => {
  const s = town(), before = snap(s), n = s.roads.length;
  const ids = s.enterWorkbench(centreOf(s, 'Demo Street 6'), 300);
  assert.ok(s.roads.length < n && s.roads.length > 3 && ids.size === s.roads.length);
  assert.ok(s.buildings.length < s.main.buildings.length);
  s.roads[0].speed = 5; s.roads.push({ id: 9999, name: 'x', type: 'street', lanes: 1, speed: 30, dir: 'both', pts: [ll(0, 0), ll(10, 10)], closed: false, friction: 0, banned: [] });
  s.discardWorkbench();
  assert.equal(snap(s), before); assert.equal(s.wb, null);
});

test('applying a workbench merges edits back; untouched roads are unchanged', () => {
  const s = town(), n = s.roads.length, target = s.roads.find(r => r.name === 'Demo Street 6');
  const far = s.roads.find(r => r.name === 'Demo Street 1'), farBefore = JSON.stringify([far.speed, far.pts]);
  s.enterWorkbench(centreOf(s, 'Demo Street 6'), 300);
  assert.ok(!s.roads.some(r => r.name === 'Demo Street 1'), 'far road is not in the workbench');
  const w = s.roads.find(r => r.id === target.id); w.speed = 17; w.closed = false;
  const k = Geo.key(w.pts[2]); s.junctions[k] = defaultControl('signal');
  const b = s.split(w, ll(-300, 480)); assert.ok(b); b.dir = 'fwd';
  const msg = s.applyWorkbench();
  assert.equal(s.roads.length, n + 1); assert.equal(s.roads.find(r => r.id === target.id).speed, 17);
  assert.equal(s.roads.find(r => r.name === 'Demo Street 1').id, far.id); assert.equal(JSON.stringify([far.speed, far.pts]), farBefore);
  assert.equal(s.junctions[k].ctrl, 'signal'); assert.equal(new Set(s.roads.map(r => r.id)).size, s.roads.length, 'ids stay unique');
  assert.match(msg, /1 added/); assert.match(msg, /junction controls updated/); assert.equal(s.main, null);
  assert.ok(new Sim(s).net.edges.length > 0);
});

test('deleting roads and hotspots in a workbench removes them from the town on apply', () => {
  const s = town(); const h = s.addHotspot(centreOf(s, 'Demo Street 6'), 'school'); s.prepare();
  s.enterWorkbench(centreOf(s, 'Demo Street 6'), 300); const victim = s.roads.find(r => r.name === 'Demo Street 6'), vid = victim.id;
  s.del(victim); s.hotspots = []; s.applyWorkbench();
  assert.ok(!s.roads.some(r => r.id === vid)); assert.equal(s.hotspots.length, 0);
});

test('workbench simulation is much smaller, with through-traffic gates at its edge', () => {
  const s = town(), full = new Sim(s), c = centreOf(s, 'Demo Street 6'); s.enterWorkbench(c, 300);
  const sim = new Sim(s); assert.ok(sim.net.edges.length < full.net.edges.length / 2, `${sim.net.edges.length} vs ${full.net.edges.length}`);
  const out = sim.net.core.filter(n => Math.hypot(n.x - c[0], n.y - c[1]) > 300), inn = sim.net.core.filter(n => Math.hypot(n.x - c[0], n.y - c[1]) <= 300);
  assert.ok(out.length && out[0].w > 1); assert.ok(out.reduce((a, n) => a + n.w, 0) > .3 * inn.reduce((a, n) => a + n.w, 0), 'gates carry a real share of trips');
  sim.params.load = 40; sim.prefill(); run(sim, 200); assert.ok(sim.done > 5);
});

test('calibration matches the workbench traffic level to the town map', async () => {
  const s = town(), main = new Sim(s); main.params.load = 40; main.seed(2); main.prefill(); run(main, 400);
  const c = centreOf(s, 'Demo Street 6'), ids = [...s.enterWorkbench(c, 400)];
  // the town numbers must be measured before the workbench sim rebuilds, as the app does
  const target = Analyze.occupancy(main, ids, main.t0); assert.ok(target > 0.5, 'town has traffic here: ' + target);
  const sim = new Sim(s); sim.params.load = 40; sim.scale = .25; await Analyze.calibrate(sim, ids, target, 4);
  sim.rebuild(); sim.seed(5); sim.prefill(); for (let i = 0; i < 3000; i++) { sim.step(.1); if (i === 600) { sim.mt = {}; sim.t0 = sim.T; } }
  const got = Analyze.occupancy(sim, ids, sim.t0);
  assert.ok(got > target * .6 && got < target * 1.6, `workbench ${got.toFixed(1)} vs town ${target.toFixed(1)} vehicles on these roads`);
});
