import { mkdirSync, writeFileSync } from "node:fs";
import { MODEL_VERSION } from "../src/simulation";
import { standingQueue, measureDischarge } from "./queue-fixture";

const scenarios = [];
for (const [name, turn, blocked] of [
  ["straight", false, false],
  ["turn", true, false],
  ["blocked-exit", false, true],
] as const) {
  const { sim, greenAt } = standingQueue(30, turn, blocked);
  let maxConcurrent = 0;
  while (sim.time < greenAt + 150 && sim.completed.length < sim.demand.length) {
    sim.step();
    maxConcurrent = Math.max(
      maxConcurrent,
      [...sim.vehicles.values()].filter((v) => v.crossing?.nodeId === "b")
        .length,
    );
  }
  const measurement = measureDischarge(sim, greenAt);
  scenarios.push({
    name,
    ...measurement,
    saturationFlowPerHourPerLane: blocked
      ? null
      : measurement.saturationFlowPerHourPerLane,
    maxConcurrent,
    arrived: sim.completed.length,
    pending: sim.pending.length,
    active: sim.vehicles.size,
    endedAt: sim.time,
  });
}
const report = {
  modelVersion: MODEL_VERSION,
  reference: {
    title: "FHWA Traffic Signal Timing Manual (2008, archived), Chapter 3.3.2",
    url: "https://ops.fhwa.dot.gov/publications/fhwahop08024/chapter3.htm",
    commonlyObservedRange: [1500, 2000],
    unit: "passenger cars/hour/lane of continuous green",
    note: "A published comparison range, not local calibration data. Straight standing-queue headways after vehicle 4 are compared; a blocked exit is not a saturation-flow measurement.",
  },
  parameters: {
    speed: 8,
    headway: 1.1,
    minimumGap: 1.5,
    carLength: 3.8,
    approachLength: 256,
    queuedCars: 30,
  },
  scenarios,
};
mkdirSync("output", { recursive: true });
writeFileSync("output/capacity.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
