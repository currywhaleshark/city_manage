import { BUILDINGS, CONFIG, SCHOOL_NODE } from "../scenario";
import type { Crossing, Lane, Network, Trip, Vec2 } from "../types";
import { findRoute } from "./network";

export interface VehicleAccess {
  id: string;
  buildingId: string;
  name: string;
  laneId: string;
  startS: number;
  mergeS: number;
  points: Crossing["points"];
}
const catalogs = new WeakMap<Network, VehicleAccess[]>();

/** Existing buildings' forecourts, never the river or a vacant construction plot. */
export function vehicleAccesses(network: Network): readonly VehicleAccess[] {
  const cached = catalogs.get(network);
  if (cached) return cached;
  const accesses: VehicleAccess[] = [];
  for (const building of BUILDINGS) {
    if (building.kind === "park") continue;
    let chosen: Lane | undefined;
    // Prefer the clear strip south of the buildings, then their other faces.
    const faces = building.kind === "waste"
      ? [[24, 0], [0, -24], [-24, 0], [0, 24]] // Leave the unloading shed to the south clear.
      : [[0, 24], [24, 0], [0, -24], [-24, 0]];
    for (const [ox, oz] of faces) {
      chosen = [...network.lanes.values()].find(lane => {
        const road = network.roads.get(lane.roadId)!;
        const a = network.nodes.get(lane.from)!.position;
        const b = network.nodes.get(lane.to)!.position;
        if (road.laneCount !== 1 || Math.abs(road.length - CONFIG.spacing) > 0.01)
          return false;
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const dx = (b.x - a.x) / road.length, dz = (b.z - a.z) / road.length;
        return Math.abs(mx - building.x - ox) < 0.01 &&
          Math.abs(mz - building.z - oz) < 0.01 &&
          (building.x - mx) * -dz + (building.z - mz) * dx > 0;
      });
      if (chosen) break;
    }
    if (!chosen) continue;
    const lane = chosen, dx = (lane.end.x - lane.start.x) / lane.length,
      dz = (lane.end.z - lane.start.z) / lane.length;
    // School walkers finish at the middle of this block: leave their landing clear.
    const startS = lane.length / 2 + (building.kind === "school" ? 3 : 0),
      mergeS = startS + 5.5;
    const at = (s: number, side: number): Vec2 => ({
      x: lane.start.x + dx * s - dz * side,
      z: lane.start.z + dz * s + dx * side,
    });
    accesses.push({
      id: `access-${building.id}`, buildingId: building.id,
      name: `${building.name} 출입구`, laneId: lane.id, startS, mergeS,
      points: [at(startS, 5.6), at(startS, 3.1), at(mergeS - 3, 0), at(mergeS, 0)],
    });
  }
  catalogs.set(network, accesses);
  return accesses;
}

export interface DeparturePlan { access: VehicleAccess; route: string[] }

export interface ArrivalPlan {
  access: VehicleAccess;
  route: string[];
  entryS: number;
  points: Crossing["points"];
}

/** Approach in the lane's direction, then turn right into the same off-road bay. */
export function arrivalPath(network: Network, access: VehicleAccess) {
  const lane = network.lanes.get(access.laneId)!;
  const dx = (lane.end.x - lane.start.x) / lane.length;
  const dz = (lane.end.z - lane.start.z) / lane.length;
  const entryS = access.startS - 8;
  const at = (s: number): Vec2 => ({
    x: lane.start.x + dx * s,
    z: lane.start.z + dz * s,
  });
  return {
    entryS,
    points: [at(entryS), at(access.startS - 1), access.points[1], access.points[0]] as Crossing["points"],
  };
}

export function planVehicleArrival(
  network: Network, trip: Trip, departure?: DeparturePlan,
): ArrivalPlan | undefined {
  const destination = network.nodes.get(trip.destination)?.position;
  if (!destination) return;
  const source = departure && network.lanes.get(departure.access.laneId)!;
  const start = source?.to ?? trip.origin;
  const candidates = [...vehicleAccesses(network)].sort((a, b) => {
    const score = (access: VehicleAccess) => {
      const building = BUILDINGS.find(b => b.id === access.buildingId)!;
      return Math.hypot(building.x - destination.x, building.z - destination.z) +
        (trip.destination === SCHOOL_NODE && building.kind !== "school" ? 1000 : 0);
    };
    return score(a) - score(b);
  });
  for (const access of candidates) {
    const lane = network.lanes.get(access.laneId)!;
    const penalty = (id: string) => id === lane.roadId || id === source?.roadId ? Infinity : 0;
    let tail = findRoute(network, start, lane.from, penalty);
    if (start !== lane.from && !tail.length) continue;
    if (start === lane.from && source?.roadId === lane.roadId) {
      // Buildings on opposite sides of one road need a block loop, not a U-turn.
      const loops = (network.outgoing.get(start) ?? []).flatMap(out => {
        if (!Number.isFinite(penalty(out.roadId))) return [];
        const back = findRoute(network, out.to, start, id =>
          id === out.roadId ? Infinity : penalty(id));
        return back.length ? [[out.roadId, ...back]] : [];
      });
      loops.sort((a, b) => a.length - b.length);
      if (!loops.length) continue;
      tail = loops[0];
    }
    return {
      access, ...arrivalPath(network, access),
      route: [...(source ? [source.roadId] : []), ...tail, lane.roadId],
    };
  }
}

export function planVehicleDeparture(
  network: Network, trip: Trip, stopLaneId?: string,
): DeparturePlan | undefined {
  const origin = network.nodes.get(trip.origin)?.position;
  if (!origin) return;
  const stop = stopLaneId ? network.lanes.get(stopLaneId) : undefined;
  const destination = stop?.from ?? trip.destination;
  const school = trip.origin === SCHOOL_NODE && !stop;
  const candidates = [...vehicleAccesses(network)].sort((a, b) => {
    const score = (access: VehicleAccess) => {
      const building = BUILDINGS.find(b => b.id === access.buildingId)!;
      return Math.hypot(building.x - origin.x, building.z - origin.z) +
        (school && building.kind !== "school" ? 1000 : 0);
    };
    return score(a) - score(b);
  });
  for (const access of candidates) {
    const lane = network.lanes.get(access.laneId)!;
    if (stop?.id === lane.id) return { access, route: [lane.roadId] };
    const tail = findRoute(network, lane.to, destination, id =>
      id === lane.roadId || id === stop?.roadId ? Infinity : 0);
    if (lane.to !== destination && !tail.length) continue;
    return { access, route: [lane.roadId, ...tail, ...(stop ? [stop.roadId] : [])] };
  }
}
