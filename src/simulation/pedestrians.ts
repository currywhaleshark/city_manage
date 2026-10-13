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
}
export const WALKING_GAP = 0.85;
const definitions = [
  { id: "school-front", nodeId: "n3-2", name: "학교 정문 앞", turn: 0 },
  { id: "school-side", nodeId: "n3-1", name: "학교 옆", turn: 1 },
  { id: "homes", nodeId: "n1-2", name: "주거지 앞", turn: -1 },
  { id: "park", nodeId: "n2-3", name: "공원 앞", turn: -1 },
];
export function createPedestrianDemand(
  seed = 2404,
  count = 60,
): readonly PedestrianTrip[] {
  const random = seededRandom(seed ^ 0x706564);
  return Object.freeze(
    Array.from({ length: count }, (_, id) => {
      const r = random();
      return Object.freeze({
        id,
        routeId: definitions[r < 0.4 ? 0 : r < 0.7 ? 1 : r < 0.85 ? 2 : 3].id,
        departAt: Math.round((2 + (id / count) * 190 + random() * 3) * 10) / 10,
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

/** Local sidewalk trips with a protected crossing phase. No rendering or random per-tick decisions. */
export class PedestrianSystem {
  readonly routes: Map<string, WalkingRoute>;
  readonly active = new Map<number, Pedestrian>();
  readonly pending: PedestrianTrip[] = [];
  readonly completed: {
    id: number;
    travelTime: number;
    waitingTime: number;
  }[] = [];
  readonly blockedNodes = new Set<string>();
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
    readonly demand: readonly PedestrianTrip[],
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
    for (let i = 0; i < this.pending.length; ) {
      const trip = this.pending[i];
      if (
        [...this.active.values()].some(
          (p) => p.trip.routeId === trip.routeId && p.distance < WALKING_GAP,
        )
      ) {
        i++;
        continue;
      }
      const pose = walkingPose(this.routes.get(trip.routeId)!, 0);
      this.active.set(trip.id, {
        trip,
        distance: 0,
        previousDistance: 0,
        waitingTime: time - trip.departAt,
        crossing: false,
        pose,
        previousPose: { ...pose },
      });
      this.pending.splice(i, 1);
    }
    this.blockedNodes.clear();
    for (const route of this.routes.values()) {
      const people = [...this.active.values()]
        .filter((p) => p.trip.routeId === route.id)
        .sort((a, b) => b.distance - a.distance || a.trip.id - b.trip.id);
      const phase = signalPhase(
        this.network.nodes.get(route.nodeId)!.signal,
        time,
      );
      let leaderDistance = Infinity;
      for (const person of people) {
        person.previousPose = { ...person.pose };
        person.previousDistance = person.distance;
        let next = Math.min(
          route.length,
          person.distance + person.trip.speed * dt,
          leaderDistance - WALKING_GAP,
        );
        leaderDistance = person.distance;
        if (
          person.distance <= route.crossingStart &&
          !person.crossing &&
          next > route.crossingStart
        ) {
          if (
            phase === "pedestrian-green" &&
            !vehicleLocks.get(route.nodeId)?.size
          ) {
            person.crossing = true;
            this.events.push({
              id: person.trip.id,
              node: route.nodeId,
              time,
              phase,
              type: "enter",
            });
          } else next = route.crossingStart;
        }
        next = Math.max(person.distance, next);
        // Count lost walking time, including queueing at the origin and behind other walkers.
        const walkingTime = Math.min(
          dt,
          (route.length - person.distance) / person.trip.speed,
        );
        person.waitingTime += Math.max(
          0,
          walkingTime - (next - person.distance) / person.trip.speed,
        );
        person.distance = next;
        person.pose = walkingPose(route, next);
        if (person.crossing && next >= route.crossingEnd) {
          person.crossing = false;
          this.events.push({
            id: person.trip.id,
            node: route.nodeId,
            time,
            phase,
            type: "exit",
          });
        }
        if (person.crossing) this.blockedNodes.add(route.nodeId);
        if (next >= route.length) {
          this.completed.push({
            id: person.trip.id,
            travelTime: time - person.trip.departAt,
            waitingTime: person.waitingTime,
          });
          this.active.delete(person.trip.id);
        }
      }
    }
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
