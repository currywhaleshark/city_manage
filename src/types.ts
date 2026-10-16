export interface Vec2 {
  x: number;
  z: number;
}
export type Axis = "ns" | "ew";
export type Turn = "left" | "straight" | "right";
export type SignalPhase =
  | "ns-green"
  | "ns-yellow"
  | "ew-green"
  | "ew-yellow"
  | "pedestrian-green"
  | "pedestrian-clearance"
  | "all-red";
export interface TrafficSignal {
  ns: number;
  ew: number;
  yellow: number;
  clearance: number;
  offset: number;
  walk?: number;
  walkClearance?: number;
}
export interface IntersectionNode {
  id: string;
  position: Vec2;
  connectedRoadIds: string[];
  signal: TrafficSignal;
  /** Open city border: straight traffic passes freely and ordinary trips start/end here. */
  boundary?: boolean;
}
export interface RoadSegment {
  id: string;
  name: string;
  startNodeId: string;
  endNodeId: string;
  direction: "two-way" | "one-way";
  laneCount: number;
  length: number;
  speedLimit: number;
  bypass?: boolean;
}
export interface Lane {
  id: string;
  roadId: string;
  from: string;
  to: string;
  index: number;
  start: Vec2;
  end: Vec2;
  length: number;
  axis: Axis;
  turns: readonly Turn[];
}
export interface Network {
  nodes: Map<string, IntersectionNode>;
  roads: Map<string, RoadSegment>;
  lanes: Map<string, Lane>;
  outgoing: Map<string, Lane[]>;
}
export interface Trip {
  id: number;
  departAt: number;
  origin: string;
  destination: string;
  purpose: "school" | "work" | "home";
  targetSpeed: number;
  color: number;
}
export interface Pose extends Vec2 {
  angle: number;
}
export interface Crossing {
  nodeId: string;
  fromLaneId: string;
  nextLaneId: string;
  points: [Vec2, Vec2, Vec2, Vec2];
  progress: number;
  length: number;
  distance: number;
  arcLengths: readonly number[];
  speedLimit: number;
}
export interface Vehicle {
  id: number;
  trip: Trip;
  laneId: string;
  route: string[];
  routeIndex: number;
  s: number;
  speed: number;
  acceleration: number;
  maxAccel: number;
  comfortBrake: number;
  safetyGap: number;
  headway: number;
  waitingTime: number;
  enteredAt: number;
  crossing?: Crossing;
  laneChange?: {
    fromLaneId: string;
    toLaneId: string;
    startS: number;
    length: number;
    reason: "route" | "flow";
  };
  lastLaneChangeAt?: number;
  pose: Pose;
  previousPose: Pose;
}
export interface CompletedTrip {
  id: number;
  travelTime: number;
  waitingTime: number;
  purpose: Trip["purpose"];
}
export interface RoadMetric {
  id: string;
  name: string;
  count: number;
  stopped: number;
  meanSpeed: number;
  congestion: number;
}
export interface SimulationStats {
  time: number;
  arrived: number;
  active: number;
  queued: number;
  unreleased: number;
  unreachable: number;
  averageTravelTime: number | null;
  averageWaitingTime: number | null;
  averageDemandWait: number | null;
  stopped: number;
  meanSpeed: number;
  totalWaitingTime: number;
  roads: RoadMetric[];
}
export interface PolicySelection {
  signal: boolean;
  bypass: boolean;
  oneWay: boolean;
  ewGreen: number;
}
