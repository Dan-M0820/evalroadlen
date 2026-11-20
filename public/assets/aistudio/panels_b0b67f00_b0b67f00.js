import { ROAD_TYPES, DAY_TYPES, DEFAULT_VEHICLES, HOT_KINDS, CONTROLS, defaultControl } from '../config.js';
import { Analyze } from '../engine/analyze.js';
import { AREAS } from '../data/osm.js';
import { roadWidth } from '../engine/network.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const typeOpts = sel => Object.entries(ROAD_TYPES).map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${t.label}</option>`).join('');
const DIRS = { both: 'Two-way', fwd: 'One-way: start → end', rev: 'One-way: end → start' };
const dirOpts = sel => Object.entries(DIRS).map(([k, n]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${n}</option>`).join('');
const ROLES = { dest: 'Attracts trips (people travel TO it)', origin: 'Generates trips (people leave FROM it)', both: 'Both directions' };
const TOOLS = { select: 'tSel', draw: 'tDraw', hotspot: 'tHot', point: 'tPoint', split: 'tSplit' };
const HINTS = {
  select: 'Click a road, a junction/control dot, a hotspot pin or a driver. Drag to pan, scroll to zoom.',
  hotspot: 'Click the map to pin a hotspot (school, market, terminal…). Click a pin to select it, drag it to move it.',
  point: 'Click on a road to put the control there: at a junction, or anywhere along the road (e.g. a stop light mid-block).',
  split: 'Click on a road where you want to cut it in two. Then each part can be edited on its own.'
};
// level of service from speed ratio (1 = free flow)
const los = r => r >= .85 ? ['A', 'free flow', '#2ecc71'] : r >= .7 ? ['B', 'smooth', '#7bd36b'] : r >= .55 ? ['C', 'slowing', '#c9d44a'] : r >= .4 ? ['D', 'busy', '#f1c40f'] : r >= .25 ? ['E', 'near capacity', '#f39c12'] : ['F', 'jammed', '#e74c3c'];

const SKELETON = `
<details><summary>Map and layers</summary>
  <label>Area <select id="area">${Object.entries(AREAS).map(([k, a]) => `<option value="${k}">${a.n}</option>`).join('')}</select></label>
  <div class="row"><button id="bReal" class="primary">Load real roads (OpenStreetMap)</button></div>
  <div class="row"><button id="bDemo">Use demo town</button><button id="bFit">Fit to screen</button></div>
  <div class="checks"><label><input type="checkbox" id="lBld" checked> Buildings (squares)</label><label><input type="checkbox" id="lJn" checked> Junction and control dots</label>
  <label><input type="checkbox" id="lLab" checked> Street names</label><label><input type="checkbox" id="lArr"> Flow arrows on every road</label></div>
  <div class="row"><label><input type="radio" name="mode" value="heat" checked> Congestion colours</label><label><input type="radio" name="mode" value="type"> Road types</label></div></details>
<details open><summary>Tools</summary>
  <div class="tools"><button id="tSel" class="on">Select</button><button id="tDraw">Draw road</button><button id="tHot">Pin hotspot</button><button id="tPoint">Add stop light</button><button id="tSplit">Split road</button></div>
  <div id="toolOpts"></div><small id="hint"></small><small id="mapStatus" class="stat"></small></details>
<details open id="sSel"><summary id="selTitle">Selected</summary><div id="selBody"></div><div id="wbOpen"></div><div id="live"></div><div id="exp"></div></details>
<details open><summary>Hotspots</summary><div id="hotList"></div></details>
<details open><summary>Traffic and time</summary>
  <label>Day type <select id="day">${Object.entries(DAY_TYPES).map(([k, d]) => `<option value="${k}">${d.n}</option>`).join('')}</select></label>
  <label>Time of day <input type="range" id="tl" min="0" max="1439" step="15" value="360"></label>
  <canvas id="dem" width="280" height="70"></canvas><small>Drag the bars to set demand by hour (assumption: replace with your counts).</small>
  <label>Overall traffic <input type="range" id="load" min="0" max="100" value="30"></label>
  <b>Who is on the road</b><div id="mix"></div>
  <div class="row"><button id="bPlay" class="on">Pause</button><label class="inl">speed ×<select id="spd"><option>1</option><option selected>2</option><option>4</option><option>8</option><option>16</option><option>32</option></select></label></div>
  <small id="stats"></small></details>
<details><summary>Driver tendencies</summary><div id="drv"></div><div class="row"><button id="bAddType">Add vehicle type</button></div>
  <small>Applies to drivers who start trips from now on. Each driver varies around the type average.</small></details>
<details><summary>Rules by vehicle, road and time</summary>
  <label>Vehicle <select id="rv"></select></label><label>Road <select id="rr"></select></label>
  <label>Rule <select id="ra"><option value="ban">Ban</option><option value="cap">Speed cap</option></select></label><input id="rval" type="number" value="20" hidden aria-label="Speed cap km/h">
  <label>From <input type="time" id="rf" value="06:00"> to <input type="time" id="rt" value="20:00"></label><button id="rAdd">Add rule</button><div id="rlist"></div></details>
<details open><summary>Town-wide efficiency</summary><div id="delay" class="mu">Measuring…</div>
  <div class="row"><button id="bMark">Mark as original</button><button id="bSug">Suggest improvement</button></div><div id="sugg"></div>
  <b>Biggest bottlenecks</b><div id="worst"><small>Run the simulation for a minute.</small></div></details>
<details id="sV"><summary>Selected driver</summary><div id="veh"><small>Click a dot on the map.</small></div></details>`;

export function initPanels(app) {
  const { store, sim } = app;
  $('side').innerHTML = SKELETON;
  const status = t => { $('mapStatus').textContent = t; }; app.status = status;

  // ---------- map & layers ----------
  $('bReal').onclick = () => app.loadReal($('area').value); $('bDemo').onclick = () => app.loadDemo(false); $('bFit').onclick = () => app.view.fit(store.bounds());
  const lay = (id, k) => { $(id).onchange = () => { app.layers[k] = $(id).checked; }; };
  lay('lBld', 'buildings'); lay('lJn', 'junctions'); lay('lLab', 'labels'); lay('lArr', 'arrows');
  document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = () => { app.layers.mode = r.value; });

  // ---------- tools ----------
  for (const [t, id] of Object.entries(TOOLS)) $(id).onclick = () => app.setTool(t);
  function toolOpts() {
    const t = app.tool, el = $('toolOpts'); let h = '';
    if (t === 'draw') h = `<label>New road type <select id="newType">${typeOpts(app.newType)}</select></label><label>New road flow <select id="newDir">${dirOpts(app.newDir)}</select></label><div class="row"><button id="bFin">Finish</button><button id="bCancel">Cancel</button></div>`;
    if (t === 'hotspot') h = `<label>Kind of hotspot <select id="newKind">${Object.entries(HOT_KINDS).map(([k, v]) => `<option value="${k}" ${k === app.newKind ? 'selected' : ''}>${v.n}</option>`).join('')}</select></label>`;
    if (t === 'point') h = `<label>Control to place <select id="newCtrl">${['signal', 'stop', 'yield', 'crossing'].map(k => `<option value="${k}" ${k === app.newCtrl ? 'selected' : ''}>${CONTROLS[k]}</option>`).join('')}</select></label>`;
    el.innerHTML = h;
    if ($('newType')) { $('newType').onchange = () => { app.newType = $('newType').value; }; $('newDir').onchange = () => { app.newDir = $('newDir').value; }; $('bFin').onclick = () => app.finishDraw(); $('bCancel').onclick = () => app.cancelDraw(); }
    if ($('newKind')) $('newKind').onchange = () => { app.newKind = $('newKind').value; };
    if ($('newCtrl')) $('newCtrl').onchange = () => { app.newCtrl = $('newCtrl').value; };
  }
  app.on('hint', () => { const n = app.draft.length;
    $('hint').textContent = app.tool === 'draw' ? (n ? `${n} point(s). Keep clicking. Double-click or Enter to finish. Click on an existing road (green ring) to join it.` : 'Pick a type and flow, then click along the route. Start and end on existing roads to connect them.')
      : (app.tool === 'select' && !store.roads.length ? 'No roads yet: load the map or draw one.' : HINTS[app.tool]); });
  app.on('tool', () => { for (const [t, id] of Object.entries(TOOLS)) $(id).classList.toggle('on', app.tool === t); toolOpts(); app.emit('hint'); $('map').style.cursor = app.tool === 'select' ? 'grab' : 'crosshair'; });

  // ---------- selected: shared helpers ----------
  const same = r => store.roads.filter(x => x.name === r.name);
  const targets = r => app.applyAll ? same(r) : [r];
  const body = $('selBody');
  function focus() {
    const { road, node, hot } = app.sel;
    if (road) return { key: 'r' + road.id, ids: targets(road).map(r => r.id), label: app.applyAll && same(road).length > 1 ? 'all segments of this street' : 'this road' };
    if (node) { const ids = new Set(); node.in.concat(node.out).forEach(e => ids.add(e.road.id)); return { key: 'n' + node.key, ids: [...ids], label: 'the roads at this junction' }; }
    if (hot) { const H = sim.hot.find(x => x.h === hot), ids = new Set(); (H ? H.nodes : []).slice(0, 25).forEach(n => n.in.concat(n.out).forEach(e => ids.add(e.road.id))); return { key: 'h' + hot.id, ids: [...ids], label: 'the roads around this hotspot' }; }
    return null;
  }

  // ---------- selected: road ----------
  function selRoad() {
    const r = app.sel.road, n = same(r).length;
    body.dataset.scope = 'road';
    body.innerHTML = `<label>Name <input data-k="name" value="${esc(r.name)}"></label><label>Type <select data-k="type">${typeOpts(r.type)}</select></label>
      <div class="two"><label>Lanes each way <input data-k="lanes" type="number" min="1" max="4" value="${r.lanes}"></label><label>Speed limit km/h <input data-k="speed" type="number" min="5" max="100" value="${r.speed}"></label></div>
      <label>Flow direction <select data-k="dir">${dirOpts(r.dir)}</select></label>
      <label>Side friction: <b id="frv">${Math.round(r.friction * 100)}%</b> <input data-k="friction" type="range" min="0" max="100" value="${Math.round(r.friction * 100)}"></label>
      <small>Parking, market stalls, pedestrians. 100% slows everyone to half speed.</small>
      <b>Vehicles allowed on this road</b><div class="chips">${store.vehicles.map(y => `<label class="inl"><input type="checkbox" data-ban="${y.k}" ${(r.banned || []).includes(y.k) ? '' : 'checked'}><span class="dot" style="background:${y.c}"></span>${esc(y.n)}</label>`).join('')}</div>
      <label class="inl"><input type="checkbox" data-k="closed" ${r.closed ? 'checked' : ''}> Road closed (no traffic, shown dashed red)</label>
      ${n > 1 ? `<label class="inl"><input type="checkbox" id="applyAll" ${app.applyAll ? 'checked' : ''}> Apply to all ${n} segments named “${esc(r.name)}”</label>` : ''}
      <div class="info">Width about <b>${roadWidth(r).toFixed(1)} m</b> · length <b>${Math.round(store.length(r))} m</b></div>
      <div class="row"><button data-a="rev">Reverse flow</button><button data-a="split">Split road…</button><button data-a="del" class="danger">Delete road</button></div>`;
  }
  function roadChange(e) {
    const r = app.sel.road, t = e.target; if (!r) return;
    if (t.id === 'applyAll') { app.applyAll = t.checked; renderLive(); renderExp(); return; }
    if (t.dataset.k === 'name') { r.name = t.value.trim() || r.name; app.persist(); showSel(); return; }
    for (const x of targets(r)) {
      if (t.dataset.ban) { const set = new Set(x.banned || []); if (t.checked) set.delete(t.dataset.ban); else set.add(t.dataset.ban); x.banned = [...set]; continue; }
      const k = t.dataset.k;
      if (k === 'type') { const d = ROAD_TYPES[t.value]; x.type = t.value; x.lanes = d.lanes; x.speed = d.speed; }
      else if (k === 'lanes') x.lanes = clamp(+t.value || 1, 1, 4); else if (k === 'speed') x.speed = clamp(+t.value || 30, 5, 100); else if (k === 'dir') x.dir = t.value;
      else if (k === 'friction') x.friction = clamp(+t.value / 100, 0, 1); else if (k === 'closed') x.closed = t.checked;
    }
    app.changed(); showSel();
  }
  function roadClick(e) {
    const a = e.target.dataset.a, r = app.sel.road; if (!a || !r) return;
    if (a === 'del') app.deleteRoad(r);
    if (a === 'split') app.setTool('split');
    if (a === 'rev') { for (const x of targets(r)) { if (x.dir === 'fwd') x.dir = 'rev'; else if (x.dir === 'rev') x.dir = 'fwd'; } app.changed(); showSel(); }
  }

  // ---------- selected: junction / control point ----------
  function selNode() {
    const n = app.sel.node, J = store.junctions[n.key] || { ctrl: 'free' }, roads = new Map(), grp = [new Set(), new Set()];
    n.in.concat(n.out).forEach(e => roads.set(e.road.id, e.road.name)); n.in.forEach(e => grp[e.grp].add(e.road.name));
    body.dataset.scope = 'node';
    const num = (k, l, v, min = 0) => `<label>${l}<input data-j="${k}" type="number" min="${min}" value="${v}"></label>`;
    let h = `<label>Control <select data-j="ctrl">${Object.entries(CONTROLS).map(([k, v]) => `<option value="${k}" ${J.ctrl === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`;
    if (J.ctrl === 'stop' || J.ctrl === 'yield') h += `<label>Priority road (does not have to stop)<select data-j="major"><option value="">None: every approach ${J.ctrl === 'stop' ? 'stops' : 'gives way'}</option>${[...roads].map(([id, nm]) => `<option value="${id}" ${J.major == id ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</select></label><small>Others wait until no vehicle is close on the priority road.</small>`;
    if (J.ctrl === 'signal') h += `<div class="two">${num('gA', 'Green E–W (s)', J.gA || 20, 5)}${num('gB', 'Green N–S (s)', J.gB || 20, 5)}${num('allRed', 'All-red gap (s)', J.allRed ?? 3)}${num('offset', 'Cycle offset (s)', J.offset || 0)}</div>
      <small>E–W: ${[...grp[0]].map(esc).join(', ') || '—'}<br>N–S: ${[...grp[1]].map(esc).join(', ') || '—'}</small>`;
    if (J.ctrl === 'crossing') h += `<div class="two">${num('every', 'Pedestrians every (s)', J.every || 40, 10)}${num('dur', 'Crossing lasts (s)', J.dur || 8, 2)}</div>`;
    if (J.ctrl !== 'free') h += `<div class="two">${num('dh', 'Discharge gap (s, 0 = auto)', J.dh || 0)}<label>Active hours<span class="inl"><input type="time" data-j="from" value="${J.from || ''}"><input type="time" data-j="to" value="${J.to || ''}"></span></label></div><small>Leave hours empty for all day. Outside them the control is switched off.</small>`;
    const mv = []; const inn = new Map(), outn = new Map(); n.in.forEach(e => inn.set(e.road.id, e.road.name)); n.out.forEach(e => outn.set(e.road.id, e.road.name));
    inn.forEach((a, i) => outn.forEach((b, o) => { if (i !== o) mv.push([i + '>' + o, `${a} → ${b}`]); }));
    h += `<b>Banned turns</b>` + (mv.slice(0, 16).map(([id, t]) => `<label class="inl"><input type="checkbox" data-b="${id}" ${(J.bans || []).includes(id) ? 'checked' : ''}> ${esc(t)}</label>`).join('') || '<small>No turns here.</small>');
    h += `<div class="row">${store.junctions[n.key] ? '<button data-a="rmctl" class="danger">Remove control</button>' : ''}</div><div id="approach"></div>`;
    body.innerHTML = h;
  }
  function nodeChange(e) {
    const n = app.sel.node, t = e.target; if (!n) return;
    const J = store.junctions[n.key] = store.junctions[n.key] || defaultControl('free');
    if (t.dataset.b) { J.bans = J.bans || []; const i = J.bans.indexOf(t.dataset.b); if (t.checked && i < 0) J.bans.push(t.dataset.b); if (!t.checked && i >= 0) J.bans.splice(i, 1); }
    else if (t.dataset.j) { const f = t.dataset.j, d = defaultControl('free');
      if (f === 'ctrl') { J.ctrl = t.value; for (const k of ['gA', 'gB', 'allRed', 'offset', 'every', 'dur']) if (J[k] == null) J[k] = d[k]; }
      else if (f === 'from' || f === 'to') J[f] = t.value; else if (f === 'major') J.major = t.value === '' ? null : +t.value; else J[f] = Math.max(0, +t.value || 0); }
    app.junctionChanged(); showSel();
  }
  function nodeClick(e) { if (e.target.dataset.a === 'rmctl' && app.sel.node) { delete store.junctions[app.sel.node.key]; app.changed(); showSel(); } }

  // ---------- selected: hotspot ----------
  function selHot() {
    const h = app.sel.hot; body.dataset.scope = 'hot';
    body.innerHTML = `<label>Name <input data-h="name" value="${esc(h.name)}"></label>
      <label>Kind <select data-h="kind">${Object.entries(HOT_KINDS).map(([k, v]) => `<option value="${k}" ${h.kind === k ? 'selected' : ''}>${v.n}</option>`).join('')}</select></label>
      <label>What it does <select data-h="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${h.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Strength: <b id="hwv">${h.weight}</b> / 10 <input data-h="weight" type="range" min="1" max="10" value="${h.weight}"></label>
      <small>Strength 5 sends about 30% of all trips here, and adds some extra trips.</small>
      <div class="two"><label>Reach (m)<input data-h="radius" type="number" min="30" max="800" value="${h.radius}"></label><label>Active hours<span class="inl"><input type="time" data-h="from" value="${h.from}"><input type="time" data-h="to" value="${h.to}"></span></label></div>
      <div id="hotStats" class="info"></div><div class="row"><button data-a="del" class="danger">Remove hotspot</button></div>`;
  }
  function hotChange(e) {
    const h = app.sel.hot, t = e.target, k = t.dataset.h; if (!h || !k) return;
    if (k === 'name' || k === 'kind' || k === 'role' || k === 'from' || k === 'to') h[k] = t.value; else h[k] = clamp(+t.value || 1, k === 'weight' ? 1 : 30, k === 'weight' ? 10 : 800);
    app.hotChanged(); showSel();
  }

  function showSel() {
    const { road, node, hot } = app.sel; $('selTitle').textContent = road ? 'Selected: road' : node ? 'Selected: junction / control' : hot ? 'Selected: hotspot' : 'Selected';
    if (road) selRoad(); else if (node) selNode(); else if (hot) selHot(); else { body.dataset.scope = ''; body.innerHTML = '<small>Click a road, junction dot or hotspot pin on the map to edit it and see what traffic does there.</small>'; }
    renderLive(); renderExp(); tickSel();
    const can = !app.wb && (road || node || hot);
    $('wbOpen').innerHTML = can ? `<hr><b>Edit in a workbench</b><small>Opens just the area around this as a separate copy. Edits and tests only run there (lighter and faster), and nothing changes on the town map until you press Apply.</small>
      <div class="row"><label class="inl">Area radius <select id="wbR"><option value="300">300 m</option><option value="500" selected>500 m</option><option value="800">800 m</option></select></label><button id="wbGo" class="primary">Open workbench</button></div>` : '';
    if (can) $('wbGo').onclick = () => app.enterWorkbench(+$('wbR').value);
  }
  body.onchange = e => ({ road: roadChange, node: nodeChange, hot: hotChange })[body.dataset.scope]?.(e);
  body.onclick = e => { const sc = body.dataset.scope; if (sc === 'road') roadClick(e); else if (sc === 'node') nodeClick(e); else if (sc === 'hot' && e.target.dataset.a === 'del') app.deleteHotspot(app.sel.hot); };
  body.oninput = e => { if (e.target.dataset.k === 'friction') $('frv').textContent = e.target.value + '%'; if (e.target.dataset.h === 'weight') $('hwv').textContent = e.target.value; };

  // ---------- live view of the selected thing ----------
  const hist = { key: null, pts: [] };
  function renderLive() {
    const f = focus(); if (!f) { $('live').innerHTML = ''; hist.key = null; return; }
    $('live').innerHTML = `<hr><b>What is happening on ${f.label}</b><div id="liveNums" class="info"></div><canvas id="spark" width="300" height="84"></canvas>
      <small><span style="color:#ffb703">━</span> speed vs free flow &nbsp; <span style="color:#4cc9f0">━</span> vehicles (last 30 min)</small>`;
  }
  function sample() {
    const f = focus(); if (!f) { hist.key = null; return; }
    if (hist.key !== f.key) { hist.key = f.key; hist.pts = []; }
    const last = hist.pts[hist.pts.length - 1]; if (last && sim.T < last.t) hist.pts = []; else if (last && sim.T - last.t < 10) return;
    const sn = sim.snapshot(f.ids); hist.pts.push({ t: sim.T, n: sn.n, r: sn.ratio, pass: sn.pass }); if (hist.pts.length > 180) hist.pts.shift();
  }
  function tickSel() {
    const f = focus(); if (!f) return; sample(); const el = $('liveNums'); if (!el) return;
    const sn = sim.snapshot(f.ids), [L, name, col] = los(sn.ratio), p = hist.pts;
    let flow = ''; if (p.length > 1) { const a = p.find(x => x.t >= p[p.length - 1].t - 600) || p[0], b = p[p.length - 1]; if (b.t - a.t >= 60) flow = ` · flow <b>${Math.round(Math.max(0, b.pass - a.pass) / (b.t - a.t) * 3600)}</b> veh/h`; }
    el.innerHTML = sn.n ? `<div><span class="los" style="background:${col}">${L}</span> <b>${name}</b></div>
      <div><b>${sn.n}</b> vehicles now · avg speed <b>${Math.round(sn.speed)}</b> km/h (free flow about ${Math.round(sn.limit)}) · stopped <b>${sn.stopped}</b>${flow}</div>
      <div>${Object.entries(sn.byType).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</div>` : `<div>No vehicles right now${app.sel.road && app.sel.road.closed ? ' (road is closed)' : ''}.</div>`;
    // approach queues at a junction
    const ap = $('approach'), n = app.sel.node;
    if (ap && n) ap.innerHTML = '<hr><b>Queues at this junction</b>' + (n.in.map(e => { let q = 0, c = 0; for (const ln of e.ln) for (const v of ln) { c++; if (v.v < 1 && v.s > e.len - 80) q++; } return `<div class="wr"><span>${esc(e.road.name)}</span><small>${q} waiting · ${c} on approach</small></div>`; }).join('') || '<small>No incoming roads.</small>');
    const hs = $('hotStats'), h = app.sel.hot;
    if (hs && h) { const st = sim.hstat[h.id], H = sim.hot.find(x => x.h === h), on = sim.hotAct.some(x => x.h === h);
      hs.innerHTML = `${on ? '<b style="color:#38c172">Active now</b>' : '<b>Outside its active hours</b>'} · ${H ? H.nodes.length : 0} access points in reach<br>Trips started: <b>${st ? st.started : 0}</b> · finished: <b>${st ? st.n : 0}</b>${st && st.n ? ` · avg delay <b>${Math.round(st.dsum / st.n)}</b> s` : ''}`; }
    drawSpark();
  }
  function drawSpark() {
    const cv = $('spark'); if (!cv) return; const c = cv.getContext('2d'), W = cv.width, H = cv.height, p = hist.pts; c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(128,140,150,.35)'; c.lineWidth = 1; for (const y of [.25, .5, .75]) { c.beginPath(); c.moveTo(0, H * y); c.lineTo(W, H * y); c.stroke(); }
    if (p.length < 2) { c.fillStyle = '#93a6b6'; c.font = '11px system-ui'; c.fillText('collecting…', 8, 16); return; }
    const mx = Math.max(5, ...p.map(q => q.n)), X = i => i / 179 * W; const off = 180 - p.length;
    const line = (fn, col) => { c.beginPath(); p.forEach((q, i) => { const x = X(i + off), y = fn(q); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); };
    line(q => 4 + (1 - q.n / mx) * (H - 8), '#4cc9f0'); line(q => 4 + (1 - q.r) * (H - 8), '#ffb703');
  }

  // ---------- before / after experiment ----------
  const exps = {};
  const ROWS = [['Average speed (km/h)', 'speed', 1, 0], ['Time stopped (%)', 'stopped', -1, 0], ['Vehicles per hour', 'flow', 0, 0], ['Time lost here (veh·min)', 'loss', -1, 0], ['Trips finished (town)', 'trips', 1, 0], ['Avg trip delay (town, s)', 'delay', -1, 0]];
  const fm = v => v == null ? '–' : Math.abs(v) >= 100 ? Math.round(v) : (Math.round(v * 10) / 10);
  function renderExp() {
    const f = focus(); if (!f) { $('exp').innerHTML = ''; return; } const E = exps[f.key] || {};
    let t = '';
    if (E.base) {
      t = `<table class="cmp"><tr><th></th><th>Baseline</th>${E.last ? '<th>Now</th><th>Change</th>' : ''}</tr>` + ROWS.map(([l, k, good]) => {
        const a = E.base[k], b = E.last ? E.last[k] : null; let ch = '';
        if (E.last && a != null && b != null) { const d = b - a, pc = a ? d / Math.abs(a) * 100 : 0, better = good === 0 ? null : (d * good > 0), col = Math.abs(pc) < 3 || better == null ? 'var(--mu)' : better ? '#2ecc71' : '#e74c3c'; ch = `<td style="color:${col}">${d > 0 ? '+' : ''}${fm(d)} (${pc > 0 ? '+' : ''}${Math.round(pc)}%)</td>`; } else if (E.last) ch = '<td>–</td>';
        return `<tr><td>${l}</td><td>${fm(a)}</td>${E.last ? `<td>${fm(b)}</td>${ch}` : ''}</tr>`; }).join('') + '</table>';
    }
    $('exp').innerHTML = `<hr><b>Test what your change does</b><small>Runs 10 simulated minutes of identical traffic. 1) Run a baseline. 2) Change the road, junction, hotspot… 3) Run again and compare.</small>
      <div class="row"><button id="xRun" class="primary">${E.base ? 'Run test again' : 'Run baseline test'}</button>${E.last ? '<button id="xKeep">Use this as new baseline</button>' : ''}${E.base ? '<button id="xReset">Reset</button>' : ''}</div><div id="xOut">${t}</div>`;
    $('xRun').onclick = async () => {
      const ff = focus(); $('xRun').disabled = true; $('xOut').innerHTML = '<small>Running 10 simulated minutes…</small>';
      const res = await Analyze.measure(sim, ff.ids); app.rebuild(); const X = exps[ff.key] = exps[ff.key] || {};
      if (!X.base) X.base = res; else X.last = res; renderExp(); };
    if ($('xKeep')) $('xKeep').onclick = () => { E.base = E.last; E.last = null; renderExp(); };
    if ($('xReset')) $('xReset').onclick = () => { delete exps[f.key]; renderExp(); };
  }

  // ---------- hotspot list ----------
  function showHotList() {
    $('hotList').innerHTML = store.hotspots.map(h => `<div class="wr" data-h="${h.id}"><span><span class="dot" style="background:${(HOT_KINDS[h.kind] || HOT_KINDS.other).c}"></span>${esc(h.name)}</span><small>${h.role === 'dest' ? 'attracts' : h.role === 'origin' ? 'generates' : 'both'} · ${h.weight}/10</small></div>`).join('')
      || '<small>No hotspots yet. Use “Pin hotspot”, then click the map where a school, market or terminal is.</small>';
  }
  $('hotList').onclick = e => { const el = e.target.closest('[data-h]'); if (!el) return; const h = store.hotspots.find(x => x.id == el.dataset.h); if (h) { app.select({ hot: h }); app.view.cx = h.xy[0]; app.view.cy = h.xy[1]; if (app.view.scale < .3) app.view.scale = .3; } };

  // ---------- traffic ----------
  $('day').onchange = () => { store.day = $('day').value; app.persist(); };
  $('tl').onchange = () => { sim.clock.start = +$('tl').value * 60 - sim.T; app.rebuild(); };
  $('load').oninput = () => { sim.params.load = +$('load').value; };
  const dc = $('dem'), dx = dc.getContext('2d'); let dn = false;
  const drawDem = () => { dx.clearRect(0, 0, 280, 70); const w = 280 / 24, h = Math.floor(sim.clock.hour(sim.T)); store.demand.forEach((v, i) => { dx.fillStyle = i === h ? '#ffb703' : '#4cc9f0'; dx.fillRect(i * w + 1, 70 - v * 66, w - 2, v * 66); }); };
  const setv = e => { const r = dc.getBoundingClientRect(), i = clamp(Math.floor((e.clientX - r.left) / r.width * 24), 0, 23); store.demand[i] = Math.round(clamp((r.bottom - e.clientY) / r.height, 0, 1) * 20) / 20; };
  dc.onpointerdown = e => { dn = true; dc.setPointerCapture(e.pointerId); setv(e); }; dc.onpointermove = e => { if (dn) setv(e); }; dc.onpointerup = () => { dn = false; app.persist(); };
  $('bPlay').onclick = () => { sim.run = !sim.run; $('bPlay').textContent = sim.run ? 'Pause' : 'Play'; $('bPlay').classList.toggle('on', sim.run); };
  const legend = () => { $('vleg').innerHTML = store.vehicles.map(y => `<div><span class="dot" style="background:${y.c}"></span>${esc(y.n)}</div>`).join(''); };
  function showMix() {
    $('mix').innerHTML = store.vehicles.map(y => `<label class="mixrow"><span class="dot" style="background:${y.c}"></span>${esc(y.n)} <input type="range" min="0" max="100" value="${y.w}" data-m="${y.k}"></label>`).join(''); legend();
  }
  $('mix').oninput = e => { const y = store.vehicles.find(v => v.k === e.target.dataset.m); if (y) y.w = +e.target.value; };
  $('mix').onchange = () => app.persist();

  // ---------- driver tendencies ----------
  const FIELDS = [['tau', 'Following gap (s)', .1], ['f', 'Speed vs limit ×', .05], ['acc', 'Acceleration m/s²', .1], ['aggr', 'Aggressiveness 0–1', .05], ['avoid', 'Avoids jams 0–1', .05], ['spread', 'Driver variety 0–1', .05], ['dwellP', 'Stops per km', .1], ['dwell', 'Stop time (s)', 1], ['L', 'Length (m)', .5]];
  function showDrivers() {
    $('drv').innerHTML = store.vehicles.map(y => `<div class="drow"><div class="dhead"><input type="color" data-v="${y.k}" data-p="c" value="${y.c}"><input data-v="${y.k}" data-p="n" value="${esc(y.n)}" class="nm">${store.vehicles.length > 1 ? `<button data-del="${y.k}" title="Remove type">✕</button>` : ''}</div>` +
      FIELDS.map(([p, l, s]) => `<label>${l}<input data-v="${y.k}" data-p="${p}" type="number" step="${s}" value="${y[p]}"></label>`).join('') + '</div>').join('');
  }
  $('drv').onchange = e => {
    const t = e.target, y = store.vehicles.find(v => v.k === t.dataset.v);
    if (t.dataset.del) { const k = t.dataset.del; store.vehicles = store.vehicles.filter(v => v.k !== k); store.rules = store.rules.filter(r => r.v !== k); app.rebuild(); showDrivers(); showMix(); fillRules(); app.persist(); return; }
    if (!y) return; const p = t.dataset.p;
    if (p === 'n' || p === 'c') y[p] = t.value; else y[p] = Math.max(0, +t.value || 0);
    if (['aggr', 'avoid', 'spread'].includes(p)) y[p] = clamp(y[p], 0, 1);
    app.persist(); showMix(); fillRules();
  };
  $('bAddType').onclick = () => { const base = DEFAULT_VEHICLES[2], k = 'v' + Date.now().toString(36); store.vehicles.push({ ...base, k, n: 'New type', c: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'), w: 10 }); showDrivers(); showMix(); fillRules(); app.persist(); };

  // ---------- rules ----------
  function fillRules() {
    $('rv').innerHTML = '<option value="all">All vehicles</option>' + store.vehicles.map(y => `<option value="${y.k}">${esc(y.n)}</option>`).join('');
    const cur = app.sel.road; $('rr').innerHTML = '<option value="all">Any road</option>' + Object.entries(ROAD_TYPES).map(([k, t]) => `<option value="type:${k}">All ${t.label.toLowerCase()}s</option>`).join('') + (cur ? `<option value="${cur.id}">Selected: ${esc(cur.name)}</option>` : '');
    showRules();
  }
  const roadName = x => x === 'all' ? 'any road' : String(x).startsWith('type:') ? 'all ' + ROAD_TYPES[x.slice(5)].label.toLowerCase() + 's' : (store.roads.find(r => r.id == x) || { name: 'a deleted road' }).name;
  function showRules() {
    $('rlist').innerHTML = store.rules.map((r, i) => { const v = r.v === 'all' ? 'vehicles' : ((store.vehicles.find(y => y.k === r.v) || { n: '?' }).n.toLowerCase() + 's');
      return `<div>${r.a === 'ban' ? 'No ' + esc(v) + ' on' : 'Max ' + r.val + ' km/h on'} ${esc(roadName(r.r))}, ${r.from}–${r.to} <button data-d="${i}">✕</button></div>`; }).join('') || '<small>No rules yet.</small>';
  }
  $('ra').onchange = () => { $('rval').hidden = $('ra').value !== 'cap'; };
  $('rAdd').onclick = () => { store.rules.push({ v: $('rv').value, r: $('rr').value, a: $('ra').value, val: +$('rval').value || 20, from: $('rf').value || '00:00', to: $('rt').value || '23:59' }); sim.refreshRules(); sim.router.cache.clear(); app.persist(); showRules(); };
  $('rlist').onclick = e => { const i = e.target.dataset.d; if (i == null) return; store.rules.splice(+i, 1); sim.refreshRules(); sim.router.cache.clear(); app.persist(); showRules(); };

  // ---------- town-wide efficiency ----------
  $('bMark').onclick = () => { Analyze.base = sim.avgD; };
  $('bSug').onclick = () => Analyze.suggest(sim, (t, html) => { $('sugg')[html ? 'innerHTML' : 'textContent'] = t; }, () => app.rebuild());
  $('sugg').onclick = e => { if (e.target.id === 'bApply' && Analyze.last) { Analyze.last.ap(); Analyze.last = null; $('sugg').textContent = 'Applied.'; app.changed(); } };
  $('worst').onclick = e => { const id = e.target.closest('[data-r]'); if (!id) return; const r = store.roads.find(x => x.id == id.dataset.r); if (r) { app.select({ road: r }); app.view.fit(r._bb, .5); } };

  // ---------- selected driver ----------
  function showVeh() {
    const v = app.sel.veh, el = $('veh'); if (!v) { el.innerHTML = '<small>Click a dot on the map to follow one driver.</small>'; return; }
    $('sV').open = true;
    el.innerHTML = `<div><span class="dot" style="background:${v.c}"></span><b>${esc(v.ty.n)}</b> #${v.id}</div><div id="vInfo"></div><div class="row"><label class="inl"><input type="checkbox" id="vFollow" ${app.follow ? 'checked' : ''}> Follow on map</label></div>`;
    $('vFollow').onchange = () => { app.follow = $('vFollow').checked; };
  }
  function tickVeh() {
    const v = app.sel.veh, el = $('vInfo'); if (!v || !el) return; const e = v.p[v.i], left = v.p.slice(v.i).reduce((a, x) => a + x.len, 0) - v.s;
    el.innerHTML = `<div class="info">Speed <b>${Math.round(v.v * 3.6)}</b> km/h · now on <b>${esc(e.road.name)}</b><br>Aggressiveness <b>${v.aggr.toFixed(2)}</b> · gap <b>${v.tau.toFixed(2)} s</b> · drives at <b>${Math.round(v.f * 100)}%</b> of limit<br>${v.avoid ? 'Re-routes around jams' : 'Sticks to the planned route'} · about <b>${Math.round(left)} m</b> to go${v.w != null ? '<br>Stopped to load passengers' : ''}${v.hot ? '<br>Trip to/from a hotspot' : ''}</div>`;
  }

  // ---------- header buttons ----------
  const dl = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); };
  $('bSave').onclick = () => app.locked() || dl('roadlens-project.json', JSON.stringify(store.pack()));
  $('bGeo').onclick = () => app.locked() || dl('roadlens-roads.geojson', JSON.stringify(store.geojson()));
  $('bLoad').onclick = () => { if (!app.locked()) $('fi').click(); };
  $('fi').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const what = store.fromText(await f.text()); app.afterLoad(); status('Loaded ' + what + '.'); } catch (x) { status('Could not read that file: ' + x.message); } e.target.value = ''; };

  // ---------- refresh hooks ----------
  const refreshAll = () => { $('day').value = store.day; $('load').value = sim.params.load; showMix(); showDrivers(); fillRules(); showVeh(); showHotList(); showSel(); $('mapName').textContent = store.name; $('tl').value = Math.floor(sim.clock.now(sim.T) / 900) * 15; app.emit('hint'); };
  app.on('select', () => { showSel(); showVeh(); fillRules(); if (app.sel.road || app.sel.node || app.sel.hot) $('sSel').open = true; });
  app.on('hotspots', () => { showHotList(); });
  app.on('dataset', refreshAll);
  let lastWorst = '', ticks = 0;
  app.on('tick', () => {
    $('clk').textContent = sim.clock.fmt(sim.T); if (document.activeElement !== $('tl')) $('tl').value = Math.floor(sim.clock.now(sim.T) / 900) * 15; drawDem();
    const r = sim.avgR; $('mood').textContent = r == null || r < 1.3 ? '😀' : r < 1.8 ? '😐' : '😡';
    $('delay').textContent = sim.avgD == null ? 'Measuring…' : `Average delay ${Math.round(sim.avgD)} s per trip` + (Analyze.base != null ? ` (marked original: ${Math.round(Analyze.base)} s)` : '');
    $('stats').textContent = `${store.roads.length} roads · ${store.buildings.length} buildings · ${sim.nv} vehicles on the map`;
    const w = sim.worstRoads(6), sig = w.map(x => x.road.id + ':' + Math.round(x.loss / 10)).join('|');
    if (sig !== lastWorst) { lastWorst = sig; $('worst').innerHTML = w.length ? w.map(x => `<div class="wr" data-r="${x.road.id}"><span>${esc(x.road.name)}</span><small>${Math.round(x.loss / 60)} veh·min lost</small></div>`).join('') : '<small>No slow spots yet.</small>'; }
    tickVeh(); if (!(ticks++ % 2)) tickSel();
  });
  app.setTool('select'); refreshAll();
}
