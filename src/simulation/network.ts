import type {
  Network,
  SignalPhase,
  TrafficSignal,
  Vec2,
  Crossing,
  Pose,
} from "../types";
import { CONFIG } from "../scenario";
export function findRoute(
  network: Network,
  origin: string,
  destination: string,
  roadPenalty: (id: string) => number = () => 0,
): string[] {
  if (!network.nodes.has(origin) || !network.nodes.has(destination)) return [];
  const distance = new Map([[origin, 0]]),
    previous = new Map<string, { node: string; road: string }>(),
    unvisited = new Set(network.nodes.keys());
  while (unvisited.size) {
    let current: string | undefined,
      best = Infinity;
    for (const id of unvisited)
      if ((distance.get(id) ?? Infinity) < best) {
        best = distance.get(id)!;
        current = id;
      }
    if (current === undefined) break;
    if (current === destination) {
      const route: string[] = [];
      let cursor = destination;
      while (cursor !== origin) {
        const p = previous.get(cursor)!;
        route.unshift(p.road);
        cursor = p.node;
      }
      return route;
    }
    unvisited.delete(current);
    for (const lane of network.outgoing.get(current) ?? []) {
      const road = network.roads.get(lane.roadId)!;
      const cost =
        best +
        road.length / road.speedLimit +
        Math.max(0, roadPenalty(road.id));
      if (cost < (distance.get(lane.to) ?? Infinity) - 1e-9) {
        distance.set(lane.to, cost);
        previous.set(lane.to, { node: current, road: road.id });
      }
    }
  }
  return [];
}
export function signalPhase(signal: TrafficSignal, time: number): SignalPhase {
  const vehicleCycle =
    signal.ns + signal.ew + 2 * (signal.yellow + signal.clearance);
  const cycle = vehicleCycle + (signal.walk ?? 0) + (signal.walkClearance ?? 0);
  const t = (((time + signal.offset) % cycle) + cycle) % cycle;
  if (t < signal.ns) return "ns-green";
  if (t < signal.ns + signal.yellow) return "ns-yellow";
  if (t < signal.ns + signal.yellow + signal.clearance) return "all-red";
  if (t < signal.ns + signal.yellow + signal.clearance + signal.ew)
    return "ew-green";
  if (t < vehicleCycle - signal.clearance) return "ew-yellow";
  if (t < vehicleCycle) return "all-red";
  if (t < vehicleCycle + (signal.walk ?? 0)) return "pedestrian-green";
  return "pedestrian-clearance";
}
export function curvePoint(points: [Vec2, Vec2, Vec2, Vec2], t: number): Pose {
  const [a, b, c, d] = points,
    u = 1 - t;
  const x =
    u * u * u * a.x +
    3 * u * u * t * b.x +
    3 * u * t * t * c.x +
    t * t * t * d.x;
  const z =
    u * u * u * a.z +
    3 * u * u * t * b.z +
    3 * u * t * t * c.z +
    t * t * t * d.z;
  const dx =
    3 * u * u * (b.x - a.x) + 6 * u * t * (c.x - b.x) + 3 * t * t * (d.x - c.x);
  const dz =
    3 * u * u * (b.z - a.z) + 6 * u * t * (c.z - b.z) + 3 * t * t * (d.z - c.z);
  return { x, z, angle: Math.atan2(dx, dz) };
}
export function createCrossing(
  network: Network,
  fromLaneId: string,
  nextLaneId: string,
): Crossing {
  const a = network.lanes.get(fromLaneId)!,
    b = network.lanes.get(nextLaneId)!;
  const dirA = {
    x: (a.end.x - a.start.x) / a.length,
    z: (a.end.z - a.start.z) / a.length,
  };
  const dirB = {
    x: (b.end.x - b.start.x) / b.length,
    z: (b.end.z - b.start.z) / b.length,
  };
  const k = 7;
  const points: Crossing["points"] = [
    a.end,
    { x: a.end.x + dirA.x * k, z: a.end.z + dirA.z * k },
    { x: b.start.x - dirB.x * k, z: b.start.z - dirB.z * k },
    b.start,
  ];
  const dot = dirA.x * dirB.x + dirA.z * dirB.z;
  return measureCrossing(
    a.to,
    fromLaneId,
    nextLaneId,
    points,
    dot > 0.99 ? 8 : 4.5,
  );
}

function measureCrossing(
  nodeId: string,
  fromLaneId: string,
  nextLaneId: string,
  points: Crossing["points"],
  speedLimit: number,
): Crossing {
  let length = 0,
    previous = points[0];
  const arcLengths = [0];
  for (let i = 1; i <= 96; i++) {
    const p = curvePoint(points, i / 96);
    length += Math.hypot(p.x - previous.x, p.z - previous.z);
    arcLengths.push(length);
    previous = p;
  }
  return {
    nodeId,
    fromLaneId,
    nextLaneId,
    points,
    progress: 0,
    distance: 0,
    length,
    arcLengths,
    speedLimit,
  };
}

export function createArrival(network: Network, fromLaneId: string): Crossing {
  const lane = network.lanes.get(fromLaneId)!;
  const dx = (lane.end.x - lane.start.x) / lane.length;
  const dz = (lane.end.z - lane.start.z) / lane.length;
  const length =
    CONFIG.junctionRadius +
    (network.nodes.get(lane.to)?.boundary ? 0 : CONFIG.carLength);
  const points = [0, 1 / 3, 2 / 3, 1].map((t) => ({
    x: lane.end.x + dx * length * t,
    z: lane.end.z + dz * length * t,
  })) as Crossing["points"];
  return measureCrossing(lane.to, fromLaneId, "", points, 6);
}

/** Arc-length lookup prevents a Bézier parameter from changing physical speed. */
export function crossingPose(crossing: Crossing, distance: number): Pose {
  const arc = crossing.arcLengths;
  if (distance <= 0) return curvePoint(crossing.points, 0);
  if (distance >= crossing.length) return curvePoint(crossing.points, 1);
  let low = 0,
    high = arc.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (arc[middle] < distance) low = middle;
    else high = middle;
  }
  const fraction = (distance - arc[low]) / (arc[high] - arc[low]);
  return curvePoint(crossing.points, (low + fraction) / (arc.length - 1));
}
