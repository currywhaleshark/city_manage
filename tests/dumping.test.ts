import test from "node:test";
import assert from "node:assert/strict";
import {
  DumpingSimulation,
  DUMPING_SITES,
  DUMPING_MODEL_VERSION,
  DEFAULT_DUMPING_PLAN,
  DUMPING_POLICIES,
} from "../src/simulation/services/dumping";
import { createNetwork } from "../src/scenario";
import { compareDumping } from "../src/metrics/dumping";
import { readExperimentRecord } from "../src/records";
import { residentVoices } from "../src/simulation/residents";
import { appliedPolicyMap } from "../src/policies/map";
import { recordMarkup } from "../src/ui/records";
import { overlaps } from "./geometry-helper";

const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-5, `${a} !== ${b}`);
function conserved(sim: DumpingSimulation) {
  const s = sim.dumpingStats;
  close(s.initial + s.generated, s.remaining + s.collected);
  close(s.collected, s.disposed + s.inTrucks);
  close(s.remaining, s.illegalRemaining + s.designatedStored + s.overflow);
  for (const t of sim.trucks)
    assert.ok(t.load >= -1e-8 && t.load <= t.capacity + 1e-8);
  for (const site of sim.sites) {
    close(site.initial + site.generated, site.remaining + site.collected);
    assert.ok(site.remaining >= -1e-8);
  }
}
let before: DumpingSimulation, after: DumpingSimulation;
test("dumping is removed only by a stopped truck; recurrence and normal-route delays remain visible", () => {
  before = new DumpingSimulation();
  after = new DumpingSimulation(2404, ["cleanup", "dropoff"]);
  const arrivals = new Set<string>();
  let events = 0;
  for (let i = 0; i < 9000; i++) {
    after.step();
    for (const event of after.serviceEvents.slice(events)) {
      if (event.type === "arrival")
        arrivals.add(`${event.truck}:${event.site}`);
      if (event.type === "collect") {
        assert.ok(arrivals.has(`${event.truck}:${event.site}`));
        const vehicle = after.vehicles.get(event.truck)!;
        assert.equal(vehicle.speed, 0);
        assert.equal(
          vehicle.laneId,
          after.sites.find((s) => s.id === event.site)!.laneId,
        );
      }
    }
    events = after.serviceEvents.length;
    if (i % 50 === 0) {
      conserved(after);
      for (const truck of after.trucks) {
        const car = after.vehicles.get(truck.id);
        if (car)
          for (const other of after.vehicles.values())
            if (car.id !== other.id)
              assert.ok(
                !overlaps(car.pose, other.pose),
                `collision ${car.id}/${other.id}`,
              );
      }
    }
  }
  before.runUntil(900);
  conserved(before);
  conserved(after);
  assert.equal(after.disposalEvents.length, 36);
  assert.ok(after.illegal("river").collected > 0);
  assert.ok(after.dumpingStats.repeatDumped > 0);
  assert.ok(after.bin("river").remaining > 16);
  assert.ok(
    after.dumpingStats.normalSites.some(
      (s) =>
        s.remaining >
        before.dumpingStats.normalSites.find((t) => t.id === s.id)!.remaining,
    ),
  );
  assert.deepEqual(after.disposalDemand, before.disposalDemand);
  assert.deepEqual(after.demand, before.demand);
  assert.deepEqual(after.pedestrians.demand, before.pedestrians.demand);
  assert.deepEqual(
    after.rounds.map((r) => r.time),
    [300, 600, 900],
  );
  close(before.dumpingStats.generated, after.dumpingStats.generated);
  assert.equal(
    after.completed.length +
      [...after.vehicles.values()].filter(
        (v) => !after.serviceJourneys.has(v.id),
      ).length +
      after.pending.length +
      after.demand.length -
      after.releasedCount,
    140,
  );
  assert.equal(compareDumping(before, after).rows.length, 8);
});

test("dumping guidance is delayed, local, and changes destination rather than destroying waste", () => {
  const baseline = new DumpingSimulation(
      2404,
      [],
      DEFAULT_DUMPING_PLAN,
      undefined,
      0,
    ),
    guided = new DumpingSimulation(
      2404,
      ["outreach"],
      DEFAULT_DUMPING_PLAN,
      undefined,
      0,
    );
  baseline.runUntil(300);
  guided.runUntil(300);
  assert.deepEqual(guided.disposalEvents, baseline.disposalEvents);
  baseline.runUntil(900);
  guided.runUntil(900);
  assert.ok(
    guided.illegal("alley").generated < baseline.illegal("alley").generated,
  );
  for (const id of ["vacant", "river"])
    assert.equal(guided.illegal(id).generated, baseline.illegal(id).generated);
  close(guided.dumpingStats.generated, baseline.dumpingStats.generated);
  assert.throws(
    () => compareDumping(baseline, new DumpingSimulation(2405)),
    /같은/,
  );
});

test("dumping policies conserve all material across three seeds and seven budget-valid combinations", () => {
  const combinations = [
    [],
    ["cleanup"],
    ["dropoff"],
    ["outreach"],
    ["cleanup", "dropoff"],
    ["cleanup", "outreach"],
    ["dropoff", "outreach"],
  ];
  for (const seed of [2404, 2405, 2406]) {
    let generated: number | undefined;
    for (const ids of combinations) {
      const sim = new DumpingSimulation(
        seed,
        ids,
        DEFAULT_DUMPING_PLAN,
        undefined,
        0,
      );
      sim.runUntil(900);
      conserved(sim);
      if (generated === undefined) generated = sim.dumpingStats.generated;
      else close(generated, sim.dumpingStats.generated);
      assert.equal(sim.disposalEvents.length, 36);
    }
  }
  assert.throws(
    () => new DumpingSimulation(2404, ["cleanup", "dropoff", "outreach"]),
    /예산/,
  );
  assert.throws(
    () => new DumpingSimulation(2404, ["cleanup", "cleanup"]),
    /두 번/,
  );
  assert.throws(
    () =>
      new DumpingSimulation(2404, [], {
        ...DEFAULT_DUMPING_PLAN,
        dropoff: "invalid" as any,
      }),
    /현장/,
  );
  const network = createNetwork();
  for (const node of network.nodes.values())
    node.signal = { ns: 0, ew: 0, yellow: 10000, clearance: 1, offset: 0 };
  const blocked = new DumpingSimulation(
    2404,
    ["cleanup"],
    DEFAULT_DUMPING_PLAN,
    network,
  );
  blocked.runUntil(300);
  assert.equal(blocked.dumpingStats.collected, 0);
  conserved(blocked);
});

test("dumping records retain evidence, location and rounds; corrupted mass or demand is rejected", () => {
  const raw = {
    schemaVersion: 6,
    scenarioId: "dumping",
    dumpingModelVersion: DUMPING_MODEL_VERSION,
    seed: 2404,
    duration: 900,
    timeUnit: "seconds",
    before: before.stats,
    after: after.stats,
    dumpingBefore: before.dumpingStats,
    dumpingAfter: after.dumpingStats,
    wasteBefore: before.wasteStats,
    wasteAfter: after.wasteStats,
    dumpingPlan: after.plan,
    disposalDemand: after.disposalDemand,
    disposalEvents: after.disposalEvents,
    dumpingRoundsBefore: before.rounds,
    dumpingRoundsAfter: after.rounds,
    policyIds: after.policyIds,
    budget: 100 - after.cost,
    reflection: "다음에는 안내도 함께해요.",
    inquiry: {
      hypothesis: "가까운 배출 장소가 부족해요.",
      proposal: "주민과 함께 살펴봐요.",
      evidence: [
        {
          id: 1,
          kind: "fact",
          phase: "before",
          trial: 0,
          time: 0,
          place: "새봄천 산책길",
          text: "<script>자료</script>",
          used: true,
        },
      ],
      decisions: [
        {
          reason: "가까운 곳에 배출해요.",
          alternative: "청소만 하면 다시 쌓여요.",
          evidenceIds: [1],
          policies: [...after.policyIds],
        },
      ],
    },
  };
  const parsed = readExperimentRecord(JSON.stringify(raw));
  assert.equal(parsed.inquiry!.evidence[0].text, "<script>자료</script>");
  assert.match(parsed.policies.join(" "), /새봄천 산책길/);
  assert.match(recordMarkup(parsed), /&lt;script&gt;/);
  assert.equal(parsed.regions.length, 12);
  for (const mutate of [
    (d: any) => d.dumpingAfter.remaining++,
    (d: any) => (d.dumpingPlan.dropoff = "missing"),
    (d: any) => d.disposalDemand[0].amount++,
    (d: any) => d.dumpingRoundsAfter[2].overflow++,
    (d: any) => (d.disposalEvents[0].repeat = true),
  ]) {
    const data = JSON.parse(JSON.stringify(raw));
    mutate(data);
    assert.throws(() => readExperimentRecord(JSON.stringify(data)));
  }
  assert.equal(residentVoices(after, before).length, 3);
  assert.equal(appliedPolicyMap(after).places.length, 1);
  assert.equal(appliedPolicyMap(after).places[0].policies.length, 2);
  assert.deepEqual(after.policyIds, ["cleanup", "dropoff"]);
  assert.equal(DUMPING_POLICIES.length, 3);
  assert.equal(DUMPING_SITES.length, 3);
});
