import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONFIG,
  createDemand,
  createNetwork,
  DEFAULT_POLICY,
} from "../src/scenario";
import { createPedestrianDemand } from "../src/simulation/pedestrians";
import { getScenario, SCENARIOS } from "../src/scenarios";
import {
  WasteSimulation,
  WASTE_POLICIES,
} from "../src/simulation/services/waste";
import { compareWaste } from "../src/metrics/scenarios";
import { applyPolicies } from "../src/policies/definition";
import { residentVoices } from "../src/simulation/residents";
import { readExperimentRecord } from "../src/records";
import { overlaps } from "./geometry-helper";
import { legacyDemand } from "./fixtures/legacy-demand";

test("historical v4 demand retains its 45 traffic outcomes after the city network changes", () => {
  const expected = JSON.parse(
    readFileSync(
      new URL("./fixtures/traffic-v4-reference.json", import.meta.url),
      "utf8",
    ),
  );
  const policyIds: Record<string, string[]> = {
    baseline: [],
    signal: ["signal"],
    bypass: ["bypass"],
    oneWay: ["oneWay"],
    combined: ["signal", "bypass", "oneWay"],
  };
  for (const seed of [2404, 2405, 2406])
    for (const [policy, ids] of Object.entries(policyIds)) {
      const demand = legacyDemand(seed),
        pedestrians = createPedestrianDemand(seed);
      const sim = getScenario("traffic").create(
        { seed, duration: 420, demand, pedestrians },
        ids,
        26,
      );
      assert.equal(sim.demand, demand);
      assert.equal(sim.pedestrians.demand, pedestrians);
      for (const duration of [180, 420, 600]) {
        sim.runUntil(duration);
        const row = expected.find(
          (r: any) =>
            r.seed === seed && r.policy === policy && r.duration === duration,
        );
        const { roads, ...stats } = sim.stats;
        assert.deepEqual(stats, row.stats);
        assert.deepEqual(sim.pedestrians.stats, row.pedestrians);
      }
    }
  assert.deepEqual(
    SCENARIOS.map((s) => s.id),
    [
      "traffic",
      "waste",
      "facilities",
      "environment",
      "logistics",
      "parking",
      "dumping",
      "water",
    ],
  );
  assert.throws(() => getScenario("economy"));
});

test("service trucks share roads and signals, collect only at a stop, conserve mass and never overlap traffic", () => {
  for (const seed of [2404, 2405]) {
    const sim = new WasteSimulation(seed, ["extraTruck"]);
    let lastEvents = 0,
      lastTrafficEvents = 0,
      full = false,
      unloading = false,
      blockedFollowers = false;
    for (let tick = 0; tick < 9000; tick++) {
      sim.step();
      const cars = [...sim.vehicles.values()];
      for (const truck of sim.trucks) {
        assert.ok(truck.load >= -1e-8 && truck.load <= truck.capacity + 1e-8);
        if (truck.load >= truck.capacity - 1e-8) full = true;
        const v = sim.vehicles.get(truck.id);
        if (!v) {
          assert.ok(
            truck.phase === "finished" ||
              truck.phase === "blocked" ||
              sim.servicePending.some((t) => t.id === truck.id),
          );
          continue;
        }
        assert.ok(sim.network.lanes.has(v.laneId));
        for (const walker of sim.pedestrians.active.values()) {
          const dx = walker.pose.x - v.pose.x,
            dz = walker.pose.z - v.pose.z;
          const lateral = Math.abs(
            dx * Math.cos(v.pose.angle) - dz * Math.sin(v.pose.angle),
          );
          const forward = Math.abs(
            dx * Math.sin(v.pose.angle) + dz * Math.cos(v.pose.angle),
          );
          assert.ok(
            Math.hypot(
              Math.max(0, lateral - CONFIG.carWidth / 2),
              Math.max(0, forward - CONFIG.carLength / 2),
            ) >= 0.27,
            `service/pedestrian conflict at ${sim.time}`,
          );
        }
        for (const other of cars)
          if (other.id !== v.id)
            assert.ok(
              !overlaps(v.pose, other.pose),
              `collision at ${sim.time}: ${v.id}/${other.id}`,
            );
        if (truck.phase === "collecting" || truck.phase === "unloading") {
          assert.ok(sim.serviceJourneys.get(truck.id)!.arrived);
          assert.equal(v.speed, 0);
          if (
            cars.some(
              (other) =>
                other.id !== v.id &&
                other.laneId === v.laneId &&
                other.s < v.s &&
                other.speed < 0.3,
            )
          )
            blockedFollowers = true;
        }
      }
      for (const event of sim.serviceEvents.slice(lastEvents)) {
        if (event.type === "collect") {
          const truck = sim.trucks.find((t) => t.id === event.truck)!;
          const car = sim.vehicles.get(truck.id)!;
          assert.equal(
            car.laneId,
            sim.sites.find((s) => s.id === event.site)!.laneId,
          );
          assert.equal(car.speed, 0);
        }
        if (event.type === "unload") {
          unloading = true;
          assert.equal(event.site, "depot");
        }
      }
      lastEvents = sim.serviceEvents.length;
      for (const event of sim.events.slice(lastTrafficEvents))
        if (event.vehicle >= 10000 && event.type === "enter") {
          assert.equal(
            event.phase,
            `${sim.network.lanes.get(event.fromLaneId!)!.axis}-green`,
          );
        }
      lastTrafficEvents = sim.events.length;
      for (const site of sim.sites)
        assert.ok(
          Math.abs(
            site.initial + site.generated - site.collected - site.remaining,
          ) < 1e-6,
        );
      assert.ok(
        Math.abs(
          sim.sites.reduce((n, s) => n + s.collected, 0) -
            sim.disposed -
            sim.trucks.reduce((n, t) => n + t.load, 0),
        ) < 1e-6,
      );
      assert.equal(
        sim.completed.length +
          cars.filter((v) => !sim.serviceJourneys.has(v.id)).length +
          sim.pending.length +
          sim.demand.length -
          sim.releasedCount,
        140,
      );
    }
    assert.ok(full && unloading && blockedFollowers);
    assert.ok(sim.sites.some((s) => s.collected > 0));
  }
});

test("garbage cannot disappear before arrival, and traffic delays change collection", () => {
  const network = createNetwork();
  for (const node of network.nodes.values())
    node.signal = { ns: 0, ew: 0, yellow: 10000, clearance: 1, offset: 0 };
  const blocked = new WasteSimulation(2404, [], network);
  blocked.runUntil(300);
  assert.equal(blocked.wasteStats.collected, 0);
  assert.ok(blocked.wasteStats.generated > 0);
  const free = new WasteSimulation(2404, [], undefined, 0),
    busy = new WasteSimulation(2404);
  free.runUntil(600);
  busy.runUntil(600);
  assert.notEqual(free.wasteStats.collected, busy.wasteStats.collected);
  assert.ok(
    free.trucks.flatMap((t) => t.journeys).length >
      busy.trucks.flatMap((t) => t.journeys).length,
  );
  free.runUntil(3000);
  assert.ok(free.trucks.every((t) => t.phase === "finished"));
  assert.equal(free.serviceJourneys.size, 0);
  assert.equal(free.wasteStats.inTrucks, 0);
  assert.ok(
    Math.abs(free.wasteStats.disposed - free.wasteStats.collected) < 1e-6,
  );
});

test("waste policies alter real dispatch and future generation, with reproducible regional tradeoffs", () => {
  const base = new WasteSimulation(),
    route = new WasteSimulation(2404, ["route"]),
    reduce = new WasteSimulation(2404, ["reduce"]),
    extra = new WasteSimulation(2404, ["extraTruck"]);
  assert.equal(extra.trucks.length, base.trucks.length + 1);
  assert.notDeepEqual(
    route.trucks.map((t) => t.itinerary),
    base.trucks.map((t) => t.itinerary),
  );
  assert.deepEqual(
    reduce.sites.map((s) => s.initial),
    base.sites.map((s) => s.initial),
  );
  for (const sim of [base, route, reduce, extra]) sim.runUntil(600);
  assert.ok(reduce.wasteStats.generated < base.wasteStats.generated);
  const comparison = compareWaste(base, route);
  assert.ok(comparison.sites.some((s) => s.afterRemaining > s.beforeRemaining));
  assert.ok(comparison.sites.some((s) => s.afterRemaining < s.beforeRemaining));
  const repeat = new WasteSimulation(2404, ["route"]);
  repeat.runUntil(600);
  assert.deepEqual(repeat.wasteStats, route.wasteStats);
  assert.deepEqual(repeat.serviceEvents, route.serviceEvents);
  const secondMorning = new WasteSimulation(2405);
  secondMorning.runUntil(600);
  assert.throws(() => compareWaste(base, secondMorning), /같은 아침/);
  assert.throws(
    () =>
      applyPolicies(
        WASTE_POLICIES,
        ["extraTruck", "route", "reduce"],
        { trucks: 2, reordered: false, reduction: false },
        99,
      ),
    /예산/,
  );
  assert.throws(() => new WasteSimulation(2404, ["signal"]));
  const voices = residentVoices(route, base);
  assert.equal(voices.length, 6);
  assert.ok(voices.every((v) => v.fact && v.opinion && v.change));
});

test("record reader migrates v3 traffic and reads v4 waste without executing imported text", () => {
  const before = new WasteSimulation(),
    after = new WasteSimulation(2404, ["route"]);
  before.runUntil(60);
  after.runUntil(60);
  const record = {
    schemaVersion: 4,
    scenarioId: "waste",
    seed: 2404,
    duration: 60,
    modelVersion: "pedestrians-v4",
    before: before.stats,
    after: after.stats,
    wasteBefore: before.wasteStats,
    wasteAfter: after.wasteStats,
    reflection: "<script>danger()</script>",
  };
  const view = readExperimentRecord(JSON.stringify(record));
  assert.equal(view.regions.length, 6);
  assert.equal(view.reflection, record.reflection);
  const v3 = {
    ...record,
    schemaVersion: 3,
    scenarioId: undefined,
    reflection: "앞차와 보행자를 살펴봤어요.",
  };
  assert.equal(readExperimentRecord(JSON.stringify(v3)).scenarioId, "traffic");
  assert.throws(() => readExperimentRecord("not JSON"));
  assert.throws(() =>
    readExperimentRecord(JSON.stringify({ ...record, schemaVersion: 8 })),
  );
  assert.throws(() =>
    readExperimentRecord(JSON.stringify({ ...record, duration: 59 })),
  );
});
