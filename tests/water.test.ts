import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WaterSimulation,
  DEFAULT_WATER_PLAN,
  WATER_SOURCES,
  WATER_POLICIES,
  WATER_SPEED,
  WATER_MODEL_VERSION,
  waterTargets,
} from "../src/simulation/water";
import { compareWater } from "../src/metrics/water";
import { compareScenario } from "../src/metrics/scenarios";
import { TrafficSimulation } from "../src/simulation";
import { readExperimentRecord } from "../src/records";
import { recordMarkup } from "../src/ui/records";
import { appliedPolicyMap } from "../src/policies/map";
import { residentVoices } from "../src/simulation/residents";
import { validateParcelUses } from "../src/city/parcels";
import { waterFact } from "../src/ui/water";
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function conserved(sim: WaterSimulation) {
  const s = sim.waterStats;
  near(s.initial + s.generated, s.remaining + s.treated + s.outflow);
  near(s.generated, s.entered + s.treated);
  near(
    s.litterInitial,
    s.litterRemaining + s.litterCollected + s.litterOutflow,
  );
  near(s.litterRemaining, s.floating + s.onBank);
  assert.ok(s.cells.every((c) => c.dissolved >= 0 && c.litter >= 0));
  assert.ok(s.captured >= 0 && s.captured <= 8);
}
test("water moves downstream with travel delay, conserves both materials and shares traffic conditions", () => {
  const before = new WaterSimulation(),
    after = new WaterSimulation(2404, ["outlet"]);
  assert.deepEqual(before.demand, after.demand);
  assert.deepEqual(before.pedestrians.demand, after.pedestrians.demand);
  assert.deepEqual(before.schedule, after.schedule);
  const initial = after.packets.find((p) => p.kind === "dissolved")!;
  const start = initial.z;
  for (const t of [1, 59, 60, 120, 300, 600, 900]) {
    before.runUntil(t);
    after.runUntil(t);
    conserved(before);
    conserved(after);
    if (t === 1) near(initial.z - start, WATER_SPEED);
    if (t <= 59)
      assert.deepEqual(before.waterStats.cells, after.waterStats.cells);
    if (t === 120)
      near(before.waterStats.sites[1].level, after.waterStats.sites[1].level);
    if (t === 300)
      near(before.waterStats.sites[2].level, after.waterStats.sites[2].level);
    if (t >= 600)
      assert.ok(
        after.waterStats.sites[2].level < before.waterStats.sites[2].level,
      );
    near(before.waterStats.sites[0].level, after.waterStats.sites[0].level);
    near(before.waterStats.litterRemaining, after.waterStats.litterRemaining);
  }
  assert.deepEqual(before.stats, after.stats);
  assert.ok(before.waterStats.outflow > 0);
  assert.equal(after.rounds.length, 3);
  assert.equal(compareWater(before, after).rows.length, 8);
  assert.throws(() => compareScenario(before, new TrafficSimulation()));
  assert.throws(() => compareWater(before, new WaterSimulation(2405)));
});
test("cleanup collects only litter and finite booms overflow; sewage processing starts in round two at the chosen inlet", () => {
  const before = new WaterSimulation(2404, [], DEFAULT_WATER_PLAN, 0),
    clean = new WaterSimulation(2404, ["riverCleanup"], DEFAULT_WATER_PLAN, 0);
  before.runUntil(900);
  clean.runUntil(900);
  assert.deepEqual(
    before.waterStats.cells.map((c) => c.dissolved),
    clean.waterStats.cells.map((c) => c.dissolved),
  );
  assert.equal(clean.captured, 8);
  assert.ok(clean.waterStats.litterCollected > 8);
  assert.ok(clean.waterStats.litterOutflow > 0);
  assert.equal(clean.banks[0].cleaned, 0);
  assert.ok(clean.banks[1].cleaned > 0);
  conserved(clean);
  const sewer = new WaterSimulation(
    2404,
    ["sewer"],
    { ...DEFAULT_WATER_PLAN, sewer: "south" },
    0,
  );
  sewer.runUntil(300);
  assert.equal(sewer.waterStats.treated, 0);
  sewer.runUntil(301);
  assert.ok(sewer.waterStats.treated > 0);
  sewer.runUntil(900);
  assert.ok(sewer.sources.find((s) => s.id === "shops")!.treated > 0);
  assert.ok(
    sewer.sources.filter((s) => s.id !== "shops").every((s) => s.treated === 0),
  );
  near(sewer.waterStats.sites[1].level, before.waterStats.sites[1].level);
  conserved(sewer);
});
test("three seeds and every affordable combination preserve input and mass; positions and parcels are validated", () => {
  let combinations = 0;
  for (const seed of [2404, 2405, 2406]) {
    const ref = new WaterSimulation(seed, [], DEFAULT_WATER_PLAN, 0);
    for (let mask = 0; mask < 8; mask++) {
      const policies = WATER_POLICIES.filter((_, i) => mask & (1 << i));
      if (policies.reduce((n, p) => n + p.cost, 0) > 100) continue;
      const plan = {
        outlet: "factorySouth",
        sewer: "south",
        riverCleanup: "walk",
      } as const;
      const sim = new WaterSimulation(
        seed,
        policies.map((p) => p.id),
        plan,
        0,
      );
      assert.deepEqual(sim.schedule, ref.schedule);
      for (const time of [300, 600, 900]) {
        sim.runUntil(time);
        conserved(sim);
      }
      assert.ok(
        sim.sources.find((s) => s.id === "factoryNorth")!.treated === 0,
      );
      combinations++;
    }
  }
  assert.equal(combinations, 21);
  assert.throws(
    () =>
      new WaterSimulation(
        2404,
        WATER_POLICIES.map((p) => p.id),
      ),
  );
  assert.throws(() => new WaterSimulation(2404, ["outlet", "outlet"]));
  assert.throws(() => new WaterSimulation(2404, ["unknown"]));
  assert.throws(
    () =>
      new WaterSimulation(2404, [], {
        ...DEFAULT_WATER_PLAN,
        sewer: "north",
      } as any),
  );
  assert.throws(() =>
    validateParcelUses([
      { siteId: "riverside", kind: "water" },
      { siteId: "riverside", kind: "library" },
    ]),
  );
  const a = new WaterSimulation(2404, ["sewer"], DEFAULT_WATER_PLAN, 0),
    b = new WaterSimulation(2404, ["sewer"], DEFAULT_WATER_PLAN, 0);
  a.runUntil(320);
  for (let i = 0; i < 320 * 60; i++) b.advance(1 / 60);
  assert.deepEqual(a.waterStats, b.waterStats);
});
test("water records preserve evidence, source ledgers, site choices and rounds and reject inconsistent imports", () => {
  const a = new WaterSimulation(2404, [], DEFAULT_WATER_PLAN, 0),
    b = new WaterSimulation(2404, ["outlet", "sewer"], DEFAULT_WATER_PLAN, 0);
  a.runUntil(900);
  b.runUntil(900);
  const data = {
    schemaVersion: 7,
    scenarioId: "water",
    waterModelVersion: WATER_MODEL_VERSION,
    modelVersion: "city-traffic-v5",
    seed: 2404,
    duration: 900,
    timeUnit: "seconds",
    before: a.stats,
    after: b.stats,
    waterPlan: b.plan,
    waterSchedule: b.schedule,
    waterBefore: a.waterStats,
    waterAfter: b.waterStats,
    waterRoundsBefore: a.rounds,
    waterRoundsAfter: b.rounds,
    policyIds: b.policyIds,
    budget: 0,
    residents: residentVoices(b, a),
    inquiry: {
      hypothesis: "상류에서 흘러와요",
      proposal: "<img src=x onerror=alert(1)>",
      evidence: [],
      decisions: [],
    },
  };
  const read = () => readExperimentRecord(JSON.stringify(data));
  const view = read();
  assert.ok(waterFact(b, "upstream").includes("지도 밖 상류 유입"));
  assert.ok(!waterFact(b, "upstream").includes("작업장 배출구"));
  assert.ok(waterFact(a, "middle").includes("북쪽 작업장 배출구"));
  assert.equal(view.regions.length, 11);
  assert.ok(view.policies[1].includes("하천 옆 공터"));
  assert.ok(recordMarkup(view).includes("&lt;img"));
  assert.equal(residentVoices(b, a).length, 3);
  const map = appliedPolicyMap(b);
  assert.equal(map.places.length, 2);
  assert.equal(map.shared.length, 0);
  assert.deepEqual(
    map.places[1].position,
    waterTargets("sewer").find((p) => p.id === "riverside")!.position,
  );
  for (const change of [
    (d: any) => d.waterAfter.remaining++,
    (d: any) => d.waterAfter.sources[1].treated++,
    (d: any) => d.waterAfter.sites[2].level++,
    (d: any) => d.waterSchedule[0].rates[0]++,
    (d: any) => d.waterRoundsAfter[2].levels[2]++,
    (d: any) => (d.waterPlan.sewer = "north"),
    (d: any) => (d.waterAfter.captured = 9),
  ]) {
    const bad = structuredClone(data);
    change(bad);
    assert.throws(() => readExperimentRecord(JSON.stringify(bad)));
  }
});
