import type { ControlType, DayTypeKey, HotspotKindKey, HotspotRole, JunctionConfig, RoadTypeKey, VehicleType } from './types';

export const LANE_W = 3.3; // metres per lane

export interface RoadTypeDef {
  label: string;
  lanes: number;
  speed: number;
  color: string;
  median: number;
  minPx: number;
  rank: number;
  osm: string[];
}

export const ROAD_TYPES: Record<RoadTypeKey, RoadTypeDef> = {
  highway:     { label: 'Highway',             lanes: 2, speed: 60, color: '#ff9f43', median: 0, minPx: 5,   rank: 5, osm: ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'] },
  boulevard:   { label: 'Boulevard (divided)', lanes: 2, speed: 50, color: '#feca57', median: 4, minPx: 4.5, rank: 4, osm: ['secondary', 'secondary_link'] },
  street:      { label: 'Street / collector',  lanes: 1, speed: 40, color: '#48dbfb', median: 0, minPx: 3.8, rank: 3, osm: ['tertiary', 'tertiary_link'] },
  residential: { label: 'Residential road',    lanes: 1, speed: 30, color: '#a29bfe', median: 0, minPx: 3,   rank: 2, osm: ['residential', 'unclassified'] },
  lane:        { label: 'Barangay lane',       lanes: 1, speed: 15, color: '#8395a7', median: 0, minPx: 2.2, rank: 1, osm: ['living_street', 'service'] },
};

export const DEFAULT_VEHICLES: VehicleType[] = [
  { k: 'mo', n: 'Motorcycle', L: 2,   c: '#2f9bff', w: 35, tau: 0.9, f: 0.95, acc: 3.2, aggr: 0.65, avoid: 0.5, spread: 0.4, dwellP: 0,   dwell: 0 },
  { k: 'tr', n: 'Tricycle',   L: 3,   c: '#ff2fd0', w: 20, tau: 1.2, f: 0.7,  acc: 2,   aggr: 0.5,  avoid: 0.2, spread: 0.3, dwellP: 1.5, dwell: 20 },
  { k: 'ca', n: 'Car',        L: 4.5, c: '#ffffff', w: 30, tau: 1.3, f: 1,    acc: 2.5, aggr: 0.45, avoid: 0.4, spread: 0.3, dwellP: 0,   dwell: 0 },
  { k: 'jp', n: 'Jeepney',    L: 7,   c: '#b46cff', w: 8,  tau: 1.5, f: 0.85, acc: 1.6, aggr: 0.6,  avoid: 0.1, spread: 0.3, dwellP: 3,   dwell: 15 },
  { k: 'tk', n: 'Truck',      L: 9,   c: '#c68642', w: 7,  tau: 1.6, f: 0.8,  acc: 1.2, aggr: 0.3,  avoid: 0.2, spread: 0.2, dwellP: 0,   dwell: 0 },
];

export const DAY_TYPES: Record<DayTypeKey, { n: string; m: number }> = {
  school: { n: 'School day', m: 1 },
  weekend: { n: 'Weekend', m: 0.65 },
  market: { n: 'Market day', m: 1.2 },
};

export const DEFAULT_DEMAND: number[] = [
  0.1, 0.05, 0.05, 0.05, 0.1, 0.3, 0.7, 1, 1, 0.7, 0.5, 0.5,
  0.7, 0.7, 0.5, 0.5, 0.6, 0.9, 1, 0.8, 0.5, 0.3, 0.2, 0.1,
];

export const HEAT = { green: 120, yellow: 55, red: 0 };

export interface HotspotKindDef {
  n: string;
  c: string;
  role: HotspotRole;
  weight: number;
  priority: number;
  from: string;
  to: string;
}

export const HOT_KINDS: Record<HotspotKindKey, HotspotKindDef> = {
  school:      { n: 'School',                    c: '#ffd166', role: 'both', weight: 6, priority: 75, from: '06:30', to: '17:30' },
  out_of_town: { n: 'Out of town (highway exit)', c: '#38bdf8', role: 'both', weight: 7, priority: 65, from: '00:00', to: '23:59' },
  market:      { n: 'Market',                    c: '#ff7f50', role: 'dest', weight: 7, priority: 65, from: '05:00', to: '17:00' },
  terminal:    { n: 'Terminal / jeepney stop',   c: '#4cc9f0', role: 'both', weight: 8, priority: 70, from: '04:00', to: '21:00' },
  hospital:    { n: 'Hospital',                  c: '#ff5c8a', role: 'both', weight: 4, priority: 20, from: '00:00', to: '23:59' },
  church:      { n: 'Church',                    c: '#c77dff', role: 'dest', weight: 5, priority: 30, from: '05:00', to: '09:00' },
  office:      { n: 'Office / capitol',          c: '#90be6d', role: 'dest', weight: 5, priority: 55, from: '07:00', to: '18:00' },
  other:       { n: 'Other',                     c: '#f8f9fa', role: 'both', weight: 5, priority: 50, from: '00:00', to: '23:59' },
};

export const CONTROLS: Record<ControlType, string> = {
  free: 'Free flow',
  yield: 'Yield / give way',
  stop: 'Stop sign',
  signal: 'Traffic light',
  crossing: 'Pedestrian crossing',
};

export const CTRL_COLOR: Record<ControlType, string> = {
  free: '#ffffff',
  yield: '#ffb703',
  stop: '#ff5c5c',
  signal: '#38c172',
  crossing: '#4cc9f0',
};

export const defaultControl = (ctrl: ControlType): JunctionConfig => ({
  ctrl,
  gA: 20,
  gB: 20,
  allRed: 3,
  offset: 0,
  every: 40,
  dur: 8,
  major: null,
});
