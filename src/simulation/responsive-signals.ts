import type { LiveCitySimulation } from "./live";
import { createNetwork } from "../scenario";

let defaults: Map<string, { ns: number; ew: number }> | undefined;
/** Green splits of the original plan, restored after a withdrawn signal policy. */
function defaultSplit(id: string) {
  defaults ??= new Map(
    [...createNetwork().nodes].map(([key, node]) => [key, { ns: node.signal.ns, ew: node.signal.ew }]),
  );
  return defaults.get(id)!;
}

/** The school and its western residential connections. */
export const RESPONSIVE_SIGNAL_NODES = new Set(
  Array.from({ length: 25 }, (_, i) => `n${i % 5}-${Math.floor(i / 5)}`),
);
export const RESPONSIVE_SIGNAL_OUTLINE = [
  { x: -106, z: -106 }, { x: 106, z: -106 },
  { x: 106, z: 106 }, { x: -106, z: 106 },
];
/** Commercial and industrial junctions across the river (columns 5–8). */
export const EAST_SIGNAL_TARGET = "east-junctions";
export const EAST_SIGNAL_NODES = new Set(
  Array.from({ length: 36 }, (_, i) => `n${5 + (i % 4)}-${Math.floor(i / 4)}`),
);
export const EAST_SIGNAL_OUTLINE = [
  { x: 134, z: -106 }, { x: 298, z: -106 },
  { x: 298, z: 298 }, { x: 134, z: 298 },
];

export function updateResponsiveSignals(city: LiveCitySimulation) {
  const active = city.activeActions.filter((a) => a.id === "signal");
  for (const a of active)
    updateGroup(
      city,
      a.target === EAST_SIGNAL_TARGET ? EAST_SIGNAL_NODES : RESPONSIVE_SIGNAL_NODES,
    );
  // A withdrawn district returns to its original splits, one whole cycle at a time.
  if (!city.withdrawals.some((w) => city.actions[w.action].id === "signal")) return;
  const east = active.some((a) => a.target === EAST_SIGNAL_TARGET);
  if (!east) restoreGroup(city, EAST_SIGNAL_NODES);
  if (active.length === Number(east)) restoreGroup(city, RESPONSIVE_SIGNAL_NODES);
}

function restoreGroup(city: LiveCitySimulation, nodes: Set<string>) {
  for (const id of nodes) {
    const signal = city.network.nodes.get(id)!.signal;
    const split = defaultSplit(id);
    if (signal.ns === split.ns && signal.ew === split.ew) continue;
    const cycle = signal.ns + signal.ew + 2 * (signal.yellow + signal.clearance) +
      (signal.walk ?? 0) + (signal.walkClearance ?? 0);
    const phaseTime = ((city.time + signal.offset) % cycle + cycle) % cycle;
    if (phaseTime > 1e-7 && cycle - phaseTime > 1e-7) continue;
    signal.ns = split.ns;
    signal.ew = split.ew;
    signal.offset = -city.time;
  }
}

function updateGroup(city: LiveCitySimulation, nodes: Set<string>) {
  for (const id of nodes) {
    const signal = city.network.nodes.get(id)!.signal;
    const cycle = signal.ns + signal.ew + 2 * (signal.yellow + signal.clearance) +
      (signal.walk ?? 0) + (signal.walkClearance ?? 0);
    const phaseTime = ((city.time + signal.offset) % cycle + cycle) % cycle;
    // Never interrupt a green, yellow, all-red, or pedestrian phase.
    // The new plan starts only after the entire previous cycle has finished.
    if (phaseTime > 1e-7 && cycle - phaseTime > 1e-7) continue;
    const waiting = { ns: 0, ew: 0 };
    for (const vehicle of city.vehicles.values()) {
      const lane = city.network.lanes.get(vehicle.laneId)!;
      if (lane.to !== id || vehicle.crossing || vehicle.departure ||
        vehicle.arrival?.progress !== undefined ||
        city.serviceJourneys.get(vehicle.id)?.arrived) continue;
      waiting[lane.axis] += 1 + (vehicle.speed < 1 ? 2 : 0);
    }
    // Short cycles when the junction is quiet; bounded extra green for a queue.
    // Each direction still gets >= 4 seconds and pedestrian timings are untouched.
    const green = Math.max(12, Math.min(36, Math.round(8 + 2 * (waiting.ns + waiting.ew))));
    signal.ns = Math.max(4, Math.min(green - 4,
      Math.round(green * (waiting.ns + 1) / (waiting.ns + waiting.ew + 2))));
    signal.ew = green - signal.ns;
    signal.offset = -city.time;
  }
}
