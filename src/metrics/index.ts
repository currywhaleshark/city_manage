import { CONFIG } from "../scenario";
import type { TrafficSimulation } from "../simulation";
import type { SimulationStats } from "../types";
export function collectMetrics(sim: TrafficSimulation): SimulationStats {
  const allVehicles = [...sim.vehicles.values()];
  const cars = allVehicles.filter((v) => !sim.serviceJourneys.has(v.id)),
    completed = sim.completed;
  const totalWaitingTime =
    completed.reduce((s, v) => s + v.waitingTime, 0) +
    cars.reduce((s, v) => s + v.waitingTime, 0) +
    sim.pending.reduce((s, t) => s + sim.time - t.departAt, 0);
  const roads = [...sim.network.roads.values()].map((road) => {
    const vehicles = allVehicles.filter(
      (v) => sim.network.lanes.get(v.laneId)!.roadId === road.id,
    );
    const stopped = vehicles.filter((v) => v.speed < 0.3).length;
    const meanSpeed = vehicles.length
      ? vehicles.reduce((s, v) => s + v.speed, 0) / vehicles.length
      : road.speedLimit;
    const capacity =
      ((road.length - 2 * CONFIG.junctionRadius) /
        (CONFIG.carLength + CONFIG.minimumGap)) *
      road.laneCount *
      (road.direction === "two-way" ? 2 : 1);
    const congestion = vehicles.length
      ? Math.min(
          1,
          (0.45 * vehicles.length) / capacity +
            0.55 * (1 - meanSpeed / road.speedLimit),
        )
      : 0;
    return {
      id: road.id,
      name: road.name,
      count: vehicles.length,
      stopped,
      meanSpeed,
      congestion,
    };
  });
  return {
    time: sim.time,
    arrived: completed.length,
    active: cars.length,
    queued: sim.pending.length,
    unreleased: sim.demand.length - sim.releasedCount,
    unreachable: sim.pending.filter(
      (t) => !sim.route(t.origin, t.destination).length,
    ).length,
    averageTravelTime: completed.length
      ? completed.reduce((s, v) => s + v.travelTime, 0) / completed.length
      : null,
    averageWaitingTime: completed.length
      ? completed.reduce((s, v) => s + v.waitingTime, 0) / completed.length
      : null,
    averageDemandWait: sim.releasedCount
      ? totalWaitingTime / sim.releasedCount
      : null,
    stopped: cars.filter((v) => v.speed < 0.3).length,
    meanSpeed: cars.length
      ? cars.reduce((s, v) => s + v.speed, 0) / cars.length
      : 0,
    totalWaitingTime,
    roads,
  };
}
export const formatSeconds = (n: number | null) =>
  n === null ? "집계 중" : `${n.toFixed(1)}초`;
