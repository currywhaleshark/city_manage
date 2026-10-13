import type {
  DirectionMode,
  IntersectionNode,
  Pedestrian,
  RoadSegment,
  SignalPattern,
  SignalPhase,
  SimulationStats,
  SnapshotComparison,
  TrafficSignal,
  Vec2,
  Vehicle
} from './types';

const GRID = 5;
const MAX_SPEED = 5.8;
const SAFE_GAP = 2.6;
const STOP_LINE = 1.25;
const COLORS = [0x4f8cff, 0xf56b6b, 0xf9b94f, 0x78d67d, 0xc58cff, 0xffffff];

const keyOf = (p: Vec2) => `${Math.round(p.x / GRID)},${Math.round(p.z / GRID)}`;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class TrafficSimulation {
  nodes = new Map<string, IntersectionNode>();
  roads = new Map<string, RoadSegment>();
  signals = new Map<string, TrafficSignal>();
  vehicles = new Map<string, Vehicle>();
  pedestrians = new Map<string, Pedestrian>();
  stats: SimulationStats = {
    averageTravelTime: 0,
    averageWaitingTime: 0,
    throughput: 0,
    congestionLength: 0,
    averageSpeed: 0,
    currentVehicleCount: 0,
    stoppedVehicleCount: 0,
    fps: 0
  };

  selectedRoadId?: string;
  selectedNodeId?: string;
  selectedSignalId?: string;
  snapshot?: SimulationStats;
  comparison?: SnapshotComparison;
  congestionOverlay = false;
  paused = false;
  speedMultiplier = 1;
  defaultLaneCount = 2;
  defaultDirection: DirectionMode = 'two-way';
  signalSync = false;
  time = 0;

  private nodeKeys = new Map<string, string>();
  private idCounter = 1;
  private travelSamples: number[] = [];
  private waitSamples: number[] = [];

  constructor() {
    this.seedCity();
  }

  seedCity() {
    this.nodes.clear();
    this.roads.clear();
    this.signals.clear();
    this.vehicles.clear();
    this.pedestrians.clear();
    this.nodeKeys.clear();
    this.idCounter = 1;
    this.travelSamples = [];
    this.waitSamples = [];
    this.time = 0;

    const roads: [Vec2, Vec2, number, DirectionMode][] = [];
    const addLine = (points: Vec2[], lanes: number, direction: DirectionMode) => {
      for (let i = 0; i < points.length - 1; i += 1) roads.push([points[i], points[i + 1], lanes, direction]);
    };
    addLine([{ x: -20, z: 0 }, { x: -10, z: 0 }, { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }], 3, 'two-way');
    addLine([{ x: 0, z: -20 }, { x: 0, z: -10 }, { x: 0, z: 0 }, { x: 0, z: 10 }, { x: 0, z: 20 }], 2, 'two-way');
    addLine([{ x: -20, z: -10 }, { x: -10, z: -10 }, { x: 0, z: -10 }, { x: 10, z: -10 }, { x: 15, z: -10 }], 2, 'two-way');
    addLine([{ x: -15, z: 10 }, { x: -10, z: 10 }, { x: 0, z: 10 }, { x: 10, z: 10 }, { x: 20, z: 10 }], 1, 'one-way');
    addLine([{ x: -15, z: 10 }, { x: -15, z: 0 }, { x: -15, z: -10 }], 2, 'two-way');
    addLine([{ x: 15, z: -10 }, { x: 15, z: 0 }, { x: 15, z: 10 }, { x: 15, z: 20 }], 1, 'two-way');
    addLine([{ x: -20, z: 0 }, { x: -20, z: -10 }], 1, 'two-way');
    addLine([{ x: 20, z: 0 }, { x: 20, z: 10 }], 2, 'two-way');
    roads.forEach(([a, b, lanes, direction]) => this.addRoad(a, b, lanes, direction));
    [...this.nodes.values()]
      .filter((node) => node.connectedRoadIds.length >= 3)
      .forEach((node, index) => this.addSignal(node.id, index * 1.7));
    for (let i = 0; i < 24; i += 1) this.addVehicle();
    for (const node of this.nodes.values()) {
      if (node.connectedRoadIds.length >= 3) {
        this.pedestrians.set(`ped-${node.id}`, {
          id: `ped-${node.id}`,
          nodeId: node.id,
          phase: Math.random() * Math.PI * 2,
          speed: 0.7 + Math.random() * 0.4
        });
      }
    }
    this.recomputeNodeTypes();
  }

  addRoad(start: Vec2, end: Vec2, laneCount = this.defaultLaneCount, direction = this.defaultDirection) {
    const a = this.getOrCreateNode(start);
    const b = this.getOrCreateNode(end);
    const existing = [...this.roads.values()].find((road) =>
      (road.startNodeId === a.id && road.endNodeId === b.id) || (road.startNodeId === b.id && road.endNodeId === a.id)
    );
    if (existing) return existing;
    const road: RoadSegment = {
      id: `road-${this.idCounter++}`,
      startNodeId: a.id,
      endNodeId: b.id,
      laneCount,
      direction,
      length: dist(a.position, b.position),
      congestionLevel: 0,
      vehicleIds: [],
      stoppedCount: 0
    };
    this.roads.set(road.id, road);
    a.connectedRoadIds.push(road.id);
    b.connectedRoadIds.push(road.id);
    this.recomputeNodeTypes();
    return road;
  }

  addCross(center: Vec2) {
    const c = this.snap(center);
    this.addRoad(c, { x: c.x - GRID, z: c.z }, this.defaultLaneCount, this.defaultDirection);
    this.addRoad(c, { x: c.x + GRID, z: c.z }, this.defaultLaneCount, this.defaultDirection);
    this.addRoad(c, { x: c.x, z: c.z - GRID }, this.defaultLaneCount, this.defaultDirection);
    this.addRoad(c, { x: c.x, z: c.z + GRID }, this.defaultLaneCount, this.defaultDirection);
  }

  addT(center: Vec2) {
    const c = this.snap(center);
    this.addRoad(c, { x: c.x - GRID, z: c.z }, this.defaultLaneCount, this.defaultDirection);
    this.addRoad(c, { x: c.x + GRID, z: c.z }, this.defaultLaneCount, this.defaultDirection);
    this.addRoad(c, { x: c.x, z: c.z + GRID }, this.defaultLaneCount, this.defaultDirection);
  }

  deleteRoad(roadId: string) {
    const road = this.roads.get(roadId);
    if (!road) return;
    this.vehicles.forEach((vehicle) => {
      if (vehicle.currentRoadId === roadId || vehicle.route.includes(roadId)) this.vehicles.delete(vehicle.id);
    });
    [road.startNodeId, road.endNodeId].forEach((nodeId) => {
      const node = this.nodes.get(nodeId);
      if (node) node.connectedRoadIds = node.connectedRoadIds.filter((id) => id !== roadId);
    });
    this.roads.delete(roadId);
    this.selectedRoadId = undefined;
    this.recomputeNodeTypes();
  }

  toggleRoadDirection(roadId: string) {
    const road = this.roads.get(roadId);
    if (road) road.direction = road.direction === 'two-way' ? 'one-way' : 'two-way';
  }

  setRoadLaneCount(roadId: string, laneCount: number) {
    const road = this.roads.get(roadId);
    if (road) road.laneCount = clamp(Math.round(laneCount), 1, 3);
  }

  addSignal(nodeId: string, offset = this.signalSync ? 0 : Math.random() * 4) {
    const node = this.nodes.get(nodeId);
    if (!node) return undefined;
    if (node.signalId) return this.signals.get(node.signalId);
    const signal: TrafficSignal = {
      id: `signal-${this.idCounter++}`,
      intersectionId: nodeId,
      phase: 'ns-green',
      greenDuration: 7,
      yellowDuration: 2,
      redDuration: 7,
      currentTimer: offset,
      pattern: 'alternating',
      offset
    };
    node.signalId = signal.id;
    this.signals.set(signal.id, signal);
    this.selectedSignalId = signal.id;
    return signal;
  }

  setSignalDurations(signalId: string, green: number, yellow: number) {
    const signal = this.signals.get(signalId);
    if (!signal) return;
    signal.greenDuration = clamp(green, 3, 20);
    signal.yellowDuration = clamp(yellow, 1, 6);
    signal.redDuration = signal.greenDuration;
  }

  cycleSignalPattern(signalId: string) {
    const signal = this.signals.get(signalId);
    if (!signal) return;
    const patterns: SignalPattern[] = ['alternating', 'north-south-priority', 'east-west-priority'];
    signal.pattern = patterns[(patterns.indexOf(signal.pattern) + 1) % patterns.length];
  }

  setSignalSync(sync: boolean) {
    this.signalSync = sync;
    this.signals.forEach((signal) => {
      signal.offset = sync ? 0 : Math.random() * 6;
      signal.currentTimer = signal.offset;
    });
  }

  addVehicle(originNodeId?: string, destinationNodeId?: string) {
    const nodes = [...this.nodes.values()].filter((node) => node.connectedRoadIds.length > 0);
    if (nodes.length < 2 || this.roads.size === 0) return undefined;
    const origin = originNodeId ? this.nodes.get(originNodeId) : nodes[Math.floor(Math.random() * nodes.length)];
    let dest = destinationNodeId ? this.nodes.get(destinationNodeId) : nodes[Math.floor(Math.random() * nodes.length)];
    if (!origin || !dest) return undefined;
    for (let guard = 0; dest.id === origin.id && guard < 8; guard += 1) dest = nodes[Math.floor(Math.random() * nodes.length)];
    const route = this.findRoute(origin.id, dest.id);
    if (route.length === 0) return undefined;
    const firstRoad = this.roads.get(route[0]);
    if (!firstRoad) return undefined;
    const toNodeId = firstRoad.startNodeId === origin.id ? firstRoad.endNodeId : firstRoad.startNodeId;
    const vehicle: Vehicle = {
      id: `vehicle-${this.idCounter++}`,
      currentRoadId: firstRoad.id,
      route,
      positionAlongRoad: 0.2,
      speed: 0,
      targetSpeed: MAX_SPEED * (0.72 + Math.random() * 0.24),
      waitingTime: 0,
      tripStartTime: this.time,
      destinationNodeId: dest.id,
      fromNodeId: origin.id,
      toNodeId,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      length: 0.85 + Math.random() * 0.35,
      lane: Math.floor(Math.random() * firstRoad.laneCount),
      turnBlend: 0
    };
    this.vehicles.set(vehicle.id, vehicle);
    firstRoad.vehicleIds.push(vehicle.id);
    return vehicle;
  }

  update(dt: number, fps: number) {
    this.stats.fps = fps;
    if (this.paused) {
      this.refreshStats();
      return;
    }
    const step = Math.min(dt * this.speedMultiplier, 0.08);
    this.time += step;
    this.updateSignals(step);
    this.updateVehicles(step);
    this.updatePedestrians(step);
    this.updateCongestion();
    this.refreshStats();
  }

  saveSnapshot() {
    this.snapshot = { ...this.stats };
    this.comparison = {
      averageTravelTime: 0,
      averageWaitingTime: 0,
      throughput: 0,
      congestionLength: 0,
      averageSpeed: 0
    };
  }

  resetComparison() {
    this.snapshot = undefined;
    this.comparison = undefined;
  }

  getRoadWorldPosition(vehicle: Vehicle) {
    const road = this.roads.get(vehicle.currentRoadId);
    if (!road) return { x: 0, z: 0, angle: 0 };
    const a = this.nodes.get(vehicle.fromNodeId)?.position;
    const b = this.nodes.get(vehicle.toNodeId)?.position;
    if (!a || !b) return { x: 0, z: 0, angle: 0 };
    const t = clamp(vehicle.positionAlongRoad / road.length, 0, 1);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const normalX = -dz / len;
    const normalZ = dx / len;
    const laneOffset = ((vehicle.lane + 0.5) / road.laneCount - 0.5) * (0.7 + road.laneCount * 0.26);
    return {
      x: lerp(a.x, b.x, t) + normalX * laneOffset,
      z: lerp(a.z, b.z, t) + normalZ * laneOffset,
      angle: Math.atan2(dx, dz)
    };
  }

  snap(p: Vec2): Vec2 {
    return { x: Math.round(p.x / GRID) * GRID, z: Math.round(p.z / GRID) * GRID };
  }

  nearestRoad(p: Vec2, threshold = 1.8) {
    let best: RoadSegment | undefined;
    let bestDist = Infinity;
    for (const road of this.roads.values()) {
      const a = this.nodes.get(road.startNodeId)?.position;
      const b = this.nodes.get(road.endNodeId)?.position;
      if (!a || !b) continue;
      const d = this.distanceToSegment(p, a, b);
      if (d < bestDist) {
        bestDist = d;
        best = road;
      }
    }
    return bestDist <= threshold ? best : undefined;
  }

  nearestNode(p: Vec2, threshold = 2.4) {
    let best: IntersectionNode | undefined;
    let bestDist = Infinity;
    for (const node of this.nodes.values()) {
      const d = dist(p, node.position);
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return bestDist <= threshold ? best : undefined;
  }

  private getOrCreateNode(position: Vec2) {
    const snapped = this.snap(position);
    const key = keyOf(snapped);
    const existingId = this.nodeKeys.get(key);
    if (existingId) return this.nodes.get(existingId)!;
    const node: IntersectionNode = {
      id: `node-${this.idCounter++}`,
      position: snapped,
      connectedRoadIds: [],
      type: 'dead-end'
    };
    this.nodes.set(node.id, node);
    this.nodeKeys.set(key, node.id);
    return node;
  }

  private recomputeNodeTypes() {
    this.nodes.forEach((node) => {
      const count = node.connectedRoadIds.length;
      node.type = count >= 4 ? 'cross' : count === 3 ? 't' : count === 2 ? 'straight' : 'dead-end';
    });
  }

  private updateSignals(dt: number) {
    this.signals.forEach((signal) => {
      signal.currentTimer += dt;
      const g = signal.pattern === 'north-south-priority' ? signal.greenDuration * 1.45 : signal.greenDuration;
      const ewG = signal.pattern === 'east-west-priority' ? signal.greenDuration * 1.45 : signal.greenDuration;
      const cycle = g + signal.yellowDuration + ewG + signal.yellowDuration;
      const t = signal.currentTimer % cycle;
      if (t < g) signal.phase = 'ns-green';
      else if (t < g + signal.yellowDuration) signal.phase = 'ns-yellow';
      else if (t < g + signal.yellowDuration + ewG) signal.phase = 'ew-green';
      else signal.phase = 'ew-yellow';
    });
  }

  private updateVehicles(dt: number) {
    const vehicles = [...this.vehicles.values()];
    for (const vehicle of vehicles) {
      const road = this.roads.get(vehicle.currentRoadId);
      if (!road) continue;
      const blockedByCar = this.hasVehicleAhead(vehicle, road);
      const blockedBySignal = this.isBlockedBySignal(vehicle, road);
      const desired = blockedByCar || blockedBySignal ? 0 : vehicle.targetSpeed;
      const accel = desired > vehicle.speed ? 3.4 : 6.2;
      vehicle.speed += clamp(desired - vehicle.speed, -accel * dt, accel * dt);
      if (vehicle.speed < 0.04) vehicle.speed = 0;
      if (vehicle.speed < 0.25 && (blockedByCar || blockedBySignal)) vehicle.waitingTime += dt;
      vehicle.positionAlongRoad += vehicle.speed * dt;
      if (vehicle.positionAlongRoad >= road.length) this.advanceVehicle(vehicle, road);
    }
  }

  private advanceVehicle(vehicle: Vehicle, road: RoadSegment) {
    const reached = vehicle.toNodeId;
    road.vehicleIds = road.vehicleIds.filter((id) => id !== vehicle.id);
    if (reached === vehicle.destinationNodeId || vehicle.route.length <= 1) {
      this.travelSamples.push(this.time - vehicle.tripStartTime);
      this.waitSamples.push(vehicle.waitingTime);
      if (this.travelSamples.length > 80) this.travelSamples.shift();
      if (this.waitSamples.length > 80) this.waitSamples.shift();
      this.vehicles.delete(vehicle.id);
      window.setTimeout(() => this.addVehicle(reached), 450 + Math.random() * 900);
      return;
    }
    vehicle.route.shift();
    const nextRoadId = vehicle.route[0];
    const nextRoad = this.roads.get(nextRoadId);
    if (!nextRoad) {
      this.vehicles.delete(vehicle.id);
      return;
    }
    vehicle.fromNodeId = reached;
    vehicle.toNodeId = nextRoad.startNodeId === reached ? nextRoad.endNodeId : nextRoad.startNodeId;
    vehicle.currentRoadId = nextRoad.id;
    vehicle.positionAlongRoad = 0;
    vehicle.lane = Math.min(vehicle.lane, nextRoad.laneCount - 1);
    vehicle.turnBlend = 1;
    nextRoad.vehicleIds.push(vehicle.id);
  }

  private hasVehicleAhead(vehicle: Vehicle, road: RoadSegment) {
    for (const otherId of road.vehicleIds) {
      if (otherId === vehicle.id) continue;
      const other = this.vehicles.get(otherId);
      if (!other || other.fromNodeId !== vehicle.fromNodeId || other.toNodeId !== vehicle.toNodeId) continue;
      const gap = other.positionAlongRoad - vehicle.positionAlongRoad;
      if (gap > 0 && gap < SAFE_GAP + vehicle.speed * 0.35) return true;
    }
    return false;
  }

  private isBlockedBySignal(vehicle: Vehicle, road: RoadSegment) {
    if (road.length - vehicle.positionAlongRoad > STOP_LINE + Math.max(0, vehicle.speed * 0.35)) return false;
    const node = this.nodes.get(vehicle.toNodeId);
    if (!node?.signalId) return false;
    const signal = this.signals.get(node.signalId);
    if (!signal) return false;
    const from = this.nodes.get(vehicle.fromNodeId)?.position;
    const to = node.position;
    if (!from) return false;
    const isNorthSouth = Math.abs(to.z - from.z) > Math.abs(to.x - from.x);
    const green = isNorthSouth ? signal.phase === 'ns-green' : signal.phase === 'ew-green';
    return !green;
  }

  private updatePedestrians(dt: number) {
    this.pedestrians.forEach((ped) => {
      ped.phase += ped.speed * dt;
    });
  }

  private updateCongestion() {
    this.roads.forEach((road) => {
      const vehicles = road.vehicleIds.map((id) => this.vehicles.get(id)).filter(Boolean) as Vehicle[];
      const density = vehicles.length / Math.max(1, road.length / 4) / road.laneCount;
      const avgSpeed = vehicles.length ? vehicles.reduce((sum, v) => sum + v.speed, 0) / vehicles.length : MAX_SPEED;
      const stopped = vehicles.filter((v) => v.speed < 0.35).length;
      road.stoppedCount = stopped;
      road.congestionLevel = clamp(density * 0.58 + (1 - avgSpeed / MAX_SPEED) * 0.28 + stopped * 0.07, 0, 1);
    });
  }

  private refreshStats() {
    const vehicles = [...this.vehicles.values()];
    this.stats.currentVehicleCount = vehicles.length;
    this.stats.stoppedVehicleCount = vehicles.filter((vehicle) => vehicle.speed < 0.35).length;
    this.stats.averageSpeed = vehicles.length ? vehicles.reduce((sum, v) => sum + v.speed, 0) / vehicles.length : 0;
    this.stats.averageTravelTime = this.travelSamples.length
      ? this.travelSamples.reduce((sum, v) => sum + v, 0) / this.travelSamples.length
      : 0;
    this.stats.averageWaitingTime = this.waitSamples.length
      ? this.waitSamples.reduce((sum, v) => sum + v, 0) / this.waitSamples.length
      : 0;
    this.stats.throughput = this.travelSamples.length;
    this.stats.congestionLength = [...this.roads.values()]
      .filter((road) => road.congestionLevel > 0.58)
      .reduce((sum, road) => sum + road.length, 0);
    if (this.snapshot) {
      this.comparison = {
        averageTravelTime: percentDelta(this.snapshot.averageTravelTime, this.stats.averageTravelTime, true),
        averageWaitingTime: percentDelta(this.snapshot.averageWaitingTime, this.stats.averageWaitingTime, true),
        throughput: percentDelta(this.snapshot.throughput, this.stats.throughput, false),
        congestionLength: percentDelta(this.snapshot.congestionLength, this.stats.congestionLength, true),
        averageSpeed: percentDelta(this.snapshot.averageSpeed, this.stats.averageSpeed, false)
      };
    }
  }

  private findRoute(startNodeId: string, endNodeId: string) {
    const queue: { nodeId: string; route: string[] }[] = [{ nodeId: startNodeId, route: [] }];
    const visited = new Set<string>([startNodeId]);
    while (queue.length) {
      const item = queue.shift()!;
      if (item.nodeId === endNodeId) return item.route;
      const node = this.nodes.get(item.nodeId);
      if (!node) continue;
      const candidates = [...node.connectedRoadIds].sort(() => Math.random() - 0.5);
      for (const roadId of candidates) {
        const road = this.roads.get(roadId);
        if (!road) continue;
        if (road.direction === 'one-way' && road.startNodeId !== item.nodeId) continue;
        const next = road.startNodeId === item.nodeId ? road.endNodeId : road.startNodeId;
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push({ nodeId: next, route: [...item.route, roadId] });
      }
    }
    return [];
  }

  private distanceToSegment(p: Vec2, a: Vec2, b: Vec2) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    if (l2 === 0) return dist(p, a);
    const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1);
    return dist(p, { x: a.x + t * dx, z: a.z + t * dz });
  }
}

function percentDelta(before: number, after: number, lowerIsBetter: boolean) {
  if (before === 0) return after === 0 ? 0 : 100;
  const raw = ((after - before) / Math.abs(before)) * 100;
  return lowerIsBetter ? -raw : raw;
}
