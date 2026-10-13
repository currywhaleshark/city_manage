import test from "node:test";
import assert from "node:assert/strict";
import { TrafficSimulation } from "../src/simulation";
import {
  CONFIG,
  createDemand,
  createNetwork,
  DEFAULT_POLICY,
} from "../src/scenario";
import {
  createPedestrianDemand,
  PedestrianSystem,
  WALKING_GAP,
} from "../src/simulation/pedestrians";
import { signalPhase } from "../src/simulation/network";
import { compareExperiments } from "../src/metrics/comparison";

test("walking demand is frozen, repeatable and uses an independent seed stream", () => {
  const trips = createPedestrianDemand();
  assert.deepEqual(trips, createPedestrianDemand());
  assert.notDeepEqual(trips, createPedestrianDemand(2405));
  assert.ok(Object.isFrozen(trips) && trips.every(Object.isFrozen));
  assert.equal(trips.length, 60);
});

test("protected walk phase follows vehicle clearance and forbids late entry", () => {
  const signal = {
    ns: 25,
    ew: 7,
    yellow: 2,
    clearance: 1,
    offset: 0,
    walk: 8,
    walkClearance: 16,
  };
  assert.equal(signalPhase(signal, 37.9), "all-red");
  assert.equal(signalPhase(signal, 38), "pedestrian-green");
  assert.equal(signalPhase(signal, 46), "pedestrian-clearance");
  assert.equal(signalPhase(signal, 61.9), "pedestrian-clearance");
  assert.equal(signalPhase(signal, 62), "ns-green");
  const people = new PedestrianSystem(createNetwork(), [
    { ...createPedestrianDemand()[0], departAt: 0, routeId: "school-front" },
  ]);
  const locks = new Map([["n3-2", new Set([7])]]);
  for (let tick = 1; tick <= 460; tick++) people.step(tick / 10, 0.1, locks);
  assert.equal(people.events.length, 0);
  assert.equal(people.stats.waiting, 1);
  for (let tick = 461; tick <= 1000; tick++)
    people.step(tick / 10, 0.1, new Map());
  assert.equal(people.events[0].time, 100);
  assert.equal(people.events[0].phase, "pedestrian-green");
});

test("mixed traffic conserves all people, clears queues and never overlaps pedestrians and cars", () => {
  for (const seed of [2404, 2405, 2406])
    for (const policy of [
      DEFAULT_POLICY,
      { ...DEFAULT_POLICY, signal: true, bypass: true, oneWay: true },
      { ...DEFAULT_POLICY, signal: true, ewGreen: 38 },
    ]) {
      const sim = new TrafficSimulation(
        policy,
        createDemand(seed),
        undefined,
        createPedestrianDemand(seed),
      );
      while (sim.time < 600) {
        sim.step();
        const walkers = [...sim.pedestrians.active.values()];
        for (const p of walkers) {
          const route = sim.pedestrians.routes.get(p.trip.routeId)!;
          if (p.crossing)
            assert.equal(
              sim.nodeLocks.get(route.nodeId)?.size ?? 0,
              0,
              `vehicle reserved occupied crossing at ${sim.time}`,
            );
          for (const v of sim.vehicles.values()) {
            const dx = p.pose.x - v.pose.x,
              dz = p.pose.z - v.pose.z;
            const lateral = Math.abs(
              dx * Math.cos(v.pose.angle) - dz * Math.sin(v.pose.angle),
            );
            const forward = Math.abs(
              dx * Math.sin(v.pose.angle) + dz * Math.cos(v.pose.angle),
            );
            const separation = Math.hypot(
              Math.max(0, lateral - CONFIG.carWidth / 2),
              Math.max(0, forward - CONFIG.carLength / 2),
            );
            assert.ok(
              separation >= 0.27,
              `${seed} t=${sim.time} walker=${p.trip.id} car=${v.id} gap=${separation}`,
            );
          }
          for (const q of walkers)
            if (p.trip.id < q.trip.id) {
              assert.ok(
                Math.hypot(p.pose.x - q.pose.x, p.pose.z - q.pose.z) >=
                  0.55 - 1e-8,
              );
              if (p.trip.routeId === q.trip.routeId)
                assert.ok(
                  Math.abs(p.distance - q.distance) >= WALKING_GAP - 1e-8,
                );
            }
        }
        const s = sim.pedestrians.stats;
        assert.equal(s.arrived + s.active + s.queued + s.unreleased, 60);
      }
      assert.equal(sim.pedestrians.completed.length, 60);
      assert.equal(
        sim.pedestrians.events.filter((e) => e.type === "enter").length,
        60,
      );
      assert.ok(
        sim.pedestrians.events
          .filter((e) => e.type === "enter")
          .every((e) => e.phase === "pedestrian-green"),
      );
      sim.runUntil(6500);
      assert.equal(sim.completed.length, 140);
    }
});

test("a slow walker keeps vehicles stopped after nominal crossing clearance expires", () => {
  const sim = new TrafficSimulation(DEFAULT_POLICY, createDemand(), undefined, [
    {
      ...createPedestrianDemand()[0],
      departAt: 0,
      routeId: "school-front",
      speed: 0.3,
    },
  ]);
  let overrun = false;
  while (sim.time < 300) {
    sim.step();
    if (sim.pedestrians.blockedNodes.has("n3-2")) {
      assert.equal(sim.nodeLocks.get("n3-2")?.size ?? 0, 0);
      if (
        signalPhase(sim.network.nodes.get("n3-2")!.signal, sim.time) ===
        "ns-green"
      )
        overrun = true;
    }
  }
  assert.ok(overrun);
  assert.equal(sim.pedestrians.completed.length, 1);
});

test("render cadence cannot change pedestrian results and comparison rejects changed walking conditions", () => {
  const demand = createDemand(),
    walkers = createPedestrianDemand();
  const a = new TrafficSimulation(DEFAULT_POLICY, demand, undefined, walkers);
  const b = new TrafficSimulation(DEFAULT_POLICY, demand, undefined, walkers);
  for (let i = 0; i < 420 * 30; i++) a.advance(1 / 30);
  for (let i = 0; i < 420 * 60; i++) b.advance(1 / 60);
  assert.deepEqual(a.pedestrians.stats, b.pedestrians.stats);
  assert.deepEqual(a.pedestrians.events, b.pedestrians.events);
  assert.deepEqual(a.stats, b.stats);
  assert.ok(compareExperiments(a, b).pedestrians);
  const changed = new TrafficSimulation(
    DEFAULT_POLICY,
    demand,
    undefined,
    walkers.map((p, i) => (i === 0 ? { ...p, speed: p.speed + 0.1 } : p)),
  );
  changed.runUntil(420);
  assert.throws(() => compareExperiments(a, changed), /보행자/);
});
