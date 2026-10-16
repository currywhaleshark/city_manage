import test from "node:test";
import assert from "node:assert/strict";
import {
  ParkingSimulation,
  DEFAULT_PARKING_PLAN,
  createParkingDemand,
  PARKING_SITES,
} from "../src/simulation/parking";
import { compareParking } from "../src/metrics/parking";
import { Inquiry } from "../src/inquiry";
import { validateParcelUses } from "../src/city/parcels";
import { CONFIG } from "../src/scenario";
import { appliedPolicyMap } from "../src/policies/map";
import { readExperimentRecord } from "../src/records";
import { recordMarkup } from "../src/ui/records";

test("parking policies use the same demand, local enforcement, finite parcels and short stays", () => {
  assert.equal(
    new ParkingSimulation(2404, ["loadingBay"], DEFAULT_PARKING_PLAN, [], [])
      .parkingStats.total,
    6,
  );
  assert.deepEqual(createParkingDemand(2404), createParkingDemand(2404));
  assert.notDeepEqual(createParkingDemand(2404), createParkingDemand(2405));
  const base = new ParkingSimulation(),
    patrol = new ParkingSimulation(2404, ["patrol"]);
  assert.deepEqual(base.demand, patrol.demand);
  assert.deepEqual(base.pedestrians.demand, patrol.pedestrians.demand);
  for (const e of patrol.episodes)
    assert.equal(
      e.releaseAt,
      e.request.siteId === "school"
        ? 40 + (e.request.id % 2) * 8
        : e.request.duration,
    );
  const lot = new ParkingSimulation(2404, ["parkingLot"]),
    west = new ParkingSimulation(2404, ["parkingLot"], {
      ...DEFAULT_PARKING_PLAN,
      siteId: "north",
    });
  assert.ok(
    lot.parkingStats.lotUsed <= lot.lotCapacity && lot.parkingStats.lotUsed > 0,
  );
  assert.ok(
    lot.episodes
      .filter((e) => e.destination === "lot")
      .every((e) => e.walkDistance <= e.request.maxWalk),
  );
  assert.equal(
    lot.episodes.filter(
      (e) => e.request.siteId === "homes" && e.destination === "lot",
    ).length,
    0,
  );
  assert.equal(
    west.episodes.filter(
      (e) => e.request.siteId === "homes" && e.destination === "lot",
    ).length,
    2,
  );
  for (const site of ["school", "market"]) {
    const bay = new ParkingSimulation(2404, ["loadingBay"], {
      ...DEFAULT_PARKING_PLAN,
      loadingSite: site,
    });
    const cars = bay.episodes.filter((e) => e.destination === "bay");
    assert.equal(cars.length, 1);
    assert.ok(
      cars.every((e) => e.request.duration <= 150 && e.request.siteId === site),
    );
    assert.equal(
      appliedPolicyMap(bay).places[0].name,
      PARKING_SITES.find((s) => s.id === site)!.name,
    );
  }
  assert.throws(
    () => new ParkingSimulation(2404, ["patrol", "parkingLot", "loadingBay"]),
  );
  assert.throws(
    () =>
      new ParkingSimulation(2404, ["parkingLot"], {
        ...DEFAULT_PARKING_PLAN,
        reservedPlots: [{ siteId: "riverside", kind: "park" }],
      }),
  );
  assert.throws(() => validateParcelUses([{ siteId: "west", kind: "park" }]));
});

test("parked cars physically queue traffic and pedestrians go around them with no overlaps", () => {
  const sim = new ParkingSimulation();
  let queuedBehind = false;
  let detourObserved = false;
  while (sim.time < 420) {
    sim.step();
    const walkers = [...sim.pedestrians.active.values()];
    for (const ep of sim.episodes.filter(
      (e) => e.destination === "illegal" && e.phase === "parked",
    )) {
      if (ep.request.surface === "road") {
        const v = sim.vehicles.get(ep.request.id)!;
        assert.equal(v.speed, 0);
        queuedBehind ||= [...sim.vehicles.values()].some(
          (c) =>
            c.id !== v.id &&
            c.laneId === v.laneId &&
            c.s < v.s &&
            c.speed < 0.5,
        );
      }
      for (const p of walkers) {
        const dx = p.pose.x - ep.pose.x,
          dz = p.pose.z - ep.pose.z;
        const side = Math.abs(
          dx * Math.cos(ep.pose.angle) - dz * Math.sin(ep.pose.angle),
        );
        const forward = Math.abs(
          dx * Math.sin(ep.pose.angle) + dz * Math.cos(ep.pose.angle),
        );
        const gap = Math.hypot(
          Math.max(0, side - CONFIG.carWidth / 2),
          Math.max(0, forward - CONFIG.carLength / 2),
        );
        assert.ok(
          gap >= 0.27,
          `walker ${p.trip.id} overlaps parked car ${ep.request.id} at ${sim.time}`,
        );
        if (p.path) detourObserved = true;
      }
    }
    for (let i = 0; i < walkers.length; i++)
      for (const q of walkers.slice(i + 1))
        assert.ok(
          Math.hypot(
            walkers[i].pose.x - q.pose.x,
            walkers[i].pose.z - q.pose.z,
          ) >=
            0.55 - 1e-8,
          `walkers overlap at ${sim.time}`,
        );
    const s = sim.parkingStats;
    assert.equal(s.parked + s.leaving + s.finished, 6);
    const p = sim.pedestrians.stats;
    assert.equal(p.arrived + p.active + p.queued + p.unreleased, 60);
  }
  assert.ok(queuedBehind && detourObserved);
  assert.ok(sim.parkingStats.extraWalkingDistance > 0);
  assert.equal(
    sim.parkingStats.illegalSeconds,
    sim.episodes.reduce((n, e) => n + e.illegalSeconds, 0),
  );
  sim.runUntil(2400);
  assert.equal(sim.parkingStats.finished, 6);
  assert.equal(sim.completed.length, 140);
  assert.equal(sim.pedestrians.completed.length, 60);
});

test("parking comparisons and inquiry snapshots survive records without changing earlier evidence", () => {
  const base = new ParkingSimulation(),
    after = new ParkingSimulation(2404, ["patrol", "parkingLot"]);
  const inquiry = new Inquiry();
  inquiry.collect({
    phase: "before",
    kind: "fact",
    time: 0,
    place: "학교 앞",
    text: "불법주차 2대",
  });
  inquiry.toggle(1);
  inquiry.alternative = "주차장은 공터가 필요해요.";
  inquiry.decide("학생의 길을 먼저 열어요.", ["patrol", "parkingLot"]);
  const frozen = inquiry.snapshot();
  inquiry.toggle(1);
  inquiry.proposal = "다음에는 주거지도 살펴봐요.";
  assert.equal(frozen.evidence[0].used, true);
  assert.deepEqual(inquiry.decisions[0].evidenceIds, [1]);
  base.runUntil(180);
  after.runUntil(180);
  const c = compareParking(base, after);
  assert.ok(c.after.illegalSeconds < c.before.illegalSeconds);
  assert.throws(() => compareParking(base, new ParkingSimulation(2405)));
  const record = {
    schemaVersion: 5,
    scenarioId: "parking",
    before: base.stats,
    after: after.stats,
    duration: 180,
    seed: 2404,
    timeUnit: "seconds",
    parkingBefore: base.parkingStats,
    parkingAfter: after.parkingStats,
    parkingDemand: after.parkingDemand,
    parkingPlan: after.plan,
    policyIds: after.policyIds,
    budget: 100 - after.cost,
    parkingModelVersion: "parking-v1",
    inquiry: inquiry.snapshot(),
    decisionReason: inquiry.decisions[0].reason,
  };
  const view = readExperimentRecord(JSON.stringify(record));
  assert.equal(view.inquiry!.evidence[0].text, "불법주차 2대");
  assert.match(recordMarkup(view), /다음에는 주거지도/);
  const bad = JSON.parse(JSON.stringify(record));
  bad.inquiry.evidence[0].text = '<img src=x onerror="alert(1)">';
  assert.ok(
    !recordMarkup(readExperimentRecord(JSON.stringify(bad))).includes("<img"),
  );
  bad.parkingAfter.finished = 30;
  assert.throws(() => readExperimentRecord(JSON.stringify(bad)));
  const bad2 = JSON.parse(JSON.stringify(record));
  bad2.inquiry.decisions[0].evidenceIds = [999];
  assert.throws(() => readExperimentRecord(JSON.stringify(bad2)));
});

test("all affordable parking combinations conserve demand across three mornings", () => {
  const sets = [
    [],
    ["patrol"],
    ["parkingLot"],
    ["loadingBay"],
    ["patrol", "parkingLot"],
    ["patrol", "loadingBay"],
    ["parkingLot", "loadingBay"],
  ];
  for (const seed of [2404, 2405, 2406]) {
    const before = new ParkingSimulation(seed);
    before.runUntil(180);
    for (const ids of sets) {
      const sim = new ParkingSimulation(seed, ids);
      sim.runUntil(180);
      compareParking(before, sim);
      assert.equal(
        sim.stats.arrived +
          sim.stats.active +
          sim.stats.queued +
          sim.stats.unreleased,
        140,
      );
      assert.equal(
        sim.parkingStats.parked +
          sim.parkingStats.leaving +
          sim.parkingStats.finished,
        6,
      );
      assert.ok(
        sim.parkingStats.illegalSeconds <=
          before.parkingStats.illegalSeconds + 1e-6,
      );
      const people = [...sim.pedestrians.active.values()];
      for (let i = 0; i < people.length; i++)
        for (const p of people.slice(i + 1))
          assert.ok(
            Math.hypot(
              people[i].pose.x - p.pose.x,
              people[i].pose.z - p.pose.z,
            ) >=
              0.55 - 1e-8,
          );
    }
  }
});
