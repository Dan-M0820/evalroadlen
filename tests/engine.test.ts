import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/data/store';
import { Sim } from '../src/engine/sim';
import { Network } from '../src/engine/network';
import { demoTown } from '../src/data/demo';
import { parseOverpass, overpassQuery } from '../src/data/osm';
import { Geo } from '../src/engine/geo';
import type { Road, RoadDir, RoadTypeKey } from '../src/types';

const road = (id: number, type: RoadTypeKey, dir: RoadDir, pts: [number, number][], extra: Partial<Road> = {}): Road => ({
  id,
  name: 'R' + id,
  type,
  lanes: 1,
  speed: 40,
  dir,
  pts,
  ...extra,
});
const ll = (x: number, y: number): [number, number] =>
  Geo.ll(x, y).map(v => Math.round(v * 1e6) / 1e6) as [number, number];

function store(roads: Road[]) {
  const s = new Store();
  s.setDataset({ roads, buildings: [], name: 't' });
  return s;
}

function cross() {
  Geo.setOrigin(16.5, 121.16);
  return [
    road(1, 'street', 'both', [ll(-300, 0), ll(0, 0), ll(300, 0)]),
    road(2, 'street', 'both', [ll(0, -300), ll(0, 0), ll(0, 300)]),
  ];
}

test('roads are cut into edges at shared points; two-way gives two directed edges', () => {
  const s = store(cross());
  const net = Network.build(s.roads, {});
  assert.equal(net.nodes.length, 5);
  assert.equal(net.edges.length, 8);
  assert.equal(net.nodes.find(n => n.deg === 4)!.out.length, 4);
});

test('one-way roads only get one direction and routing respects it', () => {
  Geo.setOrigin(16.5, 121.16);
  const P0 = ll(0, 0);
  const P4 = ll(400, 0);
  const s = store([
    road(1, 'street', 'fwd', [P0, ll(200, 0), P4]),
    road(2, 'street', 'both', [P0, ll(0, 200), ll(400, 200), P4]),
  ]);
  const sim = new Sim(s);
  const A = sim.net.byKey.get(Geo.key(P0))!;
  const B = sim.net.byKey.get(Geo.key(P4))!;
  const fwd = sim.router.route(A, B, 'ca');
  const back = sim.router.route(B, A, 'ca');
  assert.ok(fwd && fwd.every(e => e.road.id === 1), 'A->B should use the one-way road');
  assert.ok(back && back.every(e => e.road.id === 2), 'B->A must detour around via the two-way road');
});

test('"rev" flips the allowed direction', () => {
  Geo.setOrigin(16.5, 121.16);
  const s = store([road(1, 'street', 'rev', [ll(0, 0), ll(400, 0)])]);
  const net = Network.build(s.roads, {});
  assert.equal(net.edges.length, 1);
  assert.ok(net.edges[0].a.x > net.edges[0].b.x);
});

test('banning a vehicle type on a road reroutes or blocks that type only', () => {
  Geo.setOrigin(16.5, 121.16);
  const s = store([road(1, 'street', 'both', [ll(0, 0), ll(400, 0)])]);
  s.rules.push({ v: 'tk', r: 1, a: 'ban', from: '00:00', to: '23:59' });
  const sim = new Sim(s);
  const A = sim.net.nodes[0];
  const B = sim.net.nodes[1];
  assert.equal(sim.router.route(A, B, 'tk'), null);
  assert.ok(sim.router.route(A, B, 'ca'));
});

test('demo town simulation: trips finish, lanes never overlap, results are repeatable', () => {
  const run = () => {
    const s = new Store();
    s.setDataset(demoTown());
    const sim = new Sim(s);
    sim.seed(5);
    sim.params.load = 40;
    sim.prefill();
    for (let i = 0; i < 4000; i++) sim.step(0.1);
    return sim;
  };
  const a = run();
  const b = run();
  assert.ok(a.done > 50, 'vehicles should complete trips: ' + a.done);
  assert.equal(a.done, b.done);
  assert.equal(a.nv, b.nv);
  for (const e of a.net.edges) {
    for (const q of e.ln) {
      for (let k = 1; k < q.length; k++) {
        assert.ok(q[k - 1].s - q[k - 1].L - q[k].s > -1.5, 'vehicles overlap on a lane');
      }
    }
  }
});

test('more traffic means more delay (congestion emerges)', () => {
  const delay = (load: number) => {
    const s = new Store();
    s.setDataset(demoTown());
    const sim = new Sim(s);
    sim.seed(3);
    sim.params.load = load;
    sim.prefill();
    for (let i = 0; i < 6000; i++) sim.step(0.1);
    return sim.avgD!;
  };
  const low = delay(8);
  const high = delay(100);
  assert.ok(high > low * 2, `expected high-load delay (${high}) well above low-load (${low})`);
});

test('traffic is generated near buildings (gravity weights)', () => {
  Geo.setOrigin(16.5, 121.16);
  const P0 = ll(0, 0);
  const P1 = ll(1000, 0);
  const bl: [number, number][] = Array.from({ length: 60 }, (_, i) =>
    ll(1000 + (i % 6) * 6, 20 + Math.floor(i / 6) * 6)
  );
  const s = new Store();
  s.setDataset({ roads: [road(1, 'street', 'both', [P0, ll(500, 0), P1])], buildings: bl, name: 't' });
  const sim = new Sim(s);
  const far = sim.net.byKey.get(Geo.key(P1))!;
  const near = sim.net.byKey.get(Geo.key(P0))!;
  assert.ok(far.w > 50 && near.w === 1);
});

test('driver aggressiveness changes headway and speed', () => {
  const s = new Store();
  s.setDataset(demoTown());
  const sim = new Sim(s);
  sim.seed(1);
  const ty = { ...s.vehicles[2], spread: 0 };
  const calm = sim.makeDriver({ ...ty, aggr: 0 });
  const wild = sim.makeDriver({ ...ty, aggr: 1 });
  assert.ok(wild.tau < calm.tau && wild.f > calm.f && wild.acc > calm.acc);
});

test('Overpass JSON parsing: types, one-way, lanes, speed, buildings', () => {
  const g = (...c: [number, number][]) => c.map(([lat, lon]) => ({ lat, lon }));
  const j: Parameters<typeof parseOverpass>[0] = {
    elements: [
      {
        type: 'way',
        id: 11,
        tags: { highway: 'primary', name: 'Maharlika Highway', lanes: '4', maxspeed: '60' },
        geometry: g([16.48, 121.15], [16.481, 121.151]),
      },
      {
        type: 'way',
        id: 12,
        tags: { highway: 'residential', oneway: 'yes' },
        geometry: g([16.48, 121.15], [16.482, 121.15]),
      },
      {
        type: 'way',
        id: 13,
        tags: { highway: 'secondary', oneway: '-1', name: 'Quirino' },
        geometry: g([16.48, 121.15], [16.48, 121.152]),
      },
      {
        type: 'way',
        id: 14,
        tags: { highway: 'service', junction: 'roundabout' },
        geometry: g([16.5, 121.1], [16.501, 121.1]),
      },
      {
        type: 'way',
        id: 15,
        tags: { highway: 'footway' },
        geometry: g([16.5, 121.1], [16.501, 121.1]),
      },
      { type: 'way', id: 21, tags: { building: 'yes' }, center: { lat: 16.4805, lon: 121.1505 } },
    ],
  };
  const { roads, buildings } = parseOverpass(j);
  assert.equal(roads.length, 4);
  assert.equal(buildings.length, 1);
  const by = (n: string) => roads.find(r => r.name === n)!;
  assert.equal(by('Maharlika Highway').type, 'highway');
  assert.equal(by('Maharlika Highway').lanes, 2);
  assert.equal(by('Maharlika Highway').dir, 'both');
  assert.equal(roads.find(r => r.osm === 12)!.dir, 'fwd');
  assert.equal(by('Quirino').dir, 'rev');
  assert.equal(by('Quirino').type, 'boulevard');
  assert.equal(roads.find(r => r.osm === 14)!.dir, 'fwd');
  assert.equal(roads.find(r => r.osm === 14)!.type, 'lane');
  assert.match(overpassQuery([1, 2, 3, 4]), /\(1,2,3,4\)/);
});

test('project save/load round trip and GeoJSON import', () => {
  const s = new Store();
  s.setDataset(demoTown());
  s.junctions['x'] = { ctrl: 'signal' };
  s.vehicles[0].aggr = 0.9;
  const t = new Store();
  t.fromText(JSON.stringify(s.pack()));
  assert.equal(t.roads.length, s.roads.length);
  assert.equal(t.junctions.x.ctrl, 'signal');
  assert.equal(t.vehicles[0].aggr, 0.9);
  assert.equal(t.buildings.length, s.buildings.length);
  const u = new Store();
  u.fromText(JSON.stringify(s.geojson()));
  assert.equal(u.roads.length, s.roads.length);
});
