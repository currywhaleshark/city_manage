import assert from "node:assert/strict";
import { TrafficSimulation } from "../src/simulation";
import { createDemand, DEFAULT_POLICY, rebuildLanes } from "../src/scenario";
import type { Network } from "../src/types";

/** Isolated long approach; a real red phase lets the engine form a standing queue. */
export function standingQueue(count = 30, turn = false, blockedExit = false) {
  const network: Network = {
    nodes: new Map(),
    roads: new Map(),
    lanes: new Map(),
    outgoing: new Map(),
  };
  const greenAt = 243;
  for (const [id, x, z] of [
    ["a", -270, 0],
    ["b", 0, 0],
    ["c", turn ? 0 : 270, turn ? -270 : 0],
  ] as const) {
    network.nodes.set(id, {
      id,
      position: { x, z },
      connectedRoadIds: [],
      signal:
        id === "b"
          ? { ns: 240, ew: 1000, yellow: 2, clearance: 1, offset: 0 }
          : {
              ns: turn ? 1000 : 1,
              ew: turn ? 1 : 1000,
              yellow: 1,
              clearance: 1,
              offset: turn ? 0 : 3,
            },
    });
  }
  for (const [from, to] of [
    ["a", "b"],
    ["b", "c"],
  ]) {
    const id = from + to;
    network.roads.set(id, {
      id,
      name: id,
      startNodeId: from,
      endNodeId: to,
      direction: "one-way",
      laneCount: 1,
      length: 270,
      speedLimit: 8,
    });
    network.nodes.get(from)!.connectedRoadIds.push(id);
    network.nodes.get(to)!.connectedRoadIds.push(id);
  }
  if (blockedExit) {
    network.nodes.get("c")!.position = { x: 48, z: 0 };
    network.roads.get("bc")!.length = 48;
    network.nodes.get("c")!.signal = {
      ns: 10000,
      ew: 1,
      yellow: 1,
      clearance: 1,
      offset: 0,
    };
  }
  rebuildLanes(network);
  const template = createDemand()[0];
  const demand = Array.from({ length: count }, (_, id) => ({
    ...template,
    id,
    departAt: 0,
    origin: "a",
    destination: "c",
    targetSpeed: 8,
  }));
  const sim = new TrafficSimulation(DEFAULT_POLICY, demand, network);
  sim.runUntil(240);
  assert.equal(
    sim.vehicles.size,
    count,
    "all demand reaches the approach before green",
  );
  assert.equal(sim.pending.length, 0);
  assert.ok(
    [...sim.vehicles.values()].every((v) => v.speed < 0.3),
    "measure a standing queue, not a sparse arriving stream",
  );
  return { sim, greenAt };
}

export function measureDischarge(
  sim: TrafficSimulation,
  greenAt: number,
  node = "b",
) {
  const entries = sim.events.filter(
    (e) => e.type === "enter" && e.node === node,
  );
  // Consecutive departures beginning with vehicle 4: omit startup headways 1..3.
  const headways = entries
    .slice(4)
    .map((entry, i) => entry.time - entries[i + 3].time);
  const mean = headways.reduce((sum, h) => sum + h, 0) / headways.length;
  return {
    count: entries.length,
    greenAt,
    firstEntry: entries[0]?.time,
    lastEntry: entries.at(-1)?.time,
    entrySpeeds: entries.map((e) => e.entrySpeed),
    sampledHeadways: headways.length,
    headways,
    meanHeadway: mean,
    saturationFlowPerHourPerLane: 3600 / mean,
  };
}
