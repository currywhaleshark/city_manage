import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  EnvironmentSimulation,
  ENVIRONMENT_MODEL_VERSION,
} from "../src/simulation/environment";
import { compareEnvironment } from "../src/metrics/environment";
const observations = [];
for (const seed of [2404, 2405, 2406]) {
  const base = new EnvironmentSimulation(seed);
  base.runUntil(420);
  for (const policies of [
    [],
    ["industry"],
    ["housing"],
    ["industry", "housing"],
    ["industry", "buffer"],
    ["industry", "conserve"],
    ["industry", "housing", "small"],
    ["conserve"],
    ["buffer"],
  ]) {
    const sim = new EnvironmentSimulation(seed, policies);
    sim.runUntil(420);
    compareEnvironment(base, sim);
    const s = sim.environmentStats;
    assert.equal(s.developedArea + s.greenArea, s.managedArea);
    assert.equal(
      sim.stats.arrived +
        sim.stats.active +
        sim.stats.queued +
        sim.stats.unreleased,
      sim.demand.length,
    );
    observations.push({ seed, policies, ...s });
  }
}
await writeFile(
  "output/environment-experiments.json",
  JSON.stringify(
    {
      modelVersion: ENVIRONMENT_MODEL_VERSION,
      note: "Educational burden proxy; not measured pollution, noise or health risk. Same 140 background trips and 60 pedestrians per comparison; development generates additional demand.",
      observations,
    },
    null,
    2,
  ),
);
console.log(`Verified ${observations.length} environment observations.`);
