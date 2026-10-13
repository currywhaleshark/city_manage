export type DirectionMode = 'two-way' | 'one-way';
export type SignalPhase = 'ns-green' | 'ns-yellow' | 'ew-green' | 'ew-yellow';
export type SignalPattern = 'alternating' | 'north-south-priority' | 'east-west-priority';
export type NodeType = 'dead-end' | 'straight' | 't' | 'cross';

export interface Vec2 {
  x: number;
  z: number;
}

export interface RoadSegment {
  id: string;
  startNodeId: string;
  endNodeId: string;
  laneCount: number;
  direction: DirectionMode;
  length: number;
  congestionLevel: number;
  vehicleIds: string[];
  stoppedCount: number;
}

export interface IntersectionNode {
  id: string;
  position: Vec2;
  connectedRoadIds: string[];
  signalId?: string;
  type: NodeType;
}

export interface TrafficSignal {
  id: string;
  intersectionId: string;
  phase: SignalPhase;
  greenDuration: number;
  yellowDuration: number;
  redDuration: number;
  currentTimer: number;
  pattern: SignalPattern;
  offset: number;
}

export interface Vehicle {
  id: string;
  currentRoadId: string;
  route: string[];
  positionAlongRoad: number;
  speed: number;
  targetSpeed: number;
  waitingTime: number;
  tripStartTime: number;
  destinationNodeId: string;
  fromNodeId: string;
  toNodeId: string;
  color: number;
  length: number;
  lane: number;
  turnBlend: number;
}

export interface Pedestrian {
  id: string;
  nodeId: string;
  phase: number;
  speed: number;
}

export interface SimulationStats {
  averageTravelTime: number;
  averageWaitingTime: number;
  throughput: number;
  congestionLength: number;
  averageSpeed: number;
  currentVehicleCount: number;
  stoppedVehicleCount: number;
  fps: number;
}

export interface SnapshotComparison {
  averageTravelTime: number;
  averageWaitingTime: number;
  throughput: number;
  congestionLength: number;
  averageSpeed: number;
}
