import test from "node:test";
import assert from "node:assert/strict";
import { TrafficSimulation } from "../src/simulation";
import {
  CONFIG,
  createDemand,
  createNetwork,
  DEFAULT_POLICY,
  rebuildLanes,
  SCHOOL_NODE,
} from "../src/scenario";
import {
  createCrossing,
  curvePoint,
  findRoute,
  signalPhase,
} from "../src/simulation/network";
import { desiredGap, idmAccel } from "../src/simulation/idm";
import { policyCost, validatePolicy } from "../src/policies";
import {
  movementsConflict,
  sameMovement,
  CLEAR_DISTANCE,
} from "../src/simulation/junctions";

const driver = {
  maxAccel: 1.8,
  comfortBrake: 2.8,
  safetyGap: 1.5,
  headway: 1.1,
};
test("IDM accelerates freely, brakes behind a stopped leader, and widens the safety gap", () => {
  assert.ok(idmAccel(driver, 0, 1e6, 0, 9) > 0);
  assert.ok(Math.abs(idmAccel(driver, 9, 1e6, 0, 9)) < 0.001);
  assert.ok(idmAccel(driver, 9, 5, 9, 9) < 0);
  assert.ok(desiredGap(driver, 9, 0) > desiredGap(driver, 3, 0));
});
test("seeded OD demand is frozen, reproducible and finite", () => {
  const a = createDemand();
  assert.deepEqual(a, createDemand());
  assert.notDeepEqual(a, createDemand(12));
  assert.equal(a.length, 140);
  assert.ok(Object.isFrozen(a));
  assert.ok(a.every((t) => t.origin !== t.destination));
});
test("Dijkstra obeys one-way changes and uses the new bypass", () => {
  const base = createNetwork(),
    bypass = createNetwork({ ...DEFAULT_POLICY, bypass: true }),
    one = createNetwork({ ...DEFAULT_POLICY, oneWay: true });
  assert.ok(findRoute(bypass, "n0-1", "n4-1").includes("n2-1_n3-1"));
  assert.ok(!findRoute(base, "n0-1", "n4-1").includes("n2-1_n3-1"));
  assert.ok(!findRoute(one, "n2-2", "n1-2").includes("n1-2_n2-2"));
  assert.equal(
    [...one.lanes.values()].filter((l) => l.roadId === "n1-2_n2-2").length,
    2,
  );
  assert.equal(
    [...one.lanes.values()].filter(
      (l) => l.roadId === "n1-2_n2-2" && l.from === "n2-2",
    ).length,
    0,
  );
});
test("closed routes stay queued and never silently disappear", () => {
  const network = createNetwork();
  network.roads.clear();
  rebuildLanes(network);
  const demand = [{ ...createDemand()[0], departAt: 0 }];
  const sim = new TrafficSimulation(DEFAULT_POLICY, demand, network);
  sim.runUntil(5);
  assert.equal(sim.stats.unreachable, 1);
  assert.equal(sim.vehicles.size, 0);
  assert.equal(sim.pending.length, 1);
  assert.equal(sim.stats.averageTravelTime, null);
});
test("signal includes yellow and all-red clearance for both directions", () => {
  const s = { ns: 10, ew: 12, yellow: 2, clearance: 1, offset: 0 };
  assert.deepEqual(
    [0, 10, 12, 13, 25, 27, 28].map((t) => signalPhase(s, t)),
    [
      "ns-green",
      "ns-yellow",
      "all-red",
      "ew-green",
      "ew-yellow",
      "all-red",
      "ns-green",
    ],
  );
});
test("turn curve connects lane centers continuously with correct tangents", () => {
  const n = createNetwork(),
    a = [...n.lanes.values()].find(
      (l) => l.from === "n1-2" && l.to === "n2-2",
    )!,
    b = [...n.lanes.values()].find(
      (l) => l.from === "n2-2" && l.to === "n2-1",
    )!;
  const c = createCrossing(n, a.id, b.id),
    start = curvePoint(c.points, 0),
    end = curvePoint(c.points, 1);
  assert.equal(start.x, a.end.x);
  assert.equal(start.z, a.end.z);
  assert.equal(end.x, b.start.x);
  assert.equal(end.z, b.start.z);
  assert.ok(c.length > 10);
});
test("fixed-step state is independent of render frame partition", () => {
  const policy = {
    ...DEFAULT_POLICY,
    signal: true,
    bypass: true,
    oneWay: true,
  };
  const demand = createDemand(2405);
  const a = new TrafficSimulation(policy, demand),
    b = new TrafficSimulation(policy, demand);
  for (let i = 0; i < 5400; i++) a.advance(1 / 30);
  for (let i = 0; i < 10800; i++) b.advance(1 / 60);
  assert.equal(a.time, 180);
  assert.ok(a.laneChangeEvents.length > 0);
  assert.deepEqual(a.laneChangeEvents, b.laneChangeEvents);
  assert.deepEqual(a.stats, b.stats);
  assert.deepEqual([...a.vehicles.values()], [...b.vehicles.values()]);
});
test("traffic queues, red-light obedience, lane spacing, reservations and population conservation", () => {
  const sim = new TrafficSimulation();
  let maxStopped = 0;
  for (let tick = 0; tick < 4200; tick++) {
    sim.step();
    const cars = [...sim.vehicles.values()];
    const crossings: typeof cars = [];
    for (const v of cars) {
      assert.ok(
        Number.isFinite(v.s) && Number.isFinite(v.speed) && v.speed >= 0,
      );
      const lane = sim.network.lanes.get(v.laneId)!;
      assert.ok(lane);
      assert.equal(lane.roadId, v.route[v.routeIndex]);
      assert.ok(
        Math.hypot(v.pose.x - v.previousPose.x, v.pose.z - v.previousPose.z) <
          1.8,
        "no teleport",
      );
      if (v.crossing) {
        for (const other of crossings)
          assert.ok(
            sameMovement(v.crossing, other.crossing!)
              ? Math.abs(v.crossing.distance - other.crossing!.distance) >=
                  CLEAR_DISTANCE - 1e-8
              : !movementsConflict(sim.network, v.crossing, other.crossing!),
            "same-path followers keep spacing; other concurrent movements are disjoint",
          );
        crossings.push(v);
        assert.ok(sim.nodeLocks.get(v.crossing.nodeId)?.has(v.id));
      }
    }
    if (tick % 10 === 0) {
      for (const lane of sim.network.lanes.values()) {
        const onLane = cars
          .filter((v) => !v.crossing && v.laneId === lane.id)
          .sort((a, b) => a.s - b.s);
        for (let i = 1; i < onLane.length; i++)
          assert.ok(
            onLane[i].s - onLane[i - 1].s >= CONFIG.carLength + 0.14,
            "no longitudinal overlap",
          );
      }
      const s = sim.stats;
      maxStopped = Math.max(maxStopped, s.stopped);
      assert.equal(s.arrived + s.active + s.queued + s.unreleased, 140);
    }
  }
  assert.ok(maxStopped > 30);
  // Demand is 140 trips; faster junctions need not keep 80 on the road at once.
  assert.equal(sim.releasedCount, 140);
  assert.ok(sim.completed.length > 0);
  for (const e of sim.events.filter((e) => e.type === "enter"))
    assert.ok(e.phase.endsWith("green"));
  assert.ok(
    sim.events.some((e) => e.node === SCHOOL_NODE && e.type === "enter"),
  );
  assert.ok(sim.stats.averageTravelTime! > sim.stats.averageWaitingTime!);
});
test("all policies share exact demand and have measured effects; every trip eventually drains", () => {
  const demand = createDemand();
  const results = [];
  for (const policy of [
    DEFAULT_POLICY,
    { ...DEFAULT_POLICY, signal: true },
    { ...DEFAULT_POLICY, bypass: true },
    { ...DEFAULT_POLICY, oneWay: true },
    { ...DEFAULT_POLICY, signal: true, bypass: true, oneWay: true },
  ]) {
    const sim = new TrafficSimulation(policy, demand);
    sim.runUntil(CONFIG.duration);
    assert.equal(sim.demand, demand);
    results.push(sim.stats);
    while (sim.completed.length < demand.length && sim.time < 6500) sim.step();
    assert.equal(
      sim.completed.length,
      140,
      `all trips drain for ${JSON.stringify(policy)}`,
    );
    assert.equal(sim.pending.length, 0);
  }
  assert.ok(results[1].arrived > results[0].arrived);
  assert.notEqual(results[2].averageTravelTime, results[0].averageTravelTime);
  assert.notEqual(results[3].averageDemandWait, results[0].averageDemandWait);
  assert.ok(
    results[3].arrived < results[0].arrived,
    "a policy can make throughput worse",
  );
});
test("300-car stress remains finite and accounts for all demand", () => {
  const sim = new TrafficSimulation(
    { ...DEFAULT_POLICY, signal: true, bypass: true },
    createDemand(2404, 300),
  );
  sim.runUntil(420);
  const s = sim.stats;
  assert.equal(s.active + s.queued + s.arrived + s.unreleased, 300);
  assert.ok(s.arrived > 0);
  assert.ok(Number.isFinite(s.totalWaitingTime));
});
test("budget and adjustable signal values are validated", () => {
  assert.equal(
    policyCost({ ...DEFAULT_POLICY, signal: true, bypass: true, oneWay: true }),
    100,
  );
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, ewGreen: Infinity }));
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, ewGreen: 3 }));
});
