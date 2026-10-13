import test from "node:test";
import assert from "node:assert/strict";
import { TrafficSimulation } from "../src/simulation";
import { CONFIG, DEFAULT_POLICY, createDemand } from "../src/scenario";
import { overlaps } from "./geometry-helper";
test("actual oriented 3D car footprints never intersect, including turns and opposing queues", () => {
  let lateralTicks = 0;
  for (const [seed, count, duration, policy] of [
    [2404, 140, 420, DEFAULT_POLICY],
    [
      2404,
      140,
      420,
      { ...DEFAULT_POLICY, signal: true, bypass: true, oneWay: true },
    ],
    [2405, 140, 600, { ...DEFAULT_POLICY, signal: true }],
    [
      2406,
      300,
      600,
      { ...DEFAULT_POLICY, signal: true, bypass: true, oneWay: true },
    ],
  ] as const) {
    const sim = new TrafficSimulation(policy, createDemand(seed, count));
    for (let t = 0; t < duration / CONFIG.dt; t++) {
      sim.step();
      const cars = [...sim.vehicles.values()];
      lateralTicks += cars.filter((car) => car.laneChange).length;
      for (let i = 0; i < cars.length; i++)
        for (let j = i + 1; j < cars.length; j++)
          assert.ok(
            !overlaps(cars[i].pose, cars[j].pose),
            `seed ${seed}, cars ${cars[i].id}/${cars[j].id} overlap at ${sim.time}s`,
          );
    }
  }
  assert.ok(
    lateralTicks > 0,
    "the collision checks include actual lane-change manoeuvres",
  );
});
