// Road classes, vehicle types and demand defaults. Everything here is a starting assumption
// that can be edited inside the app. Replace with your own observations when you have them.

export const LANE_W = 3.3; // metres per lane

// minPx = thinnest the road is ever drawn (so far-away roads stay visible), rank = draw order (higher on top)
export const ROAD_TYPES = {
  highway:     { label: 'Highway',             lanes: 2, speed: 60, color: '#ff9f43', median: 0, minPx: 5,   rank: 5, osm: ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'] },
  boulevard:   { label: 'Boulevard (divided)', lanes: 2, speed: 50, color: '#feca57', median: 4, minPx: 4.5, rank: 4, osm: ['secondary', 'secondary_link'] },
  street:      { label: 'Street / collector',  lanes: 1, speed: 40, color: '#48dbfb', median: 0, minPx: 3.8, rank: 3, osm: ['tertiary', 'tertiary_link'] },
  residential: { label: 'Residential road',    lanes: 1, speed: 30, color: '#a29bfe', median: 0, minPx: 3,   rank: 2, osm: ['residential', 'unclassified'] },
  lane:        { label: 'Barangay lane',       lanes: 1, speed: 15, color: '#8395a7', median: 0, minPx: 2.2, rank: 1, osm: ['living_street', 'service'] }
};

// Driver profile per vehicle type. Each individual driver is sampled around these numbers.
//  tau      following gap in seconds (bigger = leaves more space)
//  f        share of the speed limit this type normally drives at
//  acc      acceleration, m/s2
//  aggr     0 = timid, 1 = aggressive: shorter gaps, faster, quicker acceleration
//  avoid    0..1 chance a driver re-routes around jams
//  spread   0..1 how different individual drivers are from the type average
//  dwellP   stops per km to load or unload passengers; dwell = seconds the stop blocks the lane
//  w        share of traffic (relative weight)
export const DEFAULT_VEHICLES = [
  { k: 'mo', n: 'Motorcycle', L: 2,   c: '#2f9bff', w: 35, tau: .9,  f: .95, acc: 3.2, aggr: .65, avoid: .5, spread: .4, dwellP: 0,   dwell: 0 },
  { k: 'tr', n: 'Tricycle',   L: 3,   c: '#ff2fd0', w: 20, tau: 1.2, f: .7,  acc: 2,   aggr: .5,  avoid: .2, spread: .3, dwellP: 1.5, dwell: 20 },
  { k: 'ca', n: 'Car',        L: 4.5, c: '#ffffff', w: 30, tau: 1.3, f: 1,   acc: 2.5, aggr: .45, avoid: .4, spread: .3, dwellP: 0,   dwell: 0 },
  { k: 'jp', n: 'Jeepney',    L: 7,   c: '#b46cff', w: 8,  tau: 1.5, f: .85, acc: 1.6, aggr: .6,  avoid: .1, spread: .3, dwellP: 3,   dwell: 15 },
  { k: 'tk', n: 'Truck',      L: 9,   c: '#c68642', w: 7,  tau: 1.6, f: .8,  acc: 1.2, aggr: .3,  avoid: .2, spread: .2, dwellP: 0,   dwell: 0 }
];

export const DAY_TYPES = { school: { n: 'School day', m: 1 }, weekend: { n: 'Weekend', m: .65 }, market: { n: 'Market day', m: 1.2 } };
export const DEFAULT_DEMAND = [.1, .05, .05, .05, .1, .3, .7, 1, 1, .7, .5, .5, .7, .7, .5, .5, .6, .9, 1, .8, .5, .3, .2, .1];

// Congestion colours: speed ratio -> green (free), yellow (slowing), red (jammed)
export const HEAT = { green: 120, yellow: 55, red: 0 }; // hues

// Hotspots: pinned places that pull trips in (role dest), push them out (origin) or both. weight 1..10.
export const HOT_KINDS = {
  school:   { n: 'School',                 c: '#ffd166', role: 'both', weight: 6, from: '06:30', to: '17:30' },
  market:   { n: 'Market',                 c: '#ff7f50', role: 'dest', weight: 7, from: '05:00', to: '17:00' },
  terminal: { n: 'Terminal / jeepney stop', c: '#4cc9f0', role: 'both', weight: 8, from: '04:00', to: '21:00' },
  hospital: { n: 'Hospital',               c: '#ff5c8a', role: 'both', weight: 4, from: '00:00', to: '23:59' },
  church:   { n: 'Church',                 c: '#c77dff', role: 'dest', weight: 5, from: '05:00', to: '09:00' },
  office:   { n: 'Office / capitol',       c: '#90be6d', role: 'dest', weight: 5, from: '07:00', to: '18:00' },
  other:    { n: 'Other',                  c: '#f8f9fa', role: 'both', weight: 5, from: '00:00', to: '23:59' }
};
export const CONTROLS = { free: 'Free flow', yield: 'Yield / give way', stop: 'Stop sign', signal: 'Traffic light', crossing: 'Pedestrian crossing' };
export const CTRL_COLOR = { free: '#ffffff', yield: '#ffb703', stop: '#ff5c5c', signal: '#38c172', crossing: '#4cc9f0' };
export const defaultControl = ctrl => ({ ctrl, gA: 20, gB: 20, allRed: 3, offset: 0, every: 40, dur: 8, major: null });
