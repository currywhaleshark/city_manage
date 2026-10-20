import test from "node:test";
import assert from "node:assert/strict";
import { TrafficSimulation } from "../src/simulation";
import { CONFIG, createNetwork, DEFAULT_POLICY } from "../src/scenario";
import { boundaryNode } from "../src/city/world";
import { createCityDemand } from "../src/simulation/city-demand";
import { arrivalPath, planVehicleArrival, planVehicleDeparture, vehicleAccesses } from "../src/simulation/vehicle-access";
import { curvePoint } from "../src/simulation/network";
import { LiveCitySimulation, restoreLiveCity, validateLiveSave } from "../src/simulation/live";
import { captureLiveCheckpoint, restoreLiveCheckpoint } from "../src/simulation/checkpoint";
import type { Trip, Vehicle } from "../src/types";
import { overlaps } from "./geometry-helper";

const trip = (id: number, origin: string, destination: string, departAt = 0): Trip => ({
  id, origin, destination, departAt, purpose: "work", color: 0xffffff, targetSpeed: 8,
});
class ArrivalTraffic extends TrafficSimulation {
  override get usesVehicleAccess() { return true; }
  override get usesVehicleArrivals() { return true; }
}

test("destination routes reach the right forecourt with no U-turns and continuous lane-to-bay curves", () => {
  for (const oneWay of [false, true]) {
    const network = createNetwork({ ...DEFAULT_POLICY, oneWay });
    const sim = new TrafficSimulation(DEFAULT_POLICY, [], network);
    for (const access of vehicleAccesses(network)) {
      const path = arrivalPath(network, access);
      const lane = network.lanes.get(access.laneId)!;
      assert.deepEqual(curvePoint(path.points, 0), sim.lanePose(lane, path.entryS));
      const end = curvePoint(path.points, 1), bay = access.points[0];
      assert.equal(end.x, bay.x);
      assert.equal(end.z, bay.z);
    }
    const demand = [...createCityDemand(), trip(999, "n0-0", "n0-0")];
    for (const request of demand) {
      if (network.nodes.get(request.destination)!.boundary) continue;
      const departure = network.nodes.get(request.origin)!.boundary ? undefined :
        planVehicleDeparture(network, request);
      const arrival = planVehicleArrival(network, request, departure);
      assert.ok(arrival, `no destination access for trip ${request.id}`);
      let node = departure ? network.lanes.get(departure.access.laneId)!.from : request.origin;
      for (let i = 0; i < arrival.route.length; i++) {
        const lane = network.outgoing.get(node)?.find(l => l.roadId === arrival.route[i]);
        assert.ok(lane, `broken route ${request.id}: ${node} -> ${arrival.route[i]}`);
        assert.notEqual(arrival.route[i], arrival.route[i + 1]);
        node = lane.to;
      }
      assert.equal(arrival.route.at(-1), network.lanes.get(arrival.access.laneId)!.roadId);
    }
  }
});

test("a car completes only after entering its building and pausing there; external exits stay at the boundary", () => {
  const sim = new ArrivalTraffic(DEFAULT_POLICY, [trip(1, "n0-1", "n0-0")]);
  let parked = 0, turning = 0, previous: Vehicle | undefined;
  for (let tick = 0; tick < 5000 && !sim.completed.length; tick++) {
    const before = sim.vehicles.get(1);
    previous = before && structuredClone(before);
    sim.step();
    const car = sim.vehicles.get(1);
    if (car?.arrival?.progress !== undefined) {
      assert.equal(sim.completed.length, 0);
      assert.ok(Math.hypot(car.pose.x - car.previousPose.x, car.pose.z - car.previousPose.z) < 0.6);
      if (car.arrival.progress === 1) parked++;
      else turning++;
    }
  }
  assert.equal(sim.completed.length, 1);
  assert.equal(previous!.arrival!.progress, 1);
  assert.ok(parked >= 10 && turning >= 40);
  assert.deepEqual(previous!.pose, curvePoint(previous!.arrival!.points, 1));

  const external = new ArrivalTraffic(DEFAULT_POLICY, [trip(2, "n7-5", boundaryNode("east", 1))]);
  let last: Vehicle | undefined;
  for (let tick = 0; tick < 5000 && !external.completed.length; tick++) {
    last = external.vehicles.get(2);
    external.step();
    assert.equal(last?.arrival, undefined);
  }
  assert.equal(external.completed.length, 1);
  assert.equal(last!.pose.x, external.network.nodes.get(boundaryNode("east", 1))!.position.x);
});

test("recurring arrivals enter off-road bays without overlapping traffic or school walkers", () => {
  for (const seed of [2404, 2405]) {
    const city = new LiveCitySimulation(seed);
    const arrived = new Set<number>(), turning = new Set<number>();
    for (let tick = 0; tick < 6000; tick++) {
      const before = new Map([...city.vehicles].filter(([, v]) => v.arrival));
      city.step();
      for (const [id, old] of before) if (old.arrival && !city.vehicles.has(id)) {
        assert.equal(old.arrival.progress, 1, `vehicle ${id} disappeared in the street at ${city.time}`);
        assert.deepEqual(old.pose, curvePoint(old.arrival.points, 1));
        arrived.add(id);
      }
      for (const car of city.vehicles.values()) if (car.arrival?.progress !== undefined) {
        turning.add(car.id);
        for (const other of city.vehicles.values()) if (other.id !== car.id)
          assert.ok(!overlaps(car.pose, other.pose),
            `arrival ${car.id} overlaps ${other.id} at ${city.time}: ${JSON.stringify([car.pose, other.pose])}`);
        for (const walker of city.pedestrians.active.values()) {
          const dx = walker.pose.x - car.pose.x, dz = walker.pose.z - car.pose.z;
          const lateral = Math.abs(dx * Math.cos(car.pose.angle) - dz * Math.sin(car.pose.angle));
          const forward = Math.abs(dx * Math.sin(car.pose.angle) + dz * Math.cos(car.pose.angle));
          const gap = Math.hypot(Math.max(0, lateral - CONFIG.carWidth / 2),
            Math.max(0, forward - CONFIG.carLength / 2));
          assert.ok(gap >= 0.27, `arrival ${car.id} blocks walker ${walker.trip.id} at ${city.time}`);
        }
      }
    }
    assert.ok(arrived.size >= 40, `only ${arrived.size} arrivals finished`);
    assert.ok(turning.size >= arrived.size);
    assert.equal(city.stats.unreachable, 0);
  }
});

test("departing traffic waits for an incoming car to clear the shared bay, then every queued trip finishes", () => {
  const sim = new ArrivalTraffic(DEFAULT_POLICY, [trip(1, "n0-1", "n0-0")]);
  for (let tick = 0; tick < 4000 && sim.vehicles.get(1)?.arrival?.progress === undefined; tick++) sim.step();
  const arrival = sim.vehicles.get(1)!.arrival!;
  assert.ok(arrival.progress !== undefined);
  const departures = Array.from({ length: 4 }, (_, i) => trip(i + 2, "n0-0", "n0-1", sim.time));
  assert.equal(planVehicleDeparture(sim.network, departures[0])!.access.id, arrival.accessId);
  sim.scheduleDemand(departures);
  let delayed = 0;
  for (let tick = 0; tick < 9000 && sim.completed.length < 5; tick++) {
    sim.step();
    if (sim.vehicles.has(1)) {
      assert.equal(sim.pending.length, 4);
      delayed++;
    }
    const cars = [...sim.vehicles.values()];
    for (let i = 0; i < cars.length; i++) for (const other of cars.slice(i + 1))
      assert.ok(!overlaps(cars[i].pose, other.pose));
  }
  assert.ok(delayed >= 49);
  assert.equal(sim.completed.length, 5);
  assert.equal(sim.pending.length, 0);
  assert.equal(sim.vehicles.size, 0);
});

test("arrival turns and parked dwell survive both cached and portable saves exactly", async () => {
  const city = new LiveCitySimulation();
  for (let tick = 0; tick < 3000 && ![...city.vehicles.values()].some(v =>
    v.arrival?.progress !== undefined && v.arrival.progress > 0.3 && v.arrival.progress < 0.7); tick++) city.step();
  assert.ok([...city.vehicles.values()].some(v => v.arrival?.progress !== undefined));
  const copy = restoreLiveCheckpoint(captureLiveCheckpoint(city), city.save());
  const replay = await restoreLiveCity(city.save());
  for (let tick = 0; tick < 100; tick++) {
    assert.deepEqual([...copy.vehicles], [...city.vehicles]);
    assert.deepEqual([...replay.vehicles], [...city.vehicles]);
    city.step(); copy.step(); replay.step();
  }
  assert.deepEqual(copy.completed, city.completed);
  assert.deepEqual(replay.completed, city.completed);

  for (let tick = 0; tick < 3000 && ![...city.vehicles.values()].some(v => v.arrival?.progress === 1); tick++) city.step();
  assert.ok([...city.vehicles.values()].some(v => v.arrival?.progress === 1));
  const parked = restoreLiveCheckpoint(captureLiveCheckpoint(city), city.save());
  city.runUntil(city.time + 2); parked.runUntil(parked.time + 2);
  assert.deepEqual([...parked.vehicles], [...city.vehicles]);
  assert.deepEqual(parked.completed, city.completed);
});

test("v4 caches and JSON keep old journeys intact and assign building arrivals only to future trips", async () => {
  const old = new LiveCitySimulation(2404, 0, 0, Infinity);
  old.runUntil(150);
  old.apply("signal", "n3-2");
  old.observe(); old.notes = "주차장 도착 전 도시";
  const save = old.save(), cache = captureLiveCheckpoint(old);
  assert.equal(save.vehicleArrivalFrom, undefined);
  (cache as any).version = "living-state-4";
  delete cache.state.world.vehicleArrivalFrom;
  const copy = restoreLiveCheckpoint(cache, save), replay = await restoreLiveCity(save);
  assert.equal(copy.vehicleArrivalFrom, 150.1);
  for (const restored of [copy, replay]) {
    assert.deepEqual([...restored.vehicles], [...old.vehicles]);
    assert.deepEqual(restored.observations, old.observations);
    assert.equal(restored.notes, old.notes);
  }
  old.vehicleArrivalFrom = 150.1;
  for (const city of [old, copy, replay]) city.runUntil(330);
  assert.deepEqual([...copy.vehicles], [...old.vehicles]);
  assert.deepEqual([...replay.vehicles], [...old.vehicles]);
  assert.deepEqual(copy.news, old.news);
  assert.deepEqual(copy.save(), old.save());
  assert.ok([...copy.vehicles.values()].some(v => v.arrival));
  for (const vehicleArrivalFrom of [-1, 0.05, NaN, Infinity, 330.2])
    assert.throws(() => validateLiveSave({ ...copy.save(), vehicleArrivalFrom }));
  assert.throws(() => restoreLiveCheckpoint(captureLiveCheckpoint(copy), { ...copy.save(), vehicleArrivalFrom: 0 }));
});
