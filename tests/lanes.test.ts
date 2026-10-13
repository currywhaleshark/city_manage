import test from "node:test";
import assert from "node:assert/strict";
import { TrafficSimulation } from "../src/simulation";
import { createNetwork, rebuildLanes, DEFAULT_POLICY } from "../src/scenario";
import {
  assessLaneChange,
  laneChangePose,
  LANE_CHANGE,
  nextTurn,
  permitsRoute,
  occupiesLane,
} from "../src/simulation/lanes";
import type { Network, Vehicle } from "../src/types";

function fixture() {
  const network: Network = {
    nodes: new Map(),
    roads: new Map(),
    lanes: new Map(),
    outgoing: new Map(),
  };
  for (const [id, x, z] of [
    ["a", 0, 0],
    ["b", 120, 0],
    ["c", 180, 0],
    ["d", 120, -60],
    ["e", 120, 60],
  ] as const)
    network.nodes.set(id, {
      id,
      position: { x, z },
      connectedRoadIds: [],
      signal:
        id === "d" || id === "e"
          ? { ns: 1000, ew: 1, yellow: 1, clearance: 1, offset: 0 }
          : { ns: 1, ew: 1000, yellow: 1, clearance: 1, offset: 3 },
    });
  for (const [from, to, length, laneCount] of [
    ["a", "b", 120, 2],
    ["b", "c", 60, 1],
    ["b", "d", 60, 1],
    ["b", "e", 60, 1],
  ] as const) {
    const id = from + to;
    network.roads.set(id, {
      id,
      name: id,
      startNodeId: from,
      endNodeId: to,
      direction: "one-way",
      laneCount,
      length,
      speedLimit: 9,
    });
    network.nodes.get(from)!.connectedRoadIds.push(id);
    network.nodes.get(to)!.connectedRoadIds.push(id);
  }
  rebuildLanes(network);
  const sim = new TrafficSimulation(DEFAULT_POLICY, [], network);
  const lanes = [...network.lanes.values()].filter((l) => l.roadId === "ab");
  function car(
    id: number,
    index: number,
    s: number,
    speed: number,
    targetSpeed = 9,
    destination = "c",
  ) {
    const lane = lanes[index];
    const pose = sim.lanePose(lane, s);
    const v: Vehicle = {
      id,
      trip: {
        id,
        origin: "a",
        destination,
        departAt: 0,
        purpose: "work",
        targetSpeed,
        color: 0xffffff,
      },
      laneId: lane.id,
      route: sim.route("a", destination),
      routeIndex: 0,
      s,
      speed,
      acceleration: 0,
      maxAccel: 1.8,
      comfortBrake: 2.8,
      safetyGap: 1.5,
      headway: 1.1,
      waitingTime: 0,
      enteredAt: 0,
      pose,
      previousPose: { ...pose },
    };
    sim.vehicles.set(id, v);
    return v;
  }
  return { sim, network, lanes, car };
}

test("turn lanes follow actual route geometry and retain straight access from both lanes", () => {
  const { network, lanes } = fixture();
  assert.equal(nextTurn(network, lanes[0], "bd"), "left");
  assert.equal(nextTurn(network, lanes[0], "be"), "right");
  assert.ok(permitsRoute(network, lanes[0], "bd"));
  assert.ok(!permitsRoute(network, lanes[1], "bd"));
  assert.ok(!permitsRoute(network, lanes[0], "be"));
  assert.ok(lanes.every((lane) => permitsRoute(network, lane, "bc")));
  const normal = createNetwork();
  assert.ok(
    [...normal.lanes.values()].every((lane) => lane.turns.length === 3),
  );
});

test("MOBIL rejects a dangerous rear follower even for a required route change", () => {
  const { lanes, car } = fixture();
  const self = car(0, 0, 35, 4),
    rear = car(1, 1, 23, 12);
  const decision = assessLaneChange(self, [self], [rear], lanes[1], 9, true);
  assert.ok(decision.followerAfter < -LANE_CHANGE.safeBrake);
  assert.equal(decision.allowed, false);
  rear.s = self.s;
  assert.equal(
    assessLaneChange(self, [self], [rear], lanes[1], 9, true).allowed,
    false,
  );
});

test("MOBIL changes only for useful gain and rejects an unsafe front gap", () => {
  const { lanes, car } = fixture();
  const self = car(0, 0, 25, 6),
    slow = car(1, 0, 41, 2);
  assert.equal(
    assessLaneChange(self, [self], [], lanes[1], 9, false).allowed,
    false,
  );
  assert.equal(
    assessLaneChange(self, [self, slow], [], lanes[1], 9, false).allowed,
    true,
  );
  const close = car(2, 1, 30, 0);
  assert.equal(
    assessLaneChange(self, [self, slow], [close], lanes[1], 9, false).allowed,
    false,
  );
});

test("a continuous lane change occupies both lanes, keeps speed, and releases the source on completion", () => {
  const { sim, lanes, car } = fixture();
  const self = car(0, 0, 20, 6);
  car(1, 0, 36, 2, 2);
  sim.step();
  assert.ok(self.laneChange);
  assert.equal(sim.laneChangeEvents[0].reason, "flow");
  let samples = 0;
  while (self.laneChange && sim.time < 40) {
    assert.ok(
      occupiesLane(self, lanes[0].id) && occupiesLane(self, lanes[1].id),
    );
    assert.ok(!self.crossing);
    const previous = { ...self.pose };
    sim.step();
    assert.ok(
      Math.hypot(self.pose.x - previous.x, self.pose.z - previous.z) < 1.1,
      "no lateral teleport",
    );
    samples++;
  }
  assert.ok(samples > 15);
  assert.equal(self.laneChange, undefined);
  assert.equal(self.laneId, lanes[1].id);
  assert.ok(self.speed > 0);
  assert.equal(occupiesLane(self, lanes[0].id), false);
  sim.runUntil(sim.time + 1);
  assert.equal(
    sim.laneChangeEvents.filter((e) => e.vehicle === self.id).length,
    1,
    "cooldown prevents hopping",
  );
});

test("required turn alignment waits safely and finishes before the junction", () => {
  const { sim, lanes, car } = fixture();
  const self = car(0, 1, 20, 4, 9, "d");
  sim.step();
  assert.equal(self.laneChange?.toLaneId, lanes[0].id);
  assert.equal(sim.laneChangeEvents[0].reason, "route");
  sim.runUntil(100);
  assert.equal(sim.completed.length, 1);
  const turn = sim.events.find((e) => e.node === "b" && e.type === "enter")!;
  assert.equal(turn.fromLaneId, lanes[0].id);
});

test("junction reservations and simultaneous opposite merges cannot steal a lane-change gap", () => {
  const { sim, lanes, car } = fixture();
  const a = car(0, 0, 20, 5, 9, "e"),
    b = car(1, 1, 45, 5, 9, "d");
  sim.step();
  assert.equal(sim.laneChangeEvents.length, 1);
  assert.ok(a.laneChange);
  assert.equal(b.laneChange, undefined);
  // No junction reservation is made for a car that still occupies two lanes.
  while (a.laneChange && sim.time < 40) {
    assert.equal(sim.movementReservations.has(a.id), false);
    sim.step();
  }
  assert.equal(a.laneId, lanes[1].id);
});

test("lane-change endpoints match both lane centers and tangents exactly", () => {
  const { sim, lanes } = fixture();
  assert.deepEqual(
    laneChangePose(lanes[0], lanes[1], 10, 10, 12),
    sim.lanePose(lanes[0], 10),
  );
  assert.deepEqual(
    laneChangePose(lanes[0], lanes[1], 22, 10, 12),
    sim.lanePose(lanes[1], 22),
  );
});
