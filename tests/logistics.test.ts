import test from "node:test";
import assert from "node:assert/strict";
import {
  LogisticsSimulation,
  LOGISTICS_POLICIES,
} from "../src/simulation/economy";
import { createDemand, createNetwork } from "../src/scenario";
import { createPedestrianDemand } from "../src/simulation/pedestrians";
import { compareLogistics } from "../src/metrics/logistics";
import { compareScenario } from "../src/metrics/scenarios";
import { residentVoices } from "../src/simulation/residents";
import { appliedPolicyMap } from "../src/policies/map";
import { readExperimentRecord } from "../src/records";
import { stockBand } from "../src/renderer/map-data";
import { overlaps } from "./geometry-helper";

const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);
function conserved(sim: LogisticsSimulation) {
  for (const s of sim.shops) {
    close(s.initial + s.delivered, s.stock + s.sold);
    close(s.requested, s.sold + s.unmet);
    close(
      Object.values(s.bySource).reduce((a, b) => a + b, 0),
      s.delivered,
    );
    assert.ok(s.stock >= 0 && s.stock <= s.capacity);
  }
  for (const s of sim.sources)
    close(s.initial + s.generated, s.stock + s.loaded);
  for (const t of sim.trucks) assert.ok(t.load >= 0 && t.load <= t.capacity);
  close(
    sim.sources.reduce((n, s) => n + s.loaded, 0),
    sim.logisticsStats.delivered + sim.logisticsStats.inTrucks,
  );
}

test("logistics policies preserve seed conditions, shared traffic demand and finite budget", () => {
  for (const seed of [2404, 2405, 2406]) {
    const base = new LogisticsSimulation(seed);
    for (let mask = 0; mask < 16; mask++) {
      const policies = LOGISTICS_POLICIES.filter((_, i) => mask & (1 << i)),
        ids = policies.map((p) => p.id);
      if (policies.reduce((n, p) => n + p.cost, 0) > 100) {
        assert.throws(() => new LogisticsSimulation(seed, ids), /예산/);
        continue;
      }
      const sim = new LogisticsSimulation(seed, ids);
      assert.deepEqual(sim.demand, createDemand(seed));
      assert.deepEqual(sim.pedestrians.demand, createPedestrianDemand(seed));
      assert.deepEqual(sim.shops, base.shops);
      assert.deepEqual(
        sim.sources.filter((s) => s.id !== "west-region"),
        base.sources,
      );
      assert.equal(sim.trucks.length, ids.includes("cargoTruck") ? 3 : 2);
      assert.deepEqual(sim.trucks.flatMap((t) => t.itinerary).sort(), [
        "east",
        "north",
        "park",
        "south",
      ]);
      assert.equal(sim.sources.length, ids.includes("diversify") ? 3 : 2);
      assert.equal(sim.logisticsStats.delivered, 0);
    }
  }
  assert.throws(() => new LogisticsSimulation(2404, ["handling", "handling"]));
  assert.throws(() => new LogisticsSimulation(2404, ["unknown"]));
});

test("cargo physically stops to transfer goods, shares signals and traffic, and conserves every box", () => {
  const sim = new LogisticsSimulation(2405, ["cargoTruck", "handling"]);
  let lastGoods = 0,
    lastTraffic = 0,
    loaded = false,
    delivered = false,
    waitingFollowers = false;
  for (let tick = 0; tick < 6000; tick++) {
    sim.step();
    conserved(sim);
    for (const t of sim.trucks) {
      const v = sim.vehicles.get(t.id);
      if (!v) continue;
      assert.ok(sim.network.lanes.has(v.laneId));
      for (const other of sim.vehicles.values())
        if (other.id !== v.id)
          assert.ok(
            !overlaps(v.pose, other.pose),
            `cargo collision ${sim.time}: ${v.id}/${other.id}`,
          );
      if (t.phase === "loading" || t.phase === "unloading") {
        assert.ok(sim.serviceJourneys.get(t.id)!.arrived);
        assert.equal(v.speed, 0);
        if (
          [...sim.vehicles.values()].some(
            (o) =>
              o.id !== v.id &&
              o.laneId === v.laneId &&
              o.s < v.s &&
              o.speed < 0.3,
          )
        )
          waitingFollowers = true;
      }
    }
    for (const event of sim.goodsEvents.slice(lastGoods)) {
      if (event.type === "arrival") continue;
      const v = sim.vehicles.get(event.truck)!;
      assert.equal(v.speed, 0);
      const destination = [...sim.sources, ...sim.shops].find(
        (s) => s.id === event.place,
      )!;
      assert.equal(v.laneId, destination.laneId);
      assert.ok(
        sim.goodsEvents.some(
          (e) =>
            e.type === "arrival" &&
            e.place === event.place &&
            e.truck === event.truck &&
            e.time < event.time,
        ),
      );
      if (event.type === "load") loaded = true;
      if (event.type === "deliver") delivered = true;
    }
    lastGoods = sim.goodsEvents.length;
    for (const event of sim.events.slice(lastTraffic))
      if (event.vehicle >= 20000 && event.type === "enter")
        assert.equal(
          event.phase,
          `${sim.network.lanes.get(event.fromLaneId!)!.axis}-green`,
        );
    lastTraffic = sim.events.length;
    assert.equal(
      sim.stats.arrived +
        sim.stats.active +
        sim.stats.queued +
        sim.stats.unreleased,
      140,
    );
  }
  assert.ok(loaded && delivered && waitingFollowers);
  assert.ok(sim.logisticsStats.externalDelivered > 0);
  assert.equal(
    sim.completed.some((v) => v.id >= 20000),
    false,
  );
});

test("goods do not reach stores before trucks arrive and a blocked external entry delays deliveries", () => {
  const network = createNetwork();
  for (const node of network.nodes.values())
    node.signal = { ns: 0, ew: 0, yellow: 10000, clearance: 1, offset: 0 };
  const blocked = new LogisticsSimulation(2404, ["handling"], network);
  blocked.runUntil(300);
  assert.equal(blocked.logisticsStats.delivered, 0);
  assert.ok(blocked.logisticsStats.produced > 0);
  assert.ok(blocked.logisticsStats.unmet > 0);
  conserved(blocked);
  const free = new LogisticsSimulation(2405, [], undefined, 0),
    busy = new LogisticsSimulation(2405);
  // A vehicle stopped on the real external entry must delay following cargo.
  busy.dispatchService(29999, "boundary-east-1", "external-east-in:boundary-east-1:0", 0x888888);
  free.runUntil(600);
  busy.runUntil(600);
  assert.notEqual(free.logisticsStats.delivered, busy.logisticsStats.delivered);
  assert.deepEqual(
    free.shops.map((s) => s.requested),
    busy.shops.map((s) => s.requested),
  );
});

test("cargo sampling is cadence independent and comparison rejects changed conditions", () => {
  const a = new LogisticsSimulation(2405, ["handling"]),
    b = new LogisticsSimulation(2405, ["handling"]);
  a.runUntil(60);
  for (let i = 0; i < 3600; i++) b.advance(1 / 60);
  assert.deepEqual(a.logisticsStats, b.logisticsStats);
  assert.deepEqual(a.goodsEvents, b.goodsEvents);
  const before = new LogisticsSimulation(2405);
  before.runUntil(60);
  assert.equal(compareScenario(before, a).scenarioId, "logistics");
  assert.equal(compareLogistics(before, a).rows.length, 7);
  assert.throws(() => compareLogistics(before, new LogisticsSimulation(2404)));
  assert.throws(() => compareLogistics(before, new LogisticsSimulation(2405)));
  a.sources[0].rate += 1;
  assert.throws(() => compareLogistics(before, a));
});

test("logistics map, opinions and stock bands use actual locations and measured quantities", () => {
  const sim = new LogisticsSimulation(2404, [
    "shortcut",
    "cargoTruck",
    "handling",
  ]);
  const map = appliedPolicyMap(sim);
  assert.equal(map.shared.length, 1);
  assert.equal(map.shared[0].policies[0].id, "cargoTruck");
  assert.equal(map.places.length, 2);
  assert.equal(
    map.places.find((p) => p.policies[0].id === "handling")!.outlines.length,
    4,
  );
  const west = new LogisticsSimulation(2404, ["diversify"]);
  assert.deepEqual(
    appliedPolicyMap(west).places[0].position,
    west.sources.find((s) => s.id === "west-region")!.position,
  );
  sim.runUntil(60);
  assert.equal(residentVoices(sim).length, 5);
  assert.ok(residentVoices(sim).every((v) => v.fact.length > 0));
  assert.deepEqual(
    [0, 1, 5, 15, 60].map((n) => stockBand(n).id),
    ["red", "orange", "yellow", "green", "green"],
  );
});

test("logistics records retain shop shortages and reject broken goods accounting", () => {
  const before = new LogisticsSimulation(),
    after = new LogisticsSimulation(2404, ["handling"]);
  before.runUntil(300);
  after.runUntil(300);
  const record = {
    schemaVersion: 4,
    scenarioId: "logistics",
    seed: 2404,
    duration: 300,
    timeUnit: "seconds",
    logisticsModelVersion: "goods-delivery-v1",
    before: before.stats,
    after: after.stats,
    logisticsBefore: before.logisticsStats,
    logisticsAfter: after.logisticsStats,
    policyIds: ["handling"],
    reflection: "도착해야 상점에 물건이 생겨요.",
    residents: residentVoices(after, before),
  };
  const view = readExperimentRecord(JSON.stringify(record));
  assert.equal(view.scenarioId, "logistics");
  assert.equal(view.rows.length, 7);
  assert.equal(view.regions.length, 4);
  assert.equal(view.modelVersion, "goods-delivery-v1");
  for (const change of [
    (r: typeof record) => {
      r.logisticsAfter.shops[0].stock += 1;
    },
    (r: typeof record) => {
      r.logisticsAfter.inTrucks += 1;
    },
    (r: typeof record) => {
      r.logisticsAfter.sources[0].generated += 1;
    },
    (r: typeof record) => {
      r.logisticsAfter.shops[0].id = r.logisticsAfter.shops[1].id;
    },
  ]) {
    const altered = structuredClone(record);
    change(altered);
    assert.throws(() => readExperimentRecord(JSON.stringify(altered)));
  }
});
