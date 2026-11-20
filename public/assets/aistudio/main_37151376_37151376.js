import { Store } from './data/store.js';
import { Sim } from './engine/sim.js';
import { View } from './render/view.js';
import { drawScene, palette, posAt } from './render/draw.js';
import { Editor } from './ui/editor.js';
import { initPanels } from './ui/panels.js';
import { demoTown } from './data/demo.js';
import { AREAS, fetchArea } from './data/osm.js';
import { saveSoon, loadSaved } from './data/persist.js';
import { ROAD_TYPES, defaultControl } from './config.js';
import { Geo } from './engine/geo.js';
import { Analyze } from './engine/analyze.js';

const $ = id => document.getElementById(id);

// Central app object: owns the data (store), the simulation (sim), the camera (view) and what is selected.
const app = {
  store: new Store(), view: new View(), layers: { buildings: true, junctions: true, labels: true, arrows: false, mode: 'heat' },
  tool: 'select', sel: { road: null, node: null, veh: null, hot: null }, draft: [], hover: null, newType: 'street', newDir: 'both', newKind: 'school', newCtrl: 'signal', applyAll: false, follow: false,
  roadOrder: [], pal: palette(), handlers: {}, status() {},
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); },
  emit(ev) { (this.handlers[ev] || []).forEach(f => f()); },
  wb: false, mainView: null,
  persist() { if (!this.wb) saveSoon(this.store); },
  // true (and a message) while a workbench is open: loading, clearing or saving the town would act on the small copy
  locked() { if (this.wb) this.status('Apply or discard the workbench first.'); return this.wb; },

  // Rebuild the road network and refill traffic. Called after any change to roads, junctions or time.
  rebuild() {
    this.store.project(); this.roadOrder = [...this.store.roads].sort((a, b) => ROAD_TYPES[a.type].rank - ROAD_TYPES[b.type].rank);
    this.sim.rebuild(); this.sim.prefill();
    const s = this.sel; if (s.road && !this.store.roads.includes(s.road)) s.road = null; s.node = s.node ? this.sim.net.byKey.get(s.node.key) || null : null; s.veh = null;
    this.emit('rebuild');
  },
  changed() { this.persist(); this.rebuild(); },
  select(o) { this.sel = { road: o.road || null, node: o.node || null, veh: o.veh || null, hot: o.hot || null }; if (!o.veh) this.follow = false; this.emit('select'); },
  setTool(t) { this.tool = t; this.cancelDraw(); if (t === 'draw') this.select({}); this.emit('tool'); },

  cancelDraw() { this.draft = []; this.hover = null; this.emit('hint'); },
  finishDraw() {
    if (this.tool !== 'draw' || this.draft.length < 2) { this.cancelDraw(); return; }
    const pts = []; for (const d of this.draft) { if (pts.length && pts[pts.length - 1].join(',') === d.ll.join(',')) continue; if (d.ins) this.store.insertPoint(d.ins, d.ll); pts.push(d.ll); }
    if (pts.length < 2) { this.cancelDraw(); return; }
    const r = this.store.add(this.store.make(this.newType, pts, this.newDir)); this.cancelDraw(); this.changed(); this.select({ road: r });
  },
  // ---- hotspots, control points, splitting
  addHotspot(xy) { const h = this.store.addHotspot(xy, this.newKind); this.hotChanged(); this.select({ hot: h }); this.status(`Pinned “${h.name}”. Drag the pin to move it; edit it under “Selected”.`); },
  // control settings changed without changing the road layout: no need to reset the traffic
  junctionChanged() { this.persist(); this.sim.router.cache.clear(); },
  hotChanged() { this.sim.refreshHotspots(); this.persist(); this.emit('hotspots'); },
  deleteHotspot(h) { this.store.hotspots = this.store.hotspots.filter(x => x !== h); this.select({}); this.hotChanged(); },
  addControl(s) {
    if (!s || !s.snap) { this.status('Click on a road (the green ring appears) to place the control there.'); return; }
    if (s.ins) this.store.insertPoint(s.ins, s.ll);
    const key = Geo.key(s.ll), J = this.store.junctions[key] || (this.store.junctions[key] = defaultControl(this.newCtrl)); if (J.ctrl === 'free') J.ctrl = this.newCtrl;
    this.changed(); this.select({ node: this.sim.net.byKey.get(key) || null }); this.status('Control placed. Adjust it under “Selected”.');
  },
  splitAt(s) {
    if (!s || !s.snap || !s.road) { this.status('Click on a road to cut it in two there.'); return; }
    const b = this.store.split(s.road, s.ll); if (!b) { this.status('Pick a point away from the ends of the road.'); return; }
    this.changed(); this.select({ road: b }); this.setTool('select'); this.status('Road split. Each part can now be edited on its own (speed, direction, closing…).');
  },
  deleteRoad(r) { this.store.del(r); this.select({}); this.changed(); },

  // ---- workbench: edit and test a copy of the area around the selection, then apply it to the town in one step
  async enterWorkbench(R = 500) {
    if (this.wb) return; const s = this.sel, st = this.store, sim = this.sim;
    const c = s.road ? [(s.road._bb[0] + s.road._bb[2]) / 2, (s.road._bb[1] + s.road._bb[3]) / 2] : s.node ? [s.node.x, s.node.y] : s.hot ? [...s.hot.xy] : null;
    if (!c) { this.status('Select a road, junction or hotspot first.'); return; }
    const ids = st.enterWorkbench(c, R), elapsed = sim.T - sim.t0, target = elapsed >= 90 ? Analyze.occupancy(sim, [...ids], sim.t0) : null; // how busy the town map had these roads
    this.mainView = { cx: this.view.cx, cy: this.view.cy, scale: this.view.scale }; this.wb = true; this.follow = false;
    sim.scale = .25; sim.busy = true; this.setTool('select'); this.select({}); sim.rebuild(); this.view.fit(st.bounds()); this.emit('dataset'); this.emit('wb');
    if (target != null && target > 0) { this.status('Matching the workbench traffic to what these roads carried on the town map…'); await Analyze.calibrate(sim, [...ids], target); }
    sim.busy = false; this.rebuild();
    this.status(`Workbench: ${st.roads.length} roads copied. Edit freely; the town map is untouched until you press Apply.` + (target ? ' Traffic matched to the town map.' : ' Traffic level is a rough guess: let the town map run for 90+ seconds before opening a workbench to match it exactly.'));
  },
  applyWorkbench() {
    if (!this.wb) return; const msg = this.store.applyWorkbench(); this.leaveWorkbench(); this.persist(); this.status('Applied to the town: ' + msg + '.');
  },
  discardWorkbench() { if (!this.wb) return; this.store.discardWorkbench(); this.leaveWorkbench(); this.status('Workbench discarded. The town is unchanged.'); },
  leaveWorkbench() {
    this.wb = false; this.sim.scale = 1; this.sim.busy = false; this.select({}); this.rebuild(); Object.assign(this.view, this.mainView); this.emit('dataset'); this.emit('wb');
  },

  afterLoad(save = true) { this.sim.seed(1); this.sim.clock.start = 6 * 3600; this.sim.T = 0; this.select({}); this.rebuild(); this.view.fit(this.store.bounds()); if (save) this.persist(); this.emit('dataset'); },
  loadDemo(auto = false) { if (this.locked()) return; this.store.setDataset(demoTown()); this.afterLoad(!auto); this.status('Demo town loaded (synthetic).'); }, // the automatic first-run demo is not saved, so the real map is tried again next time
  async loadReal(key) {
    if (this.locked()) return;
    const btn = $('bReal'); btn.disabled = true;
    try {
      const ds = await fetchArea(AREAS[key].bbox, t => this.status(t));
      if (!ds.roads.length) throw new Error('OpenStreetMap returned no roads for that box');
      this.store.setDataset({ ...ds, name: AREAS[key].n + ' (OpenStreetMap)' }); this.afterLoad();
      this.status(`Loaded ${ds.roads.length} road segments and ${ds.buildings.length} buildings from OpenStreetMap.`); return true;
    } catch (e) { this.status('Could not reach OpenStreetMap (' + e.message + '). You can also download an Overpass JSON file and use “Load file”.'); return false; }
    finally { btn.disabled = false; }
  }
};
window.app = app; // handy for poking around in the browser console

async function boot() {
  const cv = $('map'), ctx = cv.getContext('2d');
  app.sim = new Sim(app.store);
  initPanels(app); new Editor(app, cv);
  const bar = $('wbBar'); app.on('wb', () => { bar.hidden = !app.wb; document.body.classList.toggle('wb', app.wb); });
  $('wbApply').onclick = () => app.applyWorkbench(); $('wbDiscard').onclick = () => app.discardWorkbench();
  const resize = () => { const r = $('stage').getBoundingClientRect(), d = devicePixelRatio || 1; cv.width = r.width * d; cv.height = r.height * d; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; app.view.W = r.width; app.view.H = r.height; app.dpr = d; };
  new ResizeObserver(resize).observe($('stage')); resize();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { app.pal = palette(); });
  $('bClear').onclick = () => { if (app.locked()) return; if (confirm('Remove all roads, junction settings and rules?')) { app.store.setDataset({ roads: [], buildings: [], name: 'Empty' }); app.afterLoad(); } };
  $('zin').onclick = () => app.view.zoomAt(app.view.W / 2, app.view.H / 2, 1.5); $('zout').onclick = () => app.view.zoomAt(app.view.W / 2, app.view.H / 2, 1 / 1.5);

  // first start: restore saved work, otherwise demo town immediately, then try the real map
  const saved = await loadSaved(); let tryReal = false;
  if (saved && saved.roads && saved.roads.length) { app.store.unpack(saved); app.afterLoad(); } else { app.loadDemo(true); tryReal = true; }
  if (tryReal) app.loadReal('both');

  let fr = 0;
  (function loop() {
    const sim = app.sim; if (sim.run && !sim.busy) for (let i = 0, n = +$('spd').value; i < n; i++) sim.step(.1);
    const v = app.sel.veh; if (v && app.follow) { const e = v.p[v.i]; if (e) { const p = posAt(e, v.s); app.view.cx += (p[0] - app.view.cx) * .2; app.view.cy += (p[1] - app.view.cy) * .2; } }
    ctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0); drawScene(app, ctx); scaleBar();
    if (++fr % 15 === 0) { if (v && !v.p[v.i].ln.some(q => q.includes(v))) app.select({}); app.emit('tick'); }
    requestAnimationFrame(loop);
  })();
}
function scaleBar() {
  const sc = app.view.scale, steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]; const m = steps.find(s => s * sc >= 70) || 5000;
  $('scaleBar').style.width = m * sc + 'px'; $('scaleTxt').textContent = m >= 1000 ? m / 1000 + ' km' : m + ' m';
}
boot();
