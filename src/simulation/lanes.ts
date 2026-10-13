// IDM/MOBIL incentive adapted from SaintPepsi/traffic-microsim, MIT,
// Copyright (c) 2026 Ian Hogers. Urban route and occupancy constraints added here.
import { CONFIG } from "../scenario";
import type { Lane, Network, Pose, Turn, Vehicle } from "../types";
import { idmAccel } from "./idm";

export const LANE_CHANGE = {
  distance: 12,
  junctionMargin: 8,
  cooldown: 5,
  politeness: 0.3,
  threshold: 0.2,
  safeBrake: 4,
} as const;

export function nextTurn(
  network: Network,
  lane: Lane,
  nextRoadId?: string,
): Turn {
  if (!nextRoadId) return "straight";
  const next = (network.outgoing.get(lane.to) ?? []).find(
    (l) => l.roadId === nextRoadId,
  );
  if (!next) return "straight";
  const dx = lane.end.x - lane.start.x,
    dz = lane.end.z - lane.start.z;
  const nx = next.end.x - next.start.x,
    nz = next.end.z - next.start.z;
  const cross = dx * nz - dz * nx;
  return Math.abs(cross) < 1e-5 ? "straight" : cross < 0 ? "left" : "right";
}

export function permitsRoute(
  network: Network,
  lane: Lane,
  nextRoadId?: string,
) {
  return lane.turns.includes(nextTurn(network, lane, nextRoadId));
}

export function occupiesLane(car: Vehicle, laneId: string) {
  return (
    !car.crossing &&
    (car.laneId === laneId || car.laneChange?.toLaneId === laneId)
  );
}

export function neighbours(cars: readonly Vehicle[], self: Vehicle) {
  let leader: Vehicle | undefined, follower: Vehicle | undefined;
  for (const car of cars) {
    if (car.id === self.id) continue;
    if (car.s >= self.s && (!leader || car.s < leader.s)) leader = car;
    if (car.s < self.s && (!follower || car.s > follower.s)) follower = car;
  }
  return { leader, follower };
}

/** Hypothetical IDM acceleration, including a conservative stop-line boundary. */
function acceleration(
  car: Vehicle | undefined,
  leader: Vehicle | undefined,
  lane: Lane,
  limit: number,
) {
  if (!car) return 0;
  const gap = leader
    ? leader.s - car.s - CONFIG.carLength
    : lane.length - car.s + car.safetyGap;
  return idmAccel(
    car,
    car.speed,
    gap,
    car.speed - (leader?.speed ?? 0),
    Math.min(limit, car.trip.targetSpeed),
  );
}

export function assessLaneChange(
  self: Vehicle,
  source: readonly Vehicle[],
  target: readonly Vehicle[],
  lane: Lane,
  limit: number,
  required: boolean,
) {
  const old = neighbours(source, self),
    next = neighbours(target, self);
  const frontGap = next.leader
    ? next.leader.s - self.s - CONFIG.carLength
    : Infinity;
  const rearGap = next.follower
    ? self.s - next.follower.s - CONFIG.carLength
    : Infinity;
  const selfBefore = acceleration(self, old.leader, lane, limit);
  const selfAfter = acceleration(self, next.leader, lane, limit);
  const followerAfter = acceleration(next.follower, self, lane, limit);
  const safe =
    frontGap >= self.safetyGap &&
    rearGap >= (next.follower?.safetyGap ?? CONFIG.minimumGap) &&
    selfAfter >= -LANE_CHANGE.safeBrake &&
    followerAfter >= -LANE_CHANGE.safeBrake;
  const incentive =
    selfAfter -
    selfBefore +
    LANE_CHANGE.politeness *
      (followerAfter -
        acceleration(next.follower, next.leader, lane, limit) +
        acceleration(old.follower, old.leader, lane, limit) -
        acceleration(old.follower, self, lane, limit));
  return {
    allowed: safe && (required || incentive > LANE_CHANGE.threshold),
    safe,
    incentive,
    followerAfter,
    selfAfter,
  };
}

export function laneChangePose(
  from: Lane,
  to: Lane,
  s: number,
  startS: number,
  length: number,
): Pose {
  const u = Math.max(0, Math.min(1, (s - startS) / length));
  const blend = u * u * (3 - 2 * u),
    slope = (6 * u * (1 - u)) / length;
  const dx = (from.end.x - from.start.x) / from.length,
    dz = (from.end.z - from.start.z) / from.length;
  const ox = to.start.x - from.start.x,
    oz = to.start.z - from.start.z;
  return {
    x: from.start.x + dx * s + ox * blend,
    z: from.start.z + dz * s + oz * blend,
    angle: Math.atan2(dx + ox * slope, dz + oz * slope),
  };
}
