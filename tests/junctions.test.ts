import test from "node:test";
import assert from "node:assert/strict";
import { TrafficSimulation } from "../src/simulation";
import {
  CONFIG,
  createDemand,
  createNetwork,
  DEFAULT_POLICY,
} from "../src/scenario";
import { createCrossing, crossingPose } from "../src/simulation/network";
import { movementsConflict } from "../src/simulation/junctions";

test("movement conflicts distinguish opposite straight traffic, turning conflicts, and merging exits", () => {
  const network = createNetwork();
  const lane = (a: string, b: string) =>
    [...network.lanes.values()].find((l) => l.from === a && l.to === b)!.id;
  const west = createCrossing(
    network,
    lane("n1-2", "n2-2"),
    lane("n2-2", "n3-2"),
  );
  const east = createCrossing(
    network,
    lane("n3-2", "n2-2"),
    lane("n2-2", "n1-2"),
  );
  const left = createCrossing(
    network,
    lane("n3-2", "n2-2"),
    lane("n2-2", "n2-3"),
  );
  const merge = createCrossing(
    network,
    lane("n2-1", "n2-2"),
    lane("n2-2", "n3-2"),
  );
  assert.equal(movementsConflict(network, west, east), false);
  assert.equal(movementsConflict(network, west, left), true);
  assert.equal(movementsConflict(network, west, merge), true);
  assert.equal(movementsConflict(network, left, west), true);
  assert.equal(movementsConflict(network, west, west), true);
});

test("opposing cars actually cross together and retain speed through an empty green junction", () => {
  const network = createNetwork();
  for (const node of network.nodes.values())
    node.signal = { ns: 1, ew: 300, yellow: 1, clearance: 1, offset: 3 };
  const seed = createDemand()[0];
  const demand = [
    { ...seed, id: 0, departAt: 0, origin: "n1-2", destination: "n3-2" },
    { ...seed, id: 1, departAt: 0, origin: "n3-2", destination: "n1-2" },
  ];
  const sim = new TrafficSimulation(DEFAULT_POLICY, demand, network);
  let simultaneous = false;
  for (let i = 0; i < 1000; i++) {
    sim.step();
    simultaneous ||=
      [...sim.vehicles.values()].filter((v) => v.crossing?.nodeId === "n2-2")
        .length === 2;
  }
  assert.ok(simultaneous);
  const entries = sim.events.filter(
    (e) => e.type === "enter" && e.node === "n2-2",
  );
  assert.equal(entries.length, 2);
  assert.ok(
    entries.every((e) => e.entrySpeed! > 5),
    "green straight approaches do not stop unnecessarily",
  );
  assert.equal(sim.completed.length, 2);
  assert.equal(sim.nodeLocks.size, 0);
  assert.equal(sim.laneReservations.size, 0);
  assert.equal(sim.movementReservations.size, 0);
});

test("curve distance produces near-constant physical increments around a turn", () => {
  const network = createNetwork();
  const from = [...network.lanes.values()].find(
    (l) => l.from === "n1-2" && l.to === "n2-2",
  )!;
  const to = [...network.lanes.values()].find(
    (l) => l.from === "n2-2" && l.to === "n2-1",
  )!;
  const curve = createCrossing(network, from.id, to.id);
  let previous = crossingPose(curve, 0);
  for (let distance = 0.2; distance < curve.length; distance += 0.2) {
    const next = crossingPose(curve, distance);
    const step = Math.hypot(next.x - previous.x, next.z - previous.z);
    assert.ok(step > 0.195 && step < 0.205, `arc increment ${step}`);
    previous = next;
  }
  assert.ok(curve.length > CONFIG.carLength);
});
