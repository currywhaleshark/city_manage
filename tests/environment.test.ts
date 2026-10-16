import test from "node:test";
import assert from "node:assert/strict";
import {
  EnvironmentSimulation,
  ENVIRONMENT_POLICIES,
  MANAGED_AREA,
  crossesBuffer,
  distanceWeight,
} from "../src/simulation/environment";
import { createDemand, DEFAULT_POLICY } from "../src/scenario";
import { createPedestrianDemand } from "../src/simulation/pedestrians";
import { TrafficSimulation } from "../src/simulation";
import { compareEnvironment } from "../src/metrics/environment";
import { compareScenario } from "../src/metrics/scenarios";
import { FacilitySimulation } from "../src/simulation/facilities";
import { readExperimentRecord } from "../src/records";
import { residentVoices } from "../src/simulation/residents";

test("all development plans preserve land, original demand and stable added trip identities", () => {
  for (const seed of [2404, 2405, 2406]) {
    const full = new EnvironmentSimulation(seed, ["industry", "housing"]);
    for (let mask = 0; mask < 32; mask++) {
      const policies = ENVIRONMENT_POLICIES.filter((_, i) => mask & (1 << i));
      const ids = policies.map((p) => p.id);
      if (policies.reduce((n, p) => n + p.cost, 0) > 100) {
        assert.throws(() => new EnvironmentSimulation(seed, ids), /예산/);
        continue;
      }
      const sim = new EnvironmentSimulation(seed, ids),
        s = sim.environmentStats;
      assert.equal(s.developedArea + s.greenArea, MANAGED_AREA);
      assert.deepEqual(sim.backgroundDemand, createDemand(seed));
      assert.deepEqual(sim.pedestrians.demand, createPedestrianDemand(seed));
      assert.deepEqual(
        sim.demand.filter((t) => t.id < 2000),
        sim.backgroundDemand,
      );
      assert.equal(
        new Set(sim.demand.map((t) => t.id)).size,
        sim.demand.length,
      );
      assert.equal(s.addedTrips, s.workCapacity + s.housingCapacity / 2);
      for (const p of sim.parcels) {
        assert.equal(p.developedArea + p.greenArea, 288);
        assert.ok(p.protectedArea <= p.greenArea);
      }
      for (const t of sim.addedDemand)
        assert.deepEqual(
          t,
          full.addedDemand.find((f) => f.id === t.id),
        );
      assert.equal(s.meanBurden, null);
    }
  }
  assert.throws(
    () => new EnvironmentSimulation(2404, ["industry", "industry"]),
  );
  assert.throws(() => new EnvironmentSimulation(2404, ["unknown"]));
});

test("buffer screening follows location and preserves jobs, green area and vehicle behaviour", () => {
  assert.ok(
    distanceWeight({ x: 0, z: 0 }, { x: 2, z: 0 }, 45) >
      distanceWeight({ x: 0, z: 0 }, { x: 100, z: 0 }, 45),
  );
  assert.equal(crossesBuffer({ x: 216, z: 168 }, { x: 72, z: 168 }), true);
  assert.equal(crossesBuffer({ x: 216, z: 192 }, { x: 72, z: 192 }), false); // road gap remains open
  const a = new EnvironmentSimulation(2404, ["industry"]),
    b = new EnvironmentSimulation(2404, ["industry", "buffer"]);
  a.runUntil(180);
  b.runUntil(180);
  assert.deepEqual(a.stats, b.stats);
  assert.deepEqual(a.completed, b.completed);
  const old = a.environmentStats,
    next = b.environmentStats;
  assert.equal(old.workCapacity, next.workCapacity);
  assert.equal(old.greenArea, next.greenArea);
  assert.ok(next.meanBurden! < old.meanBurden!);
  const reduction = (id: string) =>
    old.regions.find((r) => r.id === id)!.meanBurden! -
    next.regions.find((r) => r.id === id)!.meanBurden!;
  assert.ok(reduction("block-5-5") > reduction("b0")); // The nearby industrial block benefits more than the distant homes.
  assert.ok(
    next.regions.some((r, i) => r.meanBurden! < old.regions[i].meanBurden!),
  );
  next.regions.forEach((r, i) =>
    assert.equal(r.meanTrafficBurden, old.regions[i].meanTrafficBurden),
  );
});

test("actual road occupancy drives time-sampled burden and all new trips use the shared engine", () => {
  const sim = new EnvironmentSimulation(2404, ["industry", "housing"]);
  const engine = new TrafficSimulation(
    DEFAULT_POLICY,
    sim.demand,
    undefined,
    sim.pedestrians.demand,
  );
  assert.ok(sim.environmentStats.regions.every((r) => r.trafficBurden === 0));
  let activeAdded = false;
  for (let i = 0; i < 4200; i++) {
    sim.step();
    engine.step();
    assert.equal(sim.vehicles.size, engine.vehicles.size);
    if (i % 10 !== 9) continue;
    for (const [id, vehicle] of sim.vehicles) {
      assert.deepEqual(vehicle.pose, engine.vehicles.get(id)!.pose);
      if (id >= 2000) {
        activeAdded = true;
        assert.ok(sim.network.lanes.has(vehicle.laneId));
      }
    }
    const s = sim.environmentStats;
    assert.equal(s.sampleCount, Math.floor((i + 1) / 10));
    assert.equal(
      sim.stats.arrived +
        sim.stats.active +
        sim.stats.queued +
        sim.stats.unreleased,
      sim.demand.length,
    );
  }
  assert.ok(activeAdded);
  assert.deepEqual(sim.stats, engine.stats);
  const s = sim.environmentStats;
  assert.ok(s.regions.some((r) => r.meanTrafficBurden! > 0));
  assert.equal(s.backgroundArrived + s.addedArrived, sim.completed.length);
  assert.ok(s.industryArrived <= s.industryTrips);
  assert.ok(s.addedArrived > 0);
});

test("environment sampling is cadence independent and fair comparison allows only generated demand changes", () => {
  const a = new EnvironmentSimulation(2405, ["housing"]),
    b = new EnvironmentSimulation(2405, ["housing"]);
  a.runUntil(60);
  for (let i = 0; i < 3600; i++) b.advance(1 / 60);
  assert.deepEqual(a.environmentStats, b.environmentStats);
  assert.deepEqual(a.stats, b.stats);
  const base = new EnvironmentSimulation(2405);
  base.runUntil(60);
  assert.equal(compareScenario(base, a).scenarioId, "environment");
  assert.throws(() => compareScenario(base, new FacilitySimulation()));
  assert.throws(() =>
    compareEnvironment(base, new EnvironmentSimulation(2404)),
  );
  assert.throws(() =>
    compareEnvironment(base, new EnvironmentSimulation(2405)),
  );
  assert.equal(residentVoices(a, base).length, 4);
  assert.ok(
    residentVoices(a, base).every((v) => v.change && v.fact.includes("가상")),
  );
});

test("preservation limits proposed development without removing existing activity or inventing growth scores", () => {
  const preserve = new EnvironmentSimulation(2404, ["conserve"]),
    base = new EnvironmentSimulation();
  assert.deepEqual(preserve.demand, base.demand);
  assert.equal(
    preserve.environmentStats.greenArea,
    base.environmentStats.greenArea,
  );
  assert.equal(preserve.environmentStats.protectedArea, 384);
  const full = new EnvironmentSimulation(2404, ["industry", "housing"]);
  const reduced = new EnvironmentSimulation(2404, [
    "industry",
    "housing",
    "small",
  ]);
  const conserved = new EnvironmentSimulation(2404, [
    "industry",
    "housing",
    "conserve",
  ]);
  assert.equal(
    reduced.environmentStats.developedArea,
    full.environmentStats.developedArea / 2,
  );
  assert.deepEqual(reduced.demand, conserved.demand);
  assert.equal(reduced.environmentStats.workCapacity, 24);
  assert.equal(reduced.environmentStats.housingCapacity, 24);
});

test("environment records retain land, regional burden and changed demand without implying measured pollution", () => {
  const before = new EnvironmentSimulation(),
    after = new EnvironmentSimulation(2404, [
      "industry",
      "buffer",
      "conserve",
      "small",
    ]);
  before.runUntil(60);
  after.runUntil(60);
  const record = {
    schemaVersion: 4,
    scenarioId: "environment",
    timeUnit: "seconds",
    seed: 2404,
    duration: 60,
    environmentModelVersion: "development-environment-v1",
    before: before.stats,
    after: after.stats,
    environmentBefore: before.environmentStats,
    environmentAfter: after.environmentStats,
    policyIds: after.policyIds,
    decisionReason: "녹지도 남겨요.",
    reflection: "<b>가상 지표</b>",
  };
  const view = readExperimentRecord(JSON.stringify(record));
  assert.equal(view.scenarioId, "environment");
  assert.equal(view.regions.length, 17);
  assert.equal(view.policies.length, 4);
  assert.ok(view.timeLabel.includes("가상 지표"));
  assert.equal(view.reflection, record.reflection);
  for (const invalid of [
    { environmentAfter: { ...record.environmentAfter, greenArea: 9999 } },
    { environmentAfter: { ...record.environmentAfter, time: 1 } },
    { policyIds: ["industry", "industry"] },
  ])
    assert.throws(() =>
      readExperimentRecord(JSON.stringify({ ...record, ...invalid })),
    );
});
