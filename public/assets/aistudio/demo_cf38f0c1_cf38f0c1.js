import { Geo } from '../engine/geo.js';
// Synthetic demo town so the app works offline. It is NOT Bayombong: it only shows what the tools do.
export function demoTown() {
  Geo.setOrigin(16.5, 121.16);
  const H = [], V = [], roads = []; let id = 1;
  const hy = [-720, -480, -240, 0, 240, 480, 720], vx = [-960, -720, -480, -240, 0, 240, 480, 720, 960];
  hy.forEach((y, i) => H.push({ y, x0: -1100, x1: 1100, type: y === 0 ? 'highway' : i % 2 ? 'street' : 'residential', dir: y === 240 ? 'fwd' : y === -240 ? 'rev' : 'both', name: y === 0 ? 'Demo Highway' : `Demo Street ${i + 1}` }));
  vx.forEach((x, i) => V.push({ x, y0: -820, y1: 820, type: x === 0 ? 'boulevard' : i % 2 ? 'residential' : 'street', dir: 'both', name: x === 0 ? 'Demo Boulevard' : `Demo Road ${i + 1}` }));
  const line = (pts, o) => roads.push({ id: id++, name: o.name, type: o.type, lanes: o.type === 'highway' || o.type === 'boulevard' ? 2 : 1, speed: { highway: 60, boulevard: 50, street: 40, residential: 30, lane: 15 }[o.type], dir: o.dir, pts: pts.map(([x, y]) => Geo.ll(x, y).map(v => Math.round(v * 1e6) / 1e6)) });
  for (const h of H) { const xs = [h.x0, ...vx.filter(x => x > h.x0 && x < h.x1), h.x1].sort((a, b) => a - b); line(xs.map(x => [x, h.y]), h); }
  for (const v of V) { const ys = [v.y0, ...hy.filter(y => y > v.y0 && y < v.y1), v.y1].sort((a, b) => a - b); line(ys.map(y => [v.x, y]), v); }
  // a few dead-end lanes
  [[-360, 120], [360, -120], [-600, 360], [600, -360]].forEach(([x, y], i) => line([[x, y + 120], [x, y]], { name: `Demo Lane ${i + 1}`, type: 'lane', dir: 'both' }));
  // houses: grid of squares kept away from roads
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, buildings = [];
  for (let x = -1050; x <= 1050; x += 28) for (let y = -770; y <= 770; y += 28) {
    const dx = Math.min(...vx.map(v => Math.abs(x - v))), dy = Math.min(...hy.map(v => Math.abs(y - v)));
    if (dx > 18 && dy > 18 && rnd() > .3) buildings.push(Geo.ll(x + (rnd() - .5) * 8, y + (rnd() - .5) * 8).map(v => Math.round(v * 1e6) / 1e6));
  }
  return { roads, buildings, name: 'Demo town (synthetic, not Bayombong)' };
}
