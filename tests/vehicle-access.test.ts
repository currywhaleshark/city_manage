import test from "node:test";
import assert from "node:assert/strict";
import { TrafficSimulation } from "../src/simulation";
import { BUILDINGS, CONFIG, createNetwork, DEFAULT_POLICY } from "../src/scenario";
import { BUILDABLE_PLOTS, RIVER, inCityBounds, boundaryNode } from "../src/city/world";
import { vehicleAccesses, planVehicleDeparture } from "../src/simulation/vehicle-access";
import { curvePoint } from "../src/simulation/network";
import { LiveCitySimulation, restoreLiveCity, validateLiveSave } from "../src/simulation/live";
import { captureLiveCheckpoint, restoreLiveCheckpoint } from "../src/simulation/checkpoint";
import type { Trip } from "../src/types";
import { overlaps } from "./geometry-helper";

const trip = (id: number, origin: string, destination: string, departAt = 0): Trip => ({
  id, origin, destination, departAt, purpose: "work", color: 0xffffff, targetSpeed: 8,
});
class AccessTraffic extends TrafficSimulation {
  override get usesVehicleAccess() { return true; }
}

test("every building exit is off the carriageway and leaves the river and construction plots clear", () => {
  for (const oneWay of [false, true]) {
    const network = createNetwork({ ...DEFAULT_POLICY, oneWay });
    const accesses = vehicleAccesses(network);
    assert.equal(accesses.length, BUILDINGS.filter(b => b.kind !== "park").length);
    assert.equal(new Set(accesses.map(a => a.id)).size, accesses.length);
    for (const access of accesses) {
      const lane = network.lanes.get(access.laneId)!;
      const start = curvePoint(access.points, 0), end = curvePoint(access.points, 1);
      const expected = new TrafficSimulation(DEFAULT_POLICY, [], network).lanePose(lane, access.mergeS);
      assert.ok(Math.hypot(end.x - expected.x, end.z - expected.z) < 1e-8);
      assert.ok(Math.abs(end.angle - expected.angle) < 1e-8);
      assert.ok(inCityBounds(start));
      assert.ok(Math.abs(start.x - RIVER.x) > RIVER.width / 2 + CONFIG.carWidth);
      for (const plot of BUILDABLE_PLOTS)
        assert.ok(Math.abs(start.x - plot.position.x) > plot.width / 2 + 2 ||
          Math.abs(start.z - plot.position.z) > plot.depth / 2 + 2);
      for (const road of network.roads.values()) {
        const a = network.nodes.get(road.startNodeId)!.position;
        const b = network.nodes.get(road.endNodeId)!.position;
        const t = Math.max(0, Math.min(1, ((start.x-a.x)*(b.x-a.x)+(start.z-a.z)*(b.z-a.z)) / road.length ** 2));
        assert.ok(Math.hypot(start.x-a.x-(b.x-a.x)*t, start.z-a.z-(b.z-a.z)*t) >= 7.1,
          `${access.id} must start with its entire body outside the road`);
      }
    }
  }
});

test("departures yield to a blocked road, then turn continuously into a safe reserved space", () => {
  const sim = new AccessTraffic(DEFAULT_POLICY, []);
  const request = trip(1, "n0-1", "n0-0");
  const plan = planVehicleDeparture(sim.network, request)!;
  const lane = sim.network.lanes.get(plan.access.laneId)!;
  assert.ok(sim.dispatchService(90000, request.origin, lane.id));
  for (let i=0; i<6000 && !sim.serviceJourneys.get(90000)?.arrived; i++) sim.step();
  assert.equal(sim.serviceJourneys.get(90000)?.arrived, true);
  sim.scheduleDemand([{ ...request, departAt: sim.time }]);
  sim.step();
  const car = sim.vehicles.get(1)!;
  const start = curvePoint(plan.access.points, 0);
  assert.deepEqual(car.pose, start);
  assert.equal(car.departure?.merging, false);
  sim.runUntil(sim.time + 10);
  assert.deepEqual(car.pose, start);
  assert.equal(sim.stats.roads.find(r => r.id === lane.roadId)!.count, 1,
    "a waiting car in a forecourt is not road congestion");
  sim.retireService(90000);
  let steps = 0;
  while (car.departure && steps++ < 100) {
    const before = { ...car.pose };
    sim.step();
    assert.ok(Math.hypot(car.pose.x-before.x, car.pose.z-before.z) < 0.5);
  }
  assert.ok(steps >= 39 && steps <= 41);
  assert.equal(car.departure, undefined);
  assert.equal(car.laneId, lane.id);
  assert.equal(car.s, plan.access.mergeS);
  sim.runUntil(sim.time + 180);
  assert.equal(sim.completed.length, 1);
});

test("live cars and local service vehicles originate in real forecourts, while boundary entries stay at the edge", () => {
  for (const seed of [2404, 2405]) {
    const city = new LiveCitySimulation(seed);
    const accesses = new Map(vehicleAccesses(city.network).map(a => [a.id, a]));
    const seen = new Set<number>();
    let local = 0, boundary = 0, service = 0, parking = 0;
    for (let tick = 0; tick < 6000; tick++) {
      city.step();
      for (const [id, car] of city.vehicles) {
        if (seen.has(id)) continue;
        seen.add(id);
        const origin = city.network.nodes.get(car.trip.origin)!;
        if (origin.boundary) {
          assert.ok(!car.departure);
          assert.equal(car.previousPose.x, origin.position.x);
          boundary++;
        } else if (inCityBounds(origin.position)) {
          assert.ok(car.departure, `vehicle ${id} must not materialize in a lane`);
          const access = accesses.get(car.departure.accessId)!;
          assert.deepEqual(car.previousPose, curvePoint(access.points, 0));
          local++;
          if (city.serviceJourneys.has(id)) service++;
          if (city.parking.episodes.some(e => e.request.id === id)) parking++;
        }
      }
      for (const car of city.vehicles.values()) if (car.departure) {
        for (const walker of city.pedestrians.active.values()) {
          const dx = walker.pose.x - car.pose.x, dz = walker.pose.z - car.pose.z;
          const lateral = Math.abs(dx * Math.cos(car.pose.angle) - dz * Math.sin(car.pose.angle));
          const forward = Math.abs(dx * Math.sin(car.pose.angle) + dz * Math.cos(car.pose.angle));
          const gap = Math.hypot(Math.max(0, lateral - CONFIG.carWidth / 2),
            Math.max(0, forward - CONFIG.carLength / 2));
          assert.ok(gap >= 0.27, `departure ${car.id} blocks walker ${walker.trip.id} at ${city.time}`);
        }
        for (const other of city.vehicles.values()) {
          if (car.id === other.id) continue;
          assert.ok(!overlaps(car.pose, other.pose),
            `departure ${car.id} overlaps ${other.id} at ${city.time}`);
        }
      }
    }
    assert.ok(local >= 50);
    assert.ok(boundary >= 4);
    assert.ok(service >= 4);
    assert.ok(parking >= 3);
    assert.ok(city.parking.episodes.some(e => e.illegalSeconds > 0 && e.request.surface === "road"),
      "incoming parking journeys reach their stop and accumulate actual parking time");
    assert.equal(city.stats.unreachable, 0);
  }
  const outgoing = new AccessTraffic(DEFAULT_POLICY, [trip(1, "n7-5", boundaryNode("east", 1))]);
  outgoing.runUntil(500);
  assert.equal(outgoing.completed.length, 1);
});

test("saving during a turn preserves the departure curve and following traffic exactly", async () => {
  const city = new LiveCitySimulation();
  city.runUntil(1.5);
  assert.ok([...city.vehicles.values()].some(v => v.departure?.merging));
  const copy = restoreLiveCheckpoint(captureLiveCheckpoint(city), city.save());
  const replay = await restoreLiveCity(city.save());
  assert.deepEqual([...copy.vehicles], [...city.vehicles]);
  assert.deepEqual([...replay.vehicles], [...city.vehicles]);
  for (let tick = 0; tick < 100; tick++) {
    city.step(); copy.step(); replay.step();
    assert.deepEqual([...copy.vehicles], [...city.vehicles]);
    assert.deepEqual([...replay.vehicles], [...city.vehicles]);
  }
});

test("v3 caches and portable saves retain existing traffic and enable exits only after resuming", async () => {
  const old = new LiveCitySimulation(2404, 0, Infinity);
  old.apply("signal", "n3-2");
  old.runUntil(150);
  old.notes = "계속 살펴볼 도시";
  old.observe();
  const save = old.save(), checkpoint = captureLiveCheckpoint(old);
  (checkpoint as any).version = "living-state-3";
  delete checkpoint.state.world.vehicleAccessFrom;
  const copy = restoreLiveCheckpoint(checkpoint, save);
  const replay = await restoreLiveCity(save);
  assert.equal(copy.vehicleAccessFrom, 150.1);
  assert.deepEqual([...copy.vehicles], [...old.vehicles]);
  assert.deepEqual([...replay.vehicles], [...old.vehicles]);
  assert.deepEqual(copy.observations, old.observations);
  old.vehicleAccessFrom = 150.1;
  for (const city of [old, copy, replay]) city.runUntil(330);
  assert.deepEqual([...copy.vehicles], [...old.vehicles]);
  assert.deepEqual([...replay.vehicles], [...old.vehicles]);
  assert.deepEqual(copy.news, old.news);
  assert.deepEqual(copy.save(), old.save());
  assert.equal(save.vehicleAccessFrom, undefined);
  const checkpointAgain = captureLiveCheckpoint(copy);
  assert.deepEqual([...restoreLiveCheckpoint(checkpointAgain, copy.save()).vehicles], [...copy.vehicles]);
  for (const vehicleAccessFrom of [-1, 0.05, NaN, Infinity, 330.2])
    assert.throws(() => validateLiveSave({ ...copy.save(), vehicleAccessFrom }));
  assert.throws(() => restoreLiveCheckpoint(checkpointAgain, { ...copy.save(), vehicleAccessFrom: 0 }));
});
