import type { Network, Pose, Vec2 } from "../types";
import { seededRandom } from "../scenario";
import { signalPhase } from "./network";

export interface PedestrianTrip {
  readonly id: number;
  readonly routeId: string;
  readonly departAt: number;
  readonly speed: number;
  readonly color: number;
}
export interface WalkingRoute {
  id: string;
  nodeId: string;
  name: string;
  points: Vec2[];
  distances: number[];
  crossingStart: number;
  crossingEnd: number;
  length: number;
}
export interface Pedestrian {
  trip: PedestrianTrip;
  distance: number;
  previousDistance: number;
  waitingTime: number;
  crossing: boolean;
  pose: Pose;
  previousPose: Pose;
  path?: WalkingRoute;
}
export const WALKING_GAP = 0.85;
/** On a footbridge, stairs and the longer way over halve walking speed while crossing. */
export const FOOTBRIDGE_SPEED = 0.5;
const definitions = [
  { id: "school-front", nodeId: "n3-2", name: "학교 정문 앞", turn: 0 },
  { id: "school-side", nodeId: "n3-1", name: "학교 옆", turn: 1 },
  { id: "homes", nodeId: "n1-2", name: "주거지 앞", turn: -1 },
  { id: "park", nodeId: "n2-3", name: "공원 앞", turn: -1 },
];
/**
 * Cumulative route shares in the order of `definitions` (school front, school
 * side, homes; the park takes the rest). Written out so old cities replay exactly.
 */
export const SCHOOL_WALKS = [0.4, 0.7, 0.85] as const;
export const NEIGHBORHOOD_WALKS = [0.1, 0.2, 0.6] as const;
export function createPedestrianDemand(
  seed = 2404,
  count = 60,
  spread = 190,
  [first, second, third]: readonly number[] = SCHOOL_WALKS,
): readonly PedestrianTrip[] {
  const random = seededRandom(seed ^ 0x706564);
  return Object.freeze(
    Array.from({ length: count }, (_, id) => {
      const r = random();
      return Object.freeze({
        id,
        routeId: definitions[r < first ? 0 : r < second ? 1 : r < third ? 2 : 3].id,
        departAt: Math.round((2 + (id / count) * spread + random() * 3) * 10) / 10,
        speed: 1.1 + random() * 0.4,
        color: [0xf3bd43, 0x427ab2, 0xb95149, 0x579476][id % 4],
      });
    }).sort((a, b) => a.departAt - b.departAt || a.id - b.id),
  );
}
export function walkingRoutes(network: Network): WalkingRoute[] {
  return definitions
    .filter((d) => network.nodes.has(d.nodeId))
    .map((d) => {
      const origin = network.nodes.get(d.nodeId)!.position;
      const points = [
        [-24, 6.2],
        [-6.2, 6.2],
        [-4.3, 6.2],
        [-4.3, -6.2],
        [-6.2, -6.2],
        [-24, -6.2],
      ].map(([x, z]) => {
        const p =
          d.turn === 1
            ? { x: z, z: -x }
            : d.turn === -1
              ? { x: -z, z: x }
              : { x, z };
        return { x: origin.x + p.x, z: origin.z + p.z };
      });
      const distances = [0];
      for (let i = 1; i < points.length; i++)
        distances.push(
          distances[i - 1] +
            Math.hypot(
              points[i].x - points[i - 1].x,
              points[i].z - points[i - 1].z,
            ),
        );
      return {
        ...d,
        points,
        distances,
        crossingStart: distances[1],
        crossingEnd: distances[4],
        length: distances[5],
      };
    });
}
export function walkingPose(route: WalkingRoute, distance: number): Pose {
  let i = 1;
  while (i < route.points.length - 1 && route.distances[i] < distance) i++;
  const a = route.points[i - 1],
    b = route.points[i];
  const t = Math.max(
    0,
    Math.min(
      1,
      (distance - route.distances[i - 1]) /
        (route.distances[i] - route.distances[i - 1]),
    ),
  );
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    angle: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

/** A short sidewalk diversion around a parked car, clear of the carriageway. */
export function sidewalkDetour(
  route: WalkingRoute,
  network: Network,
): WalkingRoute {
  const a = route.points[0],
    b = route.points[1];
  const length = Math.hypot(b.x - a.x, b.z - a.z),
    ux = (b.x - a.x) / length,
    uz = (b.z - a.z) / length;
  const node = network.nodes.get(route.nodeId)!.position;
  const ox = Math.abs(ux) < 0.5 ? Math.sign(a.x - node.x) * 3 : 0;
  const oz = Math.abs(uz) < 0.5 ? Math.sign(a.z - node.z) * 3 : 0;
  const point = (d: number, outside = false) => ({
    x: a.x + ux * d + (outside ? ox : 0),
    z: a.z + uz * d + (outside ? oz : 0),
  });
  const points = [
    a,
    point(4),
    point(4, true),
    point(14, true),
    point(14),
    ...route.points.slice(1),
  ];
  const distances = [0];
  for (let i = 1; i < points.length; i++)
    distances.push(
      distances[i - 1] +
        Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].z - points[i - 1].z,
        ),
    );
  return {
    ...route,
    points,
    distances,
    crossingStart: route.crossingStart + 6,
    crossingEnd: route.crossingEnd + 6,
    length: route.length + 6,
  };
}
const routeProgress = (
  distance: number,
  path: WalkingRoute,
  base: WalkingRoute,
) =>
  path === base
    ? distance
    : distance <= 4
      ? distance
      : distance <= 7
        ? 4
        : distance <= 17
          ? distance - 3
          : distance <= 20
            ? 14
            : distance - 6;
const pathDistance = (
  progress: number,
  path: WalkingRoute,
  base: WalkingRoute,
) =>
  path === base
    ? progress
    : progress <= 4
      ? progress
      : progress <= 14
        ? progress + 3
        : progress + 6;

/** Local sidewalk trips with a protected crossing phase. No rendering or random per-tick decisions. */
export class PedestrianSystem {
  readonly detours = new Map<string, WalkingRoute>();
  detouredCount = 0;
  readonly routes: Map<string, WalkingRoute>;
  readonly active = new Map<number, Pedestrian>();
  readonly pending: PedestrianTrip[] = [];
  readonly completed: {
    id: number;
    travelTime: number;
    waitingTime: number;
    extraDistance?: number;
  }[] = [];
  readonly blockedNodes = new Set<string>();
  /** Junctions whose crossing is a footbridge: no signal wait, no conflict with cars. */
  readonly bridges = new Set<string>();
  /** Withdrawn footbridges: walkers still on them finish, nobody new goes up. */
  readonly closingBridges = new Set<string>();
  readonly events: {
    id: number;
    node: string;
    time: number;
    phase: string;
    type: "enter" | "exit";
  }[] = [];
  private released = 0;
  private time = 0;
  constructor(
    readonly network: Network,
    public demand: readonly PedestrianTrip[],
  ) {
    const used = new Set(demand.map((t) => t.routeId));
    this.routes = new Map(
      walkingRoutes(network)
        .filter((r) => used.has(r.id))
        .map((r) => [r.id, r]),
    );
    const ids = new Set<number>();
    let lastDeparture = -Infinity;
    for (const trip of demand) {
      if (
        !this.routes.has(trip.routeId) ||
        ids.has(trip.id) ||
        !Number.isFinite(trip.speed) ||
        trip.speed <= 0 ||
        !Number.isFinite(trip.departAt) ||
        trip.departAt < 0 ||
        trip.departAt < lastDeparture
      )
        throw new Error("Invalid pedestrian demand");
      ids.add(trip.id);
      lastDeparture = trip.departAt;
    }
    for (const route of this.routes.values())
      Object.assign(network.nodes.get(route.nodeId)!.signal, {
        walk: 8,
        walkClearance: 16,
      });
  }
  scheduleDemand(trips: readonly PedestrianTrip[]) {
    this.demand = [...this.demand.slice(this.released), ...trips].sort(
      (a, b) => a.departAt - b.departAt,
    );
    this.released = 0;
  }
  step(
    time: number,
    dt: number,
    vehicleLocks: ReadonlyMap<string, ReadonlySet<number>>,
  ) {
    this.time = time;
    while (
      this.released < this.demand.length &&
      this.demand[this.released].departAt <= time + 1e-9
    )
      this.pending.push(this.demand[this.released++]);
    for (let i = 0; i < this.pending.length;) {
      const trip = this.pending[i];
      if (
        [...this.active.values()].some(
          (p) => p.trip.routeId === trip.routeId && p.distance < WALKING_GAP,
        )
      ) {
        i++;
        continue;
      }
      const path = this.detours.get(trip.routeId);
      if (path) this.detouredCount++;
      const pose = walkingPose(path ?? this.routes.get(trip.routeId)!, 0);
      this.active.set(trip.id, {
        trip,
        distance: 0,
        previousDistance: 0,
        waitingTime: time - trip.departAt,
        crossing: false,
        pose,
        previousPose: { ...pose },
        ...(path ? { path } : {}),
      });
      this.pending.splice(i, 1);
    }
    this.blockedNodes.clear();
    for (const route of this.routes.values()) {
      const people = [...this.active.values()]
        .filter((p) => p.trip.routeId === route.id)
        .sort(
          (a, b) =>
            routeProgress(b.distance, b.path ?? route, route) -
              routeProgress(a.distance, a.path ?? route, route) ||
            a.trip.id - b.trip.id,
        );
      const phase = signalPhase(
        this.network.nodes.get(route.nodeId)!.signal,
        time,
      );
      let leaderDistance = Infinity;
      for (const person of people) {
        const path = person.path ?? route;
        const bridged = this.bridges.has(route.nodeId);
        person.previousPose = { ...person.pose };
        person.previousDistance = person.distance;
        const speed = person.trip.speed * (bridged && person.crossing ? FOOTBRIDGE_SPEED : 1);
        let next = Math.min(
          path.length,
          person.distance + speed * dt,
          pathDistance(leaderDistance - WALKING_GAP, path, route),
        );
        leaderDistance = routeProgress(person.distance, path, route);
        if (
          person.distance <= path.crossingStart &&
          !person.crossing &&
          next > path.crossingStart
        ) {
          if (
            (bridged && !this.closingBridges.has(route.nodeId)) ||
            (phase === "pedestrian-green" &&
              !vehicleLocks.get(route.nodeId)?.size)
          ) {
            person.crossing = true;
            this.events.push({
              id: person.trip.id,
              node: route.nodeId,
              time,
              phase,
              type: "enter",
            });
          } else next = path.crossingStart;
        }
        next = Math.max(person.distance, next);
        // Count lost walking time, including queueing at the origin and behind other walkers.
        const walkingTime = Math.min(
          dt,
          (path.length - person.distance) / person.trip.speed,
        );
        person.waitingTime += Math.max(
          0,
          walkingTime - (next - person.distance) / person.trip.speed,
        );
        person.distance = next;
        person.pose = walkingPose(path, next);
        if (person.crossing && next >= path.crossingEnd) {
          person.crossing = false;
          this.events.push({
            id: person.trip.id,
            node: route.nodeId,
            time,
            phase,
            type: "exit",
          });
        }
        if (person.crossing && !bridged) this.blockedNodes.add(route.nodeId);
        if (next >= path.length) {
          this.completed.push({
            id: person.trip.id,
            travelTime: time - person.trip.departAt,
            waitingTime: person.waitingTime,
            ...(person.path
              ? { extraDistance: path.length - route.length }
              : {}),
          });
          this.active.delete(person.trip.id);
        }
      }
    }
  }
  get extraWalkingDistance() {
    return (
      this.completed.reduce((n, p) => n + (p.extraDistance ?? 0), 0) +
      [...this.active.values()].reduce((n, p) => {
        const base = this.routes.get(p.trip.routeId)!;
        return n + p.distance - routeProgress(p.distance, p.path ?? base, base);
      }, 0)
    );
  }
  get stats() {
    const active = [...this.active.values()];
    const totalWaitingTime =
      this.completed.reduce((n, p) => n + p.waitingTime, 0) +
      active.reduce((n, p) => n + p.waitingTime, 0) +
      this.pending.reduce((n, p) => n + this.time - p.departAt, 0);
    return {
      arrived: this.completed.length,
      active: active.length,
      queued: this.pending.length,
      unreleased: this.demand.length - this.released,
      waiting: active.filter((p) => p.distance - p.previousDistance < 0.001)
        .length,
      crossing: active.filter((p) => p.crossing).length,
      averageWaitingTime: this.released
        ? totalWaitingTime / this.released
        : null,
      averageTravelTime: this.completed.length
        ? this.completed.reduce((n, p) => n + p.travelTime, 0) /
          this.completed.length
        : null,
    };
  }
}
