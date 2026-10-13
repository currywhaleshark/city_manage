import { createPedestrianDemand } from "../src/simulation/pedestrians";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { TrafficSimulation, MODEL_VERSION } from "../src/simulation";
import { createDemand, createNetwork, DEFAULT_POLICY } from "../src/scenario";
import { compareExperiments } from "../src/metrics/comparison";

const seeds = [2404, 2405, 2406];
const windows = [180, 420, 600];
const policies = {
  baseline: DEFAULT_POLICY,
  signal: { ...DEFAULT_POLICY, signal: true },
  bypass: { ...DEFAULT_POLICY, bypass: true },
  oneWay: { ...DEFAULT_POLICY, oneWay: true },
  combined: { ...DEFAULT_POLICY, signal: true, bypass: true, oneWay: true },
};
const experiments = [];
for (const seed of seeds) {
  const demand = createDemand(seed);
  const walkers = createPedestrianDemand(seed);
  const simulations = Object.entries(policies).map(([name, policy]) => ({
    name,
    sim: new TrafficSimulation(policy, demand, undefined, walkers),
  }));
  const baseline = simulations[0].sim;
  for (const duration of windows) {
    for (const { sim } of simulations) sim.runUntil(duration);
    for (const { name, sim } of simulations) {
      const { roads, ...stats } = sim.stats;
      assert.equal(
        stats.arrived + stats.active + stats.queued + stats.unreleased,
        demand.length,
      );
      assert.equal(sim.demand, baseline.demand);
      assert.equal(sim.pedestrians.demand, baseline.pedestrians.demand);
      const people = sim.pedestrians.stats;
      assert.equal(
        people.arrived + people.active + people.queued + people.unreleased,
        walkers.length,
      );
      const analysis = compareExperiments(baseline, sim);
      assert.equal(
        analysis.byPurpose.reduce((sum, group) => sum + group.total, 0),
        demand.length,
      );
      assert.equal(
        analysis.byDirection.reduce((sum, group) => sum + group.total, 0),
        demand.length,
      );
      experiments.push({
        seed,
        duration,
        policy: name,
        laneChanges: sim.laneChangeEvents.length,
        stats,
        pedestrians: sim.pedestrians.stats,
        arrivalChange: stats.arrived - baseline.stats.arrived,
        waitChange:
          stats.averageDemandWait! - baseline.stats.averageDemandWait!,
        analysis,
      });
    }
  }
}

// Synthetic queues measure this model's discharge behavior, not calibrated road capacity.
const network = createNetwork();
for (const node of network.nodes.values())
  node.signal = { ns: 1, ew: 1000, yellow: 1, clearance: 1, offset: 3 };
const template = createDemand()[0];
const queuedDemand = Array.from({ length: 24 }, (_, id) => ({
  ...template,
  id,
  departAt: 0,
  origin: id % 2 === 0 ? "n1-2" : "n3-2",
  destination: id % 2 === 0 ? "n3-2" : "n1-2",
}));
const queue = new TrafficSimulation(DEFAULT_POLICY, queuedDemand, network);
let simultaneousTicks = 0;
while (queue.completed.length < queuedDemand.length && queue.time < 600) {
  queue.step();
  if (
    [...queue.vehicles.values()].filter((v) => v.crossing?.nodeId === "n2-2")
      .length > 1
  )
    simultaneousTicks++;
}
assert.equal(queue.completed.length, 24);
assert.ok(simultaneousTicks > 0);
const discharge = ["n1-2", "n3-2"].map((origin) => {
  const entries = queue.events.filter(
    (e) =>
      e.type === "enter" &&
      e.node === "n2-2" &&
      queuedDemand[e.vehicle].origin === origin,
  );
  assert.equal(entries.length, 12);
  const headways = entries
    .slice(1)
    .map((entry, i) => entry.time - entries[i].time);
  return {
    origin,
    crossed: entries.length,
    firstEntry: entries[0].time,
    lastEntry: entries.at(-1)!.time,
    meanEntryHeadwaySeconds:
      headways.reduce((sum, time) => sum + time, 0) / headways.length,
  };
});
const report = {
  modelVersion: MODEL_VERSION,
  seeds,
  windows,
  demandCount: 140,
  pedestrianCount: 60,
  experiments,
  queueDischarge: {
    note: "Synthetic continuously green junction with 12 trips in each opposing direction. Model observation only; not calibrated saturation flow.",
    allArrivedAt: queue.time,
    simultaneousSeconds: simultaneousTicks * 0.1,
    directions: discharge,
  },
};
mkdirSync("output", { recursive: true });
writeFileSync("output/experiments.json", JSON.stringify(report, null, 2));
console.table(
  experiments.map(
    ({ seed, duration, policy, stats, arrivalChange, waitChange }) => ({
      seed,
      seconds: duration,
      policy,
      arrived: stats.arrived,
      arrivalChange,
      averageWait: Number(stats.averageDemandWait!.toFixed(1)),
      waitChange: Number(waitChange.toFixed(1)),
    }),
  ),
);
console.log(JSON.stringify(report.queueDischarge, null, 2));
console.log(
  `Verified ${experiments.length} observations. Saved output/experiments.json`,
);
