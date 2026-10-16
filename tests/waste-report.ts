import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  WasteSimulation,
  WASTE_MODEL_VERSION,
} from "../src/simulation/services/waste";
import { compareWaste } from "../src/metrics/scenarios";

const observations = [];
for (const seed of [2404, 2405, 2406]) {
  const before = new WasteSimulation(seed);
  before.runUntil(600);
  for (const policies of [
    [],
    ["extraTruck"],
    ["route"],
    ["reduce"],
    ["extraTruck", "route", "reduce"],
  ]) {
    const sim = policies.length ? new WasteSimulation(seed, policies) : before;
    sim.runUntil(600);
    const stats = sim.wasteStats;
    assert.ok(
      Math.abs(
        stats.initial + stats.generated - stats.remaining - stats.collected,
      ) < 1e-7,
    );
    assert.ok(
      Math.abs(stats.disposed + stats.inTrucks - stats.collected) < 1e-7,
    );
    observations.push({
      seed,
      policies,
      ...compareWaste(before, sim),
      trips: sim.trucks.map((t) => ({
        id: t.id,
        phase: t.phase,
        load: t.load,
        journeys: t.journeys,
      })),
      ordinaryTraffic: sim.stats.arrived,
    });
  }
}
await mkdir("output", { recursive: true });
await writeFile(
  "output/waste-experiments.json",
  JSON.stringify(
    { modelVersion: WASTE_MODEL_VERSION, duration: 600, observations },
    null,
    2,
  ),
);
console.log(
  `Verified ${observations.length} reproducible waste observations with identical external conditions and conservation of waste.`,
);
