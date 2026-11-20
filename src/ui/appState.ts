import { Store } from '../data/store';
import { Sim } from '../engine/sim';
import { View } from '../render/view';
import { palette, type CanvasInteractiveTarget, type Palette } from '../render/draw';
import { demoTown } from '../data/demo';
import { AREAS, fetchArea, fetchBundledBayombongSolano } from '../data/osm';
import { saveSoon, loadSaved } from '../data/persist';
import { ROAD_TYPES, HOT_KINDS, defaultControl } from '../config';
import { Geo } from '../engine/geo';
import { Analyze } from '../engine/analyze';
import { armsAt, autoPhases, lanePerms, movements } from '../engine/junction';
import { findProblems } from '../engine/problems';
import type { NetEdge, NetNode, Vehicle } from '../engine/network';
import type {
  ApproachPriority,
  ControlType,
  EditorProblem,
  Hotspot,
  HotspotKindKey,
  LayerOptions,
  Road,
  RoadDir,
  RoadTypeKey,
  ToolMode,
  TurnMove,
} from '../types';

export interface SelectionState {
  road: Road | null;
  node: NetNode | null;
  veh: Vehicle | null;
  hot: Hotspot | null;
}

export class RoadLensApp {
  store: Store;
  sim: Sim;
  view: View;
  layers: LayerOptions = { buildings: true, junctions: true, labels: true, arrows: false, mode: 'heat' };
  tool: ToolMode = 'select';
  sel: SelectionState = { road: null, node: null, veh: null, hot: null };
  draft: Array<{ ll: [number, number]; xy: [number, number]; snap?: boolean; ins?: Road | null; road?: Road }> = [];
  hover: { ll: [number, number]; xy: [number, number]; snap?: boolean; ins?: Road | null; road?: Road } | null = null;
  hoverRoad: Road | null = null;
  deletedRoads: Array<{ road: Road; index: number }> = [];

  get lastDeletedRoad(): { road: Road; index: number } | null {
    return this.deletedRoads[this.deletedRoads.length - 1] ?? null;
  }
  newType: RoadTypeKey = 'street';
  newDir: RoadDir = 'both';
  newKind: HotspotKindKey = 'school';
  newPriority: number = HOT_KINDS.school.priority;
  newCtrl: ControlType = 'signal';
  applyAll = false;
  follow = false;
  speedMul = 2;
  editPhaseIdx = 0;
  roadOrder: Road[] = [];
  pal: Palette;
  theme: 'dark' | 'light' = 'dark';
  wb = false;
  mainView: { cx: number; cy: number; scale: number } | null = null;
  selPos: [number, number, number, NetEdge, Vehicle] | null = null;
  interactiveTargets: CanvasInteractiveTarget[] = [];
  statusText = '';
  loadingReal = false;
  dirty = true;
  staticVer = 0;
  private listeners = new Set<() => void>();
  private tickListeners = new Set<() => void>();

  constructor() {
    this.store = new Store();
    this.sim = new Sim(this.store);
    this.view = new View();
    this.theme =
      typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
    this.pal = palette(this.theme);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  subscribeTick(fn: () => void): () => void {
    this.tickListeners.add(fn);
    return () => this.tickListeners.delete(fn);
  }

  markDirty() {
    this.dirty = true;
  }

  notifyUI() {
    this.dirty = true;
    for (const fn of this.listeners) fn();
  }

  notify() {
    this.dirty = true;
    this.staticVer++;
    for (const fn of this.listeners) fn();
  }

  notifyTick() {
    for (const fn of this.tickListeners) fn();
  }

  status(msg: string) {
    this.statusText = msg;
    this.notify();
  }

  setTheme(theme: 'dark' | 'light') {
    this.theme = theme;
    this.pal = palette(theme);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    this.notify();
  }

  persist() {
    if (!this.wb) saveSoon(this.store);
  }

  locked(): boolean {
    if (this.wb) this.status('Apply or discard the workbench first.');
    return this.wb;
  }

  rebuild(keepSelectedNodeKey?: string) {
    this.store.project();
    this.roadOrder = [...this.store.roads].sort((a, b) => ROAD_TYPES[a.type].rank - ROAD_TYPES[b.type].rank);
    this.sim.rebuild();
    this.sim.prefill();
    this.staticVer++;
    const s = this.sel;
    if (s.road && !this.store.roads.includes(s.road)) s.road = null;
    const nodeKey = keepSelectedNodeKey || (s.node ? s.node.key : undefined);
    s.node = nodeKey ? this.sim.net.byKey.get(nodeKey) || null : null;
    s.veh = null;
    this.notify();
  }

  changed(keepSelectedNodeKey?: string) {
    this.persist();
    this.rebuild(keepSelectedNodeKey);
  }

  select(o: Partial<SelectionState>) {
    this.sel = { road: o.road || null, node: o.node || null, veh: o.veh || null, hot: o.hot || null };
    if (!o.veh) this.follow = false;
    this.editPhaseIdx = 0;
    this.notify();
  }

  setTool(t: ToolMode) {
    this.tool = t;
    this.cancelDraw();
    if (t === 'draw') this.select({});
    this.notify();
  }

  setNewKind(kind: HotspotKindKey) {
    this.newKind = kind;
    this.newPriority = HOT_KINDS[kind]?.priority ?? 50;
    this.notify();
  }

  cancelDraw() {
    this.draft = [];
    this.hover = null;
    this.hoverRoad = null;
    this.notify();
  }

  finishDraw() {
    if (this.tool !== 'draw' || this.draft.length < 2) {
      this.cancelDraw();
      return;
    }
    if (this.wb) this.store.pushUndo();
    const pts: [number, number][] = [];
    for (const d of this.draft) {
      if (pts.length && pts[pts.length - 1].join(',') === d.ll.join(',')) continue;
      if (d.ins) this.store.insertPoint(d.ins, d.ll);
      pts.push(d.ll);
    }
    if (pts.length < 2) {
      this.cancelDraw();
      return;
    }
    const r = this.store.add(this.store.make(this.newType, pts, this.newDir));
    this.cancelDraw();
    this.changed();
    this.select({ road: r });
  }

  addHotspot(xy: [number, number]) {
    const h = this.store.addHotspot(xy, this.newKind, this.newPriority);
    this.hotChanged();
    this.select({ hot: h });
    this.status(`Pinned “${h.name}” (${h.priority}% priority). Adjust priorities in Hotspots or Selected.`);
  }

  junctionChanged() {
    this.persist();
    this.sim.router.cache.clear();
    this.sim.invalidate();
    this.notify();
  }

  hotChanged() {
    this.sim.refreshHotspots();
    this.persist();
    this.notify();
  }

  deleteHotspot(h: Hotspot) {
    if (this.wb) this.store.pushUndo();
    this.store.hotspots = this.store.hotspots.filter(x => x !== h);
    if (this.sel.hot === h) this.select({});
    this.hotChanged();
  }

  addControl(s: { snap?: boolean; ins?: Road | null; ll: [number, number] } | null) {
    if (!s || !s.snap) {
      this.status('Click on a road (when the green snap ring appears) to place a control there.');
      return;
    }
    if (this.wb) this.store.pushUndo();
    if (s.ins) this.store.insertPoint(s.ins, s.ll);
    const key = Geo.key(s.ll);
    const J = this.store.junctions[key] || (this.store.junctions[key] = defaultControl(this.newCtrl));
    if (J.ctrl === 'free') J.ctrl = this.newCtrl;
    if (J.ctrl === 'signal' && !J.phases) {
      this.store.project();
      const arms = armsAt(this.store.roads, key);
      const mvs = movements(arms);
      if (mvs.length) J.phases = autoPhases(arms, mvs, J.gA || 20, J.allRed ?? 3);
    }
    this.changed();
    this.select({ node: this.sim.net.byKey.get(key) || null });
    this.status('Control placed. Adjust it under “Selected”.');
  }

  splitAt(s: { snap?: boolean; road?: Road; ll: [number, number] } | null) {
    if (!s || !s.snap || !s.road) {
      this.status('Click on a road to cut it in two there.');
      return;
    }
    if (this.wb) this.store.pushUndo();
    const b = this.store.split(s.road, s.ll);
    if (!b) {
      this.status('Pick a point away from the ends of the road.');
      return;
    }
    this.changed();
    this.select({ road: b });
    this.setTool('select');
    this.status('Road split. Each part can now be edited independently.');
  }

  deleteRoad(r: Road) {
    if (this.wb) this.store.pushUndo();
    const index = this.store.roads.indexOf(r);
    this.deletedRoads.push({ road: r, index: index >= 0 ? index : this.store.roads.length });
    if (this.deletedRoads.length > 100) this.deletedRoads.shift();
    if (this.hoverRoad === r) this.hoverRoad = null;
    this.store.del(r);
    this.select({});
    this.changed();
    this.status(`Deleted “${r.name}”.`);
  }

  undoDeleteRoad() {
    const entry = this.deletedRoads.pop();
    if (!entry) return;
    const { road, index } = entry;
    if (this.wb) this.store.pushUndo();
    if (!this.store.roads.includes(road)) {
      const idx = Math.max(0, Math.min(this.store.roads.length, index));
      this.store.roads.splice(idx, 0, road);
    }
    this.changed();
    this.select({ road });
    this.status(`Restored “${road.name}”.`);
  }

  restoreAllDeletedRoads() {
    if (!this.deletedRoads.length) return;
    if (this.wb) this.store.pushUndo();
    const count = this.deletedRoads.length;
    let lastRestored: Road | null = null;
    while (this.deletedRoads.length) {
      const { road, index } = this.deletedRoads.pop()!;
      if (!this.store.roads.includes(road)) {
        const idx = Math.max(0, Math.min(this.store.roads.length, index));
        this.store.roads.splice(idx, 0, road);
        lastRestored = road;
      }
    }
    this.changed();
    if (lastRestored) this.select({ road: lastRestored });
    this.status(`Restored ${count} deleted road${count === 1 ? '' : 's'}.`);
  }

  // ---- visual junction & road editor mutations -----------------------------------------------
  toggleLaneMove(nodeKey: string, armId: string, laneIdx: number, move: TurnMove) {
    if (this.wb) this.store.pushUndo();
    const J = this.store.junctions[nodeKey] || (this.store.junctions[nodeKey] = defaultControl('free'));
    if (!J.lanes) J.lanes = {};
    const arms = armsAt(this.store.roads, nodeKey);
    const arm = arms.find(a => a.id === armId);
    const count = arm ? arm.inN : 1;
    const perms = lanePerms(J, armId, count);
    const cur = new Set(perms[laneIdx] || []);
    if (cur.has(move)) {
      if (cur.size > 1) cur.delete(move); // keep at least 1 movement or allow toggling back
      else cur.delete(move);
    } else {
      cur.add(move);
    }
    perms[laneIdx] = (['L', 'S', 'R'] as TurnMove[]).filter(m => cur.has(m));
    J.lanes[armId] = perms;
    this.sim.net.applyJunctions(this.store.junctions);
    this.junctionChanged();
  }

  cycleApproachPriority(nodeKey: string, armId: string, explicit?: ApproachPriority) {
    if (this.wb) this.store.pushUndo();
    const J = this.store.junctions[nodeKey] || (this.store.junctions[nodeKey] = defaultControl('yield'));
    if (J.ctrl === 'free') J.ctrl = 'yield';
    if (!J.appr) J.appr = {};
    const order: ApproachPriority[] = ['prio', 'yield', 'stop'];
    const cur = J.appr[armId] || (J.ctrl === 'stop' ? 'stop' : 'yield');
    const next = explicit || order[(order.indexOf(cur) + 1) % order.length];
    J.appr[armId] = next;
    this.junctionChanged();
  }

  togglePhaseMovement(nodeKey: string, moveKey: string) {
    if (this.wb) this.store.pushUndo();
    const J = this.store.junctions[nodeKey] || (this.store.junctions[nodeKey] = defaultControl('signal'));
    if (!J.phases || !J.phases.length) {
      const arms = armsAt(this.store.roads, nodeKey);
      J.phases = autoPhases(arms, movements(arms), J.gA || 20, J.allRed ?? 3);
    }
    const idx = Math.min(this.editPhaseIdx, Math.max(0, J.phases.length - 1));
    const phase = J.phases[idx];
    if (!phase) return;
    if (phase.allow.includes(moveKey)) {
      phase.allow = phase.allow.filter(k => k !== moveKey);
    } else {
      phase.allow = [...phase.allow, moveKey];
    }
    this.junctionChanged();
  }

  adjustRoadLanes(road: Road, side: 'fwd' | 'rev', delta: 1 | -1) {
    if (this.wb) this.store.pushUndo();
    if (side === 'fwd' || road.dir !== 'both') {
      road.lanes = Math.max(1, Math.min(4, road.lanes + delta));
    } else {
      road.lanesR = Math.max(1, Math.min(4, (road.lanesR ?? road.lanes) + delta));
    }
    this.changed();
  }

  zoomInSelected() {
    if (this.sel.node) {
      this.view.cx = this.sel.node.x;
      this.view.cy = this.sel.node.y;
      this.view.scale = Math.max(this.view.scale, 3.6);
    } else if (this.sel.road && this.sel.road._bb) {
      const bb = this.sel.road._bb;
      this.view.cx = (bb[0] + bb[2]) / 2;
      this.view.cy = (bb[1] + bb[3]) / 2;
      this.view.scale = Math.max(this.view.scale, 3.2);
    } else if (this.sel.hot) {
      this.view.cx = this.sel.hot.xy[0];
      this.view.cy = this.sel.hot.xy[1];
      this.view.scale = Math.max(this.view.scale, 1.5);
    }
    this.notify();
  }

  insertTemplate(kind: 'cross' | 't' | 'roundabout') {
    const center: [number, number] = this.sel.node
      ? [this.sel.node.x, this.sel.node.y]
      : this.sel.road && this.sel.road._bb
        ? [(this.sel.road._bb[0] + this.sel.road._bb[2]) / 2, (this.sel.road._bb[1] + this.sel.road._bb[3]) / 2]
        : [this.view.cx, this.view.cy];
    const existingNodeKey = this.sel.node ? this.sel.node.key : undefined;
    this.store.insertTemplate(kind, center, existingNodeKey);
    this.changed();
    if (kind === 'roundabout') {
      this.view.cx = center[0];
      this.view.cy = center[1];
      this.view.scale = Math.max(this.view.scale, 3.0);
      this.status('Inserted editable roundabout. Drag ring vertices or click approach badges to customize.');
    } else {
      this.status(`Inserted ${kind === 'cross' ? 'Cross' : 'T-Junction'} template.`);
    }
  }

  undo() {
    if (!this.store.undo()) return;
    this.select({});
    this.changed();
    this.status('Undid last workbench edit.');
  }

  redo() {
    if (!this.store.redo()) return;
    this.select({});
    this.changed();
    this.status('Redid workbench edit.');
  }

  problems(): EditorProblem[] {
    return findProblems(this.store.roads, this.store.junctions, this.sim.net);
  }

  // ---- workbench ------------------------------------------------------------------------------
  async enterWorkbench(R = 500) {
    if (this.wb) return;
    const s = this.sel;
    const st = this.store;
    const sim = this.sim;
    const c: [number, number] | null =
      s.road && s.road._bb
        ? [(s.road._bb[0] + s.road._bb[2]) / 2, (s.road._bb[1] + s.road._bb[3]) / 2]
        : s.node
          ? [s.node.x, s.node.y]
          : s.hot
            ? [...s.hot.xy]
            : null;
    if (!c) {
      this.status('Select a road, junction or hotspot first.');
      return;
    }
    const selNodeKey = s.node ? s.node.key : undefined;
    const ids = st.enterWorkbench(c, R);
    const elapsed = sim.T - sim.t0;
    const target = elapsed >= 90 ? Analyze.occupancy(sim, [...ids], sim.t0) : null;
    this.mainView = { cx: this.view.cx, cy: this.view.cy, scale: this.view.scale };
    this.wb = true;
    this.follow = false;
    sim.scale = 0.25;
    sim.busy = true;
    this.setTool('select');
    this.select({});
    this.rebuild(selNodeKey);
    if (selNodeKey) {
      this.view.cx = c[0];
      this.view.cy = c[1];
      this.view.scale = 3.2;
    } else {
      this.view.fit(st.bounds());
    }
    this.notify();
    if (target != null && target > 0) {
      this.status('Matching workbench traffic to town levels…');
      await Analyze.calibrate(sim, [...ids], target);
    }
    sim.busy = false;
    this.rebuild(selNodeKey);
    this.status(
      `Workbench: ${st.roads.length} roads copied. Edits stay separate until Apply.` +
        (target ? ' Traffic matched to the town map.' : '')
    );
  }

  applyWorkbench() {
    if (!this.wb) return;
    const msg = this.store.applyWorkbench();
    this.leaveWorkbench();
    this.persist();
    this.status('Applied to the town: ' + msg + '.');
  }

  discardWorkbench() {
    if (!this.wb) return;
    this.store.discardWorkbench();
    this.leaveWorkbench();
    this.status('Workbench discarded. The town is unchanged.');
  }

  leaveWorkbench() {
    this.wb = false;
    this.sim.scale = 1;
    this.sim.busy = false;
    this.select({});
    this.rebuild();
    if (this.mainView) Object.assign(this.view, this.mainView);
    this.notify();
  }

  afterLoad(save = true) {
    this.deletedRoads = [];
    this.hoverRoad = null;
    this.sim.seed(1);
    this.sim.clock.start = 6 * 3600;
    this.sim.T = 0;
    this.select({});
    this.rebuild();
    this.view.fit(this.store.bounds());
    if (save) this.persist();
    this.notify();
  }

  async resetOriginalRoads(): Promise<boolean> {
    if (this.locked()) return false;
    const savedHotspots = this.store.hotspots.map(h => ({ ...h, ll: [...h.ll] as [number, number], xy: [...h.xy] as [number, number] }));
    const savedRules = this.store.rules.map(r => ({ ...r }));
    const isDemo = this.store.name.startsWith('Demo town');
    this.loadingReal = true;
    this.notify();
    try {
      const ds = isDemo ? demoTown() : await fetchBundledBayombongSolano();
      this.store.setDataset(ds);
      if (savedHotspots.length) {
        this.store.hotspots = savedHotspots;
      }
      if (savedRules.length) {
        this.store.rules = savedRules;
      }
      this.store.prepare();
      this.afterLoad(true);
      this.status(
        `Reset to all ${ds.roads.length} original ${isDemo ? 'demo town' : 'Bayombong & Solano'} roads.`
      );
      return true;
    } catch {
      this.status('Could not reload the original road dataset.');
      return false;
    } finally {
      this.loadingReal = false;
      this.notify();
    }
  }

  loadDemo(auto = false) {
    if (this.locked()) return;
    this.store.setDataset(demoTown());
    this.afterLoad(!auto);
    this.status('Demo town loaded (synthetic).');
  }

  async loadBundled(): Promise<boolean> {
    if (this.locked()) return false;
    this.loadingReal = true;
    this.notify();
    try {
      const ds = await fetchBundledBayombongSolano();
      this.store.setDataset(ds);
      this.afterLoad(false);
      this.status(
        `Loaded ${ds.roads.length} road segments and ${ds.buildings.length} buildings for Bayombong & Solano.`
      );
      return true;
    } catch {
      return false;
    } finally {
      this.loadingReal = false;
      this.notify();
    }
  }

  async loadReal(key: string): Promise<boolean> {
    if (this.locked()) return false;
    this.loadingReal = true;
    this.notify();
    try {
      const ds = await fetchArea(AREAS[key].bbox, t => this.status(t));
      if (!ds.roads.length) throw new Error('OpenStreetMap returned no roads for that box');
      this.store.setDataset({ ...ds, name: AREAS[key].n + ' (OpenStreetMap)' });
      this.afterLoad();
      this.status(
        `Loaded ${ds.roads.length} road segments and ${ds.buildings.length} buildings from OpenStreetMap.`
      );
      return true;
    } catch (e) {
      this.status('Could not reach OpenStreetMap (' + (e instanceof Error ? e.message : String(e)) + ').');
      return false;
    } finally {
      this.loadingReal = false;
      this.notify();
    }
  }

  async boot() {
    const saved = await loadSaved();
    if (saved && saved.roads && saved.roads.length) {
      this.store.unpack(saved);
      this.afterLoad(false);
      return;
    }
    const ok = await this.loadBundled();
    if (!ok) {
      this.loadDemo(true);
    }
  }
}
