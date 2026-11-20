export type RoadTypeKey = 'highway' | 'boulevard' | 'street' | 'residential' | 'lane';
export type RoadDir = 'both' | 'fwd' | 'rev';
export type ControlType = 'free' | 'yield' | 'stop' | 'signal' | 'crossing';
export type ApproachPriority = 'prio' | 'yield' | 'stop';
export type TurnMove = 'L' | 'S' | 'R';
export type HotspotKindKey =
  | 'school'
  | 'out_of_town'
  | 'market'
  | 'terminal'
  | 'hospital'
  | 'church'
  | 'office'
  | 'other';
export type HotspotRole = 'dest' | 'origin' | 'both';
export type DayTypeKey = 'school' | 'weekend' | 'market';
export type ToolMode = 'select' | 'draw' | 'hotspot' | 'point' | 'split' | 'delete';

export interface Road {
  id: number;
  osm?: number;
  name: string;
  type: RoadTypeKey;
  lanes: number;
  lanesR?: number;
  speed: number;
  dir: RoadDir;
  pts: [number, number][];
  closed?: boolean;
  friction?: number;
  banned?: string[];
  _xy?: [number, number][];
  _bb?: [number, number, number, number];
}

export interface SignalPhase {
  dur: number;
  clear: number;
  allow: string[];
}

export interface JunctionConfig {
  ctrl: ControlType;
  gA?: number;
  gB?: number;
  allRed?: number;
  offset?: number;
  every?: number;
  dur?: number;
  dh?: number;
  from?: string;
  to?: string;
  major?: number | string | null;
  bans?: string[];
  lanes?: Record<string, TurnMove[][]>;
  appr?: Record<string, ApproachPriority>;
  phases?: SignalPhase[];
}

export interface Hotspot {
  id: number;
  name: string;
  kind: HotspotKindKey;
  role: HotspotRole;
  weight: number;
  /** Relative trip priority 0..100: controls where most people choose to go across active hotspots */
  priority: number;
  radius: number;
  from: string;
  to: string;
  ll: [number, number];
  xy: [number, number];
}

export interface VehicleType {
  k: string;
  n: string;
  L: number;
  c: string;
  w: number;
  tau: number;
  f: number;
  acc: number;
  aggr: number;
  avoid: number;
  spread: number;
  dwellP: number;
  dwell: number;
}

export interface TrafficRule {
  v: string;
  r: string | number;
  a: 'ban' | 'cap';
  val?: number;
  from: string;
  to: string;
}

export interface EditorProblem {
  id: string;
  severity: 'warn' | 'error';
  message: string;
  nodeKey?: string;
  roadId?: number;
  xy?: [number, number];
}

export interface LayerOptions {
  buildings: boolean;
  junctions: boolean;
  labels: boolean;
  arrows: boolean;
  mode: 'heat' | 'type';
}
