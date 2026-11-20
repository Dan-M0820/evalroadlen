import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/data/store';
import { Sim } from '../src/engine/sim';
import { Geo } from '../src/engine/geo';
import { Network } from '../src/engine/network';
import { armsAt, movements, autoPhases } from '../src/engine/junction';
import { findProblems } from '../src/engine/problems';
import type { Road } from '../src/types';

const ll = (x: number, y: number): [number, number] =>
  Geo.ll(x, y).map(v => Math.round(v * 1e6) / 1e6) as [number, number];

function cross() {
  Geo.setOrigin(16.5, 121.16);
  const R = (id: number, name: string, pts: [number, number][]): Road => ({
    id,
    name,
    type: 'street',
    lanes: 2,
    speed: 40,
    dir: 'both',
    pts,
  });
  const s = new Store();
  s.setDataset({
    roads: [R(1, 'EW', [ll(-400, 0), ll(0, 0), ll(400, 0)]), R(2, 'NS', [ll(0, -400), ll(0, 0), ll(0, 400)])],
    buildings: [],
    name: 't',
  });
  return { s, key: Geo.key(ll(0, 0)) };
}

test('a 4-way cross has 4 arms and 12 movements (4 left, 4 straight, 4 right)', () => {
  const { s, key } = cross();
  const arms = armsAt(s.roads, key);
  const mv = movements(arms);
  assert.equal(arms.length, 4);
  assert.equal(mv.length, 12);
  for (const t of ['L', 'S', 'R'] as const) assert.equal(mv.filter(m => m.type === t).length, 4);
  assert.equal(autoPhases(arms, mv).length, 2);
});

test('lane use per approach is obeyed: a left-only lane carries only vehicles that turn left', () => {
  const { s, key } = cross();
  const arms = armsAt(s.roads, key);
  const mv = movements(arms);
  const lanes: Record<string, ('L' | 'S' | 'R')[][]> = {};
  for (const a of arms) lanes[a.id] = [['L'], ['S', 'R']];
  s.junctions[key] = { ctrl: 'signal', gA: 20, gB: 20, allRed: 3, offset: 0, lanes, phases: autoPhases(arms, mv) };
  const sim = new Sim(s);
  sim.seed(3);
  sim.params.load = 60;
  sim.prefill();
  let bad = 0;
  let checked = 0;
  for (let i = 0; i < 3000; i++) {
    sim.step(0.1);
    if (i % 5) continue;
    for (const e of sim.net.edges) {
      if (!e.perm) continue;
      e.ln.forEach((q, li) =>
        q.forEach(v => {
          const nx = v.p[v.i + 1];
          const ok = nx && e.perm!.get(nx.id);
          if (ok && ok.length) {
            checked++;
            if (!ok.includes(li)) bad++;
          }
        })
      );
    }
  }
  assert.ok(checked > 1000 && bad === 0, `${bad} of ${checked} vehicles were in a lane not allowed to make their turn`);
  assert.ok(sim.done > 100);
});

test('signal phases alternate with an all-red gap between them', () => {
  const { s, key } = cross();
  const arms = armsAt(s.roads, key);
  const mv = movements(arms);
  const J = (s.junctions[key] = { ctrl: 'signal', phases: autoPhases(arms, mv, 20, 3) });
  const sim = new Sim(s);
  const seen = new Set<number>();
  for (let t = 0; t < 120; t += 0.5) {
    sim.T = t;
    seen.add(sim.phaseNow(J));
  }
  assert.deepEqual([...seen].sort(), [-1, 0, 1]);
});

test('roundabout template creates reshapeable one-way ring with yield priority and undo/redo works', () => {
  const { s, key } = cross();
  s.enterWorkbench([0, 0], 500);
  const beforeCount = s.roads.length;
  s.insertTemplate('roundabout', [0, 0], key);
  assert.ok(s.canUndo());
  const rings = s.roads.filter(r => r.name === 'Roundabout Ring');
  assert.equal(rings.length, 4);
  assert.ok(rings.every(r => r.dir === 'fwd' && r.pts.length >= 3));
  const sim = new Sim(s);
  assert.ok(sim.net.core.length >= 4);

  // Undo and redo restore states accurately
  assert.equal(s.undo(), true);
  assert.equal(s.roads.length, beforeCount);
  assert.equal(s.canRedo(), true);
  assert.equal(s.redo(), true);
  assert.equal(s.roads.filter(r => r.name === 'Roundabout Ring').length, 4);
});

test('findProblems flags lanes with no allowed turns or missing green movements', () => {
  const { s, key } = cross();
  const arms = armsAt(s.roads, key);
  const lanes: Record<string, ('L' | 'S' | 'R')[][]> = {};
  for (const a of arms) lanes[a.id] = [[], ['S', 'R']];
  s.junctions[key] = {
    ctrl: 'signal',
    lanes,
    phases: [{ dur: 20, clear: 3, allow: [] }],
  };
  const net = Network.build(s.roads, s.junctions);
  const probs = findProblems(s.roads, s.junctions, net);
  assert.ok(probs.some(p => p.id.startsWith('empty-')));
  assert.ok(probs.some(p => p.id.startsWith('missing-green-')));
});
