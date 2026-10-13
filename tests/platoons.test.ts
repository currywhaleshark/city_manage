import test from "node:test";
import assert from "node:assert/strict";
import { CLEAR_DISTANCE, sameMovement } from "../src/simulation/junctions";
import { standingQueue, measureDischarge } from "./queue-fixture";
import { overlaps } from "./geometry-helper";

for (const turn of [false, true]) {
  test(`${turn ? "turning" : "straight"} standing queue follows inside the junction without body overlap`, () => {
    const { sim, greenAt } = standingQueue(30, turn);
    let maxConcurrent = 0;
    while (sim.time < greenAt + 150 && sim.completed.length < 30) {
      sim.step();
      const cars = [...sim.vehicles.values()];
      const crossing = cars.filter((v) => v.crossing?.nodeId === "b");
      maxConcurrent = Math.max(maxConcurrent, crossing.length);
      for (let i = 0; i < cars.length; i++)
        for (let j = i + 1; j < cars.length; j++) {
          assert.ok(
            !overlaps(cars[i].pose, cars[j].pose),
            `cars ${cars[i].id}/${cars[j].id} overlap at ${sim.time}`,
          );
          const a = cars[i].crossing,
            b = cars[j].crossing;
          if (a && b && sameMovement(a, b))
            assert.ok(
              Math.abs(a.distance - b.distance) >= CLEAR_DISTANCE - 1e-8,
            );
        }
      for (const [laneId, ids] of sim.laneReservations) {
        for (const id of ids)
          assert.equal(sim.movementReservations.get(id)?.nextLaneId, laneId);
      }
    }
    assert.ok(
      maxConcurrent >= 2,
      "followers enter before the leader leaves the junction",
    );
    assert.equal(sim.completed.length, 30);
    assert.equal(sim.movementReservations.size, 0);
    assert.equal(sim.nodeLocks.size, 0);
    assert.equal(sim.laneReservations.size, 0);
    const measurement = measureDischarge(sim, greenAt);
    assert.equal(measurement.sampledHeadways, 26);
    // Wide regression bounds detect accidental full-junction serialization.
    assert.ok(
      measurement.meanHeadway > 1.5 &&
        measurement.meanHeadway < (turn ? 3.2 : 2.5),
    );
    assert.ok(
      sim.events
        .filter((e) => e.type === "enter")
        .every((e) => e.phase.endsWith("green")),
    );
  });
}

test("a blocked outlet reserves only storage that fits and drains after reopening", () => {
  const { sim, greenAt } = standingQueue(30, false, true);
  sim.runUntil(greenAt + 150);
  const outlet = [...sim.network.lanes.values()].find(
    (lane) => lane.from === "b",
  )!;
  const cars = [...sim.vehicles.values()];
  const downstream = cars.filter((v) => v.laneId === outlet.id && !v.crossing);
  assert.equal(downstream.length, Math.floor(outlet.length / CLEAR_DISTANCE));
  assert.ok(downstream.every((v) => v.s >= CLEAR_DISTANCE && v.speed < 0.3));
  assert.ok(
    cars.every((v) => !v.crossing),
    "spillback must not strand cars inside the junction",
  );
  assert.equal(cars.length + sim.pending.length + sim.completed.length, 30);
  assert.equal(sim.laneReservations.size, 0);
  sim.network.nodes.get("c")!.signal = {
    ns: 1,
    ew: 10000,
    yellow: 1,
    clearance: 1,
    offset: 0,
  };
  sim.runUntil(greenAt + 300);
  assert.equal(sim.completed.length, 30);
  assert.equal(sim.nodeLocks.size, 0);
  assert.equal(sim.laneReservations.size, 0);
});

test("yellow cancels approaching followers while admitted cars clear the junction", () => {
  const { sim, greenAt } = standingQueue();
  sim.network.nodes.get("b")!.signal.ew = 5;
  sim.runUntil(greenAt + 4.9);
  assert.ok(
    [...sim.movementReservations.values()].some((plan) => plan.nodeId === "b"),
  );
  sim.runUntil(greenAt + 5);
  for (const [id, plan] of sim.movementReservations) {
    if (plan.nodeId !== "b") continue;
    const car = sim.vehicles.get(id)!;
    assert.ok(
      car.crossing || car.laneId === plan.nextLaneId,
      "yellow releases only unentered claims",
    );
  }
  sim.runUntil(greenAt + 20);
  const entries = sim.events.filter(
    (e) => e.type === "enter" && e.node === "b",
  );
  assert.ok(entries.length >= 2 && entries.length < 30);
  assert.ok(
    entries.every((e) => e.time < greenAt + 5 && e.phase === "ew-green"),
  );
  assert.ok(!sim.nodeLocks.has("b"));
  assert.equal(sim.laneReservations.size, 0);
});
