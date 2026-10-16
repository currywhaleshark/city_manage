import test from "node:test";
import assert from "node:assert/strict";
import {
  FacilitySimulation,
  FACILITY_SITES,
  WALK_LIMIT_SECONDS,
} from "../src/simulation/facilities";
import {
  createWalkingNetwork,
  corner,
  WalkingNetwork,
} from "../src/simulation/facilities/walking";
import { compareFacilities } from "../src/metrics/facilities";
import { compareScenario } from "../src/metrics/scenarios";
import { getScenario } from "../src/scenarios";
import { readExperimentRecord } from "../src/records";
import { residentVoices } from "../src/simulation/residents";

test("planning walks follow sidewalk edges and crossings, include waiting, and retain unreachable routes", () => {
  const graph = createWalkingNetwork();
  const crossing = graph.route(corner(0, 0, "nw"), corner(0, 0, "ne"))!;
  assert.ok(Math.abs(crossing.meters - 12.4) < 1e-8);
  assert.ok(Math.abs(crossing.seconds - (12.4 / 1.2 + 15)) < 1e-8);
  const sidewalk = graph.route(corner(0, 0, "se"), corner(1, 0, "sw"))!;
  assert.ok(Math.abs(sidewalk.meters - 35.6) < 1e-8);
  assert.ok(Math.abs(sidewalk.seconds - 35.6 / 1.2) < 1e-8);
  // There is no east-west road here; walking must use an existing street.
  const streetDetour = graph.route(corner(2, 1, "se"), corner(3, 1, "sw"))!;
  assert.ok(streetDetour.meters > 35.6);
  assert.equal(
    graph.edges
      .get(corner(2, 1, "se"))!
      .some((edge) => edge.to === corner(3, 1, "sw")),
    false,
  );
  const detached = new WalkingNetwork();
  detached.addPoint("a", { x: 0, z: 0 });
  detached.addPoint("b", { x: 2, z: 0 });
  assert.equal(detached.route("a", "b"), null);
  assert.equal(detached.route("missing", "b"), null);
  const sim = new FacilitySimulation();
  for (const row of sim.access)
    for (const service of Object.values(row.services)) {
      const route = service.nearest!.route;
      let length = 0;
      for (let i = 1; i < route.path.length; i++) {
        const a = route.path[i - 1],
          b = route.path[i];
        assert.ok(a.x === b.x || a.z === b.z);
        length += Math.hypot(a.x - b.x, a.z - b.z);
      }
      assert.ok(Math.abs(length - route.meters) < 1e-8);
      assert.ok(route.seconds >= route.meters / 1.2 - 1e-8);
    }
});

test("all facility plans conserve distinct daily residents and respect real distance and capacity limits", () => {
  for (const seed of [2404, 2405, 2406])
    for (const site of FACILITY_SITES)
      for (const policies of [
        [],
        ["library"],
        ["park"],
        ["expand"],
        ["gate"],
        ["expand", "gate"],
        ["library", "expand"],
        ["library", "gate"],
        ["park", "gate"],
        ["park", "expand"],
      ]) {
        if (policies.includes("park") && site.width * site.depth < 900) {
          assert.throws(
            () => new FacilitySimulation(seed, policies, { siteId: site.id }),
            /면적/,
          );
          continue;
        }
        const sim = new FacilitySimulation(seed, policies, { siteId: site.id }),
          stats = sim.facilityStats;
        assert.equal(stats.population, 1180);
        assert.equal(stats.served + stats.unserved, stats.population);
        assert.equal(
          stats.outsideRange + stats.capacityShortfall + stats.served,
          stats.population,
        );
        assert.equal(
          sim.allocations.reduce((n, a) => n + a.count, 0),
          stats.served,
        );
        for (const f of stats.facilities)
          assert.ok(f.used <= f.capacity && f.used >= 0);
        for (const a of sim.allocations)
          assert.ok(a.count > 0 && a.seconds <= WALK_LIMIT_SECONDS);
        for (const r of stats.neighborhoods) {
          assert.equal(
            r.services.library.demand + r.services.park.demand,
            r.population,
          );
          assert.equal(
            r.services.library.served + r.services.park.served,
            r.served,
          );
          assert.ok(r.served <= r.reachable && r.reachable <= r.population);
        }
        assert.equal(sim.time, 0);
        assert.equal(sim.demand.length, 0);
        assert.equal(sim.pedestrians.demand.length, 0);
        assert.ok(stats.remainingBudget >= 0);
      }
});

test("site choice redistributes benefits and access improvements differ from adding seats", () => {
  const base = new FacilitySimulation(),
    north = new FacilitySimulation(2404, ["library"], { siteId: "north" }),
    south = new FacilitySimulation(2404, ["library"], { siteId: "south" });
  assert.notDeepEqual(
    north.access.map((r) => r.served),
    south.access.map((r) => r.served),
  );
  assert.ok(
    compareFacilities(base, north).neighborhoods.some(
      (r) => r.afterServed === r.beforeServed,
    ),
  );
  const expanded = new FacilitySimulation(2404, ["expand"]),
    gate = new FacilitySimulation(2404, ["gate"]),
    both = new FacilitySimulation(2404, ["expand", "gate"]);
  assert.equal(
    expanded.facilityStats.averageNearestSeconds,
    base.facilityStats.averageNearestSeconds,
  );
  assert.ok(expanded.facilityStats.served > base.facilityStats.served);
  assert.equal(gate.facilityStats.capacity, base.facilityStats.capacity);
  assert.ok(
    gate.facilityStats.averageNearestSeconds <
      base.facilityStats.averageNearestSeconds,
  );
  assert.ok(
    gate.facilityStats.capacityShortfall > base.facilityStats.capacityShortfall,
  );
  assert.equal(both.facilityStats.served, expanded.facilityStats.served); // More residents are within reach, but every seat is already filled.
  assert.ok(both.facilityStats.reachable > expanded.facilityStats.reachable);
  assert.ok(
    residentVoices(north, base).some((v) => v.change!.includes("그대로")),
  );
  assert.ok(
    residentVoices(north).every((v) => v.fact.includes("예상") && v.opinion),
  );
});

test("facility registry, fair comparison and configuration are deterministic and reject invalid plans", () => {
  const a = new FacilitySimulation(2405, ["park"], { siteId: "south" });
  const b = getScenario("facilities").create(
    {
      seed: 2405,
      duration: 0,
      demand: [],
      pedestrians: [],
      facilityPlan: { siteId: "south" },
    },
    ["park"],
    26,
  ) as FacilitySimulation;
  assert.deepEqual(a.facilityStats, b.facilityStats);
  assert.deepEqual(a.allocations, b.allocations);
  assert.equal(getScenario("facilities").clock, "planning");
  assert.equal(
    compareScenario(new FacilitySimulation(2405), a).scenarioId,
    "facilities",
  );
  assert.throws(() => compareFacilities(new FacilitySimulation(2404), a));
  assert.throws(
    () => new FacilitySimulation(2404, ["library", "park"]),
    /한 부지/,
  );
  assert.throws(() => new FacilitySimulation(2404, ["gate", "gate"]), /두 번/);
  assert.throws(
    () => new FacilitySimulation(2404, [], { siteId: "imaginary" }),
    /부지/,
  );
  assert.throws(() => new FacilitySimulation(2404, ["signal"]));
});

test("facility record round-trips site, round, regional capacity and thoughts with no elapsed-traffic claim", () => {
  const before = new FacilitySimulation(),
    after = new FacilitySimulation(2404, ["library"], { siteId: "north" });
  const record = {
    schemaVersion: 4,
    scenarioId: "facilities",
    timeUnit: "planning-round",
    round: 1,
    seed: 2404,
    duration: 0,
    modelVersion: "pedestrians-v4",
    facilityModelVersion: "facility-access-v1",
    before: before.stats,
    after: after.stats,
    facilitiesBefore: before.facilityStats,
    facilitiesAfter: after.facilityStats,
    policyIds: ["library"],
    facilityPlan: after.plan,
    decisionReason: "북쪽의 의견을 들었어요.",
    reflection: "<script>keep as text</script>",
  };
  const view = readExperimentRecord(JSON.stringify(record));
  assert.equal(view.scenarioId, "facilities");
  assert.equal(view.regions.length, 12);
  assert.ok(view.timeLabel.includes("예상치"));
  assert.ok(view.policies[0].includes("햇살"));
  assert.equal(view.reflection, record.reflection);
  for (const change of [
    { round: 2 },
    { duration: 1 },
    { facilityPlan: { siteId: "invalid" } },
    { facilitiesAfter: { ...after.facilityStats, served: 99999 } },
  ])
    assert.throws(() =>
      readExperimentRecord(JSON.stringify({ ...record, ...change })),
    );
});
