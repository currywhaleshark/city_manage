import type { LiveCitySimulation } from "./live";

/** The school and its western residential connections; eastern industry is unchanged. */
export const RESPONSIVE_SIGNAL_NODES = new Set(
  Array.from({ length: 25 }, (_, i) => `n${i % 5}-${Math.floor(i / 5)}`),
);
export const RESPONSIVE_SIGNAL_OUTLINE = [
  { x: -106, z: -106 }, { x: 106, z: -106 },
  { x: 106, z: 106 }, { x: -106, z: 106 },
];

export function updateResponsiveSignals(city: LiveCitySimulation) {
  if (!city.has("signal")) return;
  for (const id of RESPONSIVE_SIGNAL_NODES) {
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
