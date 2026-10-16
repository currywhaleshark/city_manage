import { LiveCitySimulation, restoreLiveCity } from "../src/simulation/live";
import { writeFile } from "node:fs/promises";
import {
  captureLiveCheckpoint,
  restoreLiveCheckpoint,
} from "../src/simulation/checkpoint";
import assert from "node:assert/strict";
const sim = new LiveCitySimulation();
const stages = [];
for (const until of [300, 900, 1800]) {
  const start = performance.now();
  sim.runUntil(until);
  stages.push({
    until,
    ms: performance.now() - start,
    vehicles: sim.vehicles.size,
    pending: sim.pending.length,
    packets: sim.water.packets.length,
    serviceHistory: sim.trucks.map((t) => t.journeys.length),
  });
}
const start = performance.now();
await restoreLiveCity(sim.save());
const restoreMs = performance.now() - start;
const captureStart = performance.now();
const checkpoint = captureLiveCheckpoint(sim);
const captureMs = performance.now() - captureStart;
const checkpointStart = performance.now();
const copy = restoreLiveCheckpoint(checkpoint, sim.save());
const checkpointRestoreMs = performance.now() - checkpointStart;
assert.deepEqual(copy.values, sim.values);
const report = { stages, restoreMs, captureMs, checkpointRestoreMs };
console.log(JSON.stringify(report, null, 2));
await writeFile(
  `output/live-engine-${process.argv[2] ?? "latest"}.json`,
  JSON.stringify(report, null, 2),
);
