import test from "node:test";
import assert from "node:assert/strict";
import { createDemand, createNetwork, DEFAULT_POLICY } from "../src/scenario";
import {
  WORLD,
  RIVER,
  RIVERBANK_SEGMENTS,
  EXTERNAL_CONNECTIONS,
  boundaryNode,
  visibleRoadSegment,
} from "../src/city/world";
import { TrafficSimulation } from "../src/simulation";
import { findRoute, createArrival } from "../src/simulation/network";

test("all four border connections meet the ground edge and have no visible return loop or signal", () => {
  const net = createNetwork();
  for (const side of EXTERNAL_CONNECTIONS)
    for (const row of [0, 1] as const) {
      const gate = net.nodes.get(boundaryNode(side.id, row))!;
      assert.equal(gate.position.x, side.edgeX);
      assert.equal(gate.boundary, true);
      assert.equal(gate.signal.yellow + gate.signal.clearance, 0);
      const lanes = net.outgoing.get(gate.id)!;
      assert.equal(lanes.length, 2);
      assert.equal(
        lanes.filter((l) =>
          visibleRoadSegment(gate.position, net.nodes.get(l.to)!.position),
        ).length,
        1,
      );
      const arrivalLane = [...net.lanes.values()].find(
        (l) => l.to === gate.id && !l.from.startsWith("outside"),
      )!;
      assert.equal(createArrival(net, arrivalLane.id).points[3].x, side.edgeX);
    }
  for (const row of RIVER.bridges) {
    const z = (row - 2) * 48;
    assert.ok(
      RIVERBANK_SEGMENTS.every((s) => s.maxZ <= z - 6 || s.minZ >= z + 6),
    );
  }
});

test("expanded commuting and boundary demand is deterministic and routes through real bridges", () => {
  const net = createNetwork();
  for (const seed of [2404, 2405, 2406]) {
    const demand = createDemand(seed);
    assert.deepEqual(demand, createDemand(seed));
    assert.equal(demand.filter((t) => t.purpose === "school").length, 70);
    for (const side of EXTERNAL_CONNECTIONS) {
      assert.ok(demand.some((t) => t.origin === boundaryNode(side.id, 0)));
      assert.ok(demand.some((t) => t.destination === boundaryNode(side.id, 1)));
    }
    for (const t of demand) {
      const route = findRoute(net, t.origin, t.destination);
      assert.ok(route.length);
      if (t.id % 20 >= 4 && t.id % 20 < 10) {
        const a = net.nodes.get(t.origin)!.position,
          b = net.nodes.get(t.destination)!.position;
        assert.ok((a.x - RIVER.x) * (b.x - RIVER.x) < 0);
        assert.ok(
          route.some((id) => {
            const r = net.roads.get(id)!;
            return (
              (net.nodes.get(r.startNodeId)!.position.x - RIVER.x) *
                (net.nodes.get(r.endNodeId)!.position.x - RIVER.x) <
              0
            );
          }),
        );
      }
    }
  }
});

test("cars really spawn at each border, cross the river, and retire at the exit rather than inside town", () => {
  const sim = new TrafficSimulation(DEFAULT_POLICY, createDemand());
  const spawned = new Set<number>(),
    crossed = new Set<number>(),
    exited = new Set<number>();
  for (
    let tick = 0;
    tick < 20000 && sim.completed.length < sim.demand.length;
    tick++
  ) {
    const previous = new Map(
      [...sim.vehicles].map(([id, v]) => [id, { ...v.pose }]),
    );
    const completed = sim.completed.length;
    sim.step();
    for (const [id, v] of sim.vehicles) {
      const old = previous.get(id);
      if (!old && v.trip.origin.startsWith("boundary")) {
        assert.equal(
          v.previousPose.x,
          sim.network.nodes.get(v.trip.origin)!.position.x,
        );
        spawned.add(id);
      }
      if (
        (sim.network.nodes.get(v.trip.origin)!.position.x - RIVER.x) *
          (v.pose.x - RIVER.x) <
        0
      )
        crossed.add(id);
    }
    for (const done of sim.completed.slice(completed)) {
      const t = sim.demand.find((t) => t.id === done.id)!;
      if (t.destination.startsWith("boundary")) {
        const last = previous.get(done.id)!;
        assert.ok(
          Math.min(Math.abs(last.x - WORLD.min), Math.abs(last.x - WORLD.max)) <
            1,
        );
        assert.equal(sim.vehicles.has(done.id), false);
        exited.add(done.id);
      }
    }
  }
  assert.equal(spawned.size, 14);
  assert.equal(exited.size, 14);
  const commute = sim.demand.filter((t) => t.id % 20 >= 4 && t.id % 20 < 10);
  assert.ok(commute.every((t) => crossed.has(t.id)));
  assert.equal(sim.completed.length, 140);
  assert.equal(
    sim.stats.arrived +
      sim.stats.active +
      sim.stats.queued +
      sim.stats.unreleased,
    140,
  );
  assert.equal(sim.stats.unreachable, 0);
});
