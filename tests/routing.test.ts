import test from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, createNetwork, DEFAULT_POLICY, SCHOOL_NODE } from "../src/scenario";
import { TrafficSimulation } from "../src/simulation";
import { createCityDemand } from "../src/simulation/city-demand";
import { findDrivingRoute, drivingRouteSeconds } from "../src/simulation/routing";
import { planVehicleArrival, planVehicleDeparture } from "../src/simulation/vehicle-access";
import { LiveCitySimulation, restoreLiveCity, validateLiveSave } from "../src/simulation/live";
import { captureLiveCheckpoint, restoreLiveCheckpoint } from "../src/simulation/checkpoint";
import { overlaps } from "./geometry-helper";
import { createCrossing, crossingPose, curvePoint } from "../src/simulation/network";

test("directed arrival routes use equally close buildings and legal turns instead of unnecessary block loops", () => {
  const network = createNetwork();
  let shorter = 0, oldSeconds = 0, newSeconds = 0;
  for (const trip of createCityDemand()) {
    if (network.nodes.get(trip.destination)!.boundary) continue;
    const departure = network.nodes.get(trip.origin)!.boundary ? undefined : planVehicleDeparture(network, trip);
    const old = planVehicleArrival(network, trip, departure)!;
    const next = planVehicleArrival(network, trip, departure, () => 0)!;
    const destination = network.nodes.get(trip.destination)!.position;
    const distance = (id: string) => {
      const building = BUILDINGS.find(b => b.id === id)!;
      return Math.hypot(building.x - destination.x, building.z - destination.z);
    };
    assert.ok(distance(next.access.buildingId) <= distance(old.access.buildingId) + 1e-7);
    if (trip.destination === SCHOOL_NODE)
      assert.equal(BUILDINGS.find(b => b.id === next.access.buildingId)!.kind, "school");
    let from = departure ? network.lanes.get(departure.access.laneId)!.from : trip.origin;
    for (let i = 0; i < next.route.length; i++) {
      const lane = network.outgoing.get(from)!.find(l => l.roadId === next.route[i]);
      assert.ok(lane);
      assert.notEqual(next.route[i], next.route[i + 1], "no instantaneous U-turn");
      from = lane.to;
    }
    if (departure) {
      const source = network.lanes.get(departure.access.laneId)!;
      const a = drivingRouteSeconds(network, source, old.route.slice(1),
        { laneId: old.access.laneId, endS: old.entryS }, () => 0);
      const b = drivingRouteSeconds(network, source, next.route.slice(1),
        { laneId: next.access.laneId, endS: next.entryS }, () => 0);
      assert.ok(b <= a + 1e-7, `trip ${trip.id} got a longer free-flow route`);
      if (b < a - 1) shorter++;
      oldSeconds += a; newSeconds += b;
    }
  }
  assert.ok(shorter >= 10);
  assert.ok(newSeconds < oldSeconds);
  const schoolTrip = createCityDemand().find(trip => trip.destination === SCHOOL_NODE)!;
  const departure = planVehicleDeparture(network, schoolTrip)!;
  const schoolAccess = planVehicleArrival(network, schoolTrip, departure)!.access;
  assert.equal(planVehicleArrival(network, schoolTrip, departure,
    lane => lane.id === schoolAccess.laneId ? Infinity : 0), undefined,
    "an inaccessible school must not be replaced by a different destination building");
});

test("a full approach gets a legal detour while disconnected destinations stay unreachable", () => {
  const network = createNetwork();
  const incoming = network.outgoing.get("n0-5")!.find(l => l.to === "n1-5")!;
  const goal = { nodeId: "n3-5" };
  const normal = findDrivingRoute(network, { nodeId: incoming.to, incomingLaneId: incoming.id }, goal)!;
  const jam = normal.roads[0];
  const delay = (lane: typeof incoming) => lane.roadId === jam ? 240 : 0;
  const detour = findDrivingRoute(network, { nodeId: incoming.to, incomingLaneId: incoming.id }, goal, delay)!;
  assert.notEqual(detour.roads[0], jam);
  assert.notEqual(detour.roads[0], incoming.roadId);
  assert.ok(detour.seconds < drivingRouteSeconds(network, incoming, normal.roads, goal, delay));
  assert.equal(findDrivingRoute(network, { nodeId: incoming.to, incomingLaneId: incoming.id }, goal, () => Infinity), undefined);
});

test("a driver physically goes around an occupied street without removing its stopped vehicles", () => {
  class AdaptiveTraffic extends TrafficSimulation {
    override get usesAdaptiveRouting() { return true; }
  }
  const city = new AdaptiveTraffic(DEFAULT_POLICY, []);
  const blocked = city.network.outgoing.get("n1-5")!.find(l => l.to === "n2-5")!;
  for (let id = 90000; id < 90005; id++) assert.ok(city.dispatchService(id, "n1-5", blocked.id));
  city.runUntil(90);
  assert.equal(city.serviceJourneys.get(90000)?.arrived, true);
  city.scheduleDemand([{ id: 1, origin: "n0-5", destination: "n3-5", departAt: city.time,
    purpose: "work", targetSpeed: 8, color: 0xffffff }]);
  let rerouted = false;
  const driven = new Set<string>();
  for (let tick = 0; tick < 6000 && !city.completed.length; tick++) {
    city.step();
    const car = city.vehicles.get(1);
    if (!car) continue;
    if (car.routing?.changes) rerouted = true;
    driven.add(city.network.lanes.get(car.laneId)!.roadId);
    for (const other of city.vehicles.values()) if (other.id !== car.id)
      assert.ok(!overlaps(car.pose, other.pose));
  }
  assert.ok(rerouted);
  assert.equal(city.completed[0]?.id, 1);
  assert.ok(!driven.has(blocked.roadId));
  assert.equal(city.serviceJourneys.size, 5);
  assert.equal(city.vehicles.size, 5);
});

test("a bay exit safely clears an arrival that is holding a crossing queue behind it", () => {
  class AccessTraffic extends TrafficSimulation {
    override get usesVehicleAccess() { return true; }
    override get usesVehicleArrivals() { return true; }
    override get usesAdaptiveRouting() { return true; }
  }
  const city = new AccessTraffic(DEFAULT_POLICY, [{ id: 1, origin: "n0-1", destination: "n0-0",
    departAt: 0, purpose: "work", targetSpeed: 8, color: 0xffffff }]);
  city.step();
  const exit = city.vehicles.get(1)!;
  const departure = exit.departure!;
  const lane = city.network.lanes.get(exit.laneId)!;
  departure.merging = false; departure.progress = 0;
  exit.pose = curvePoint(departure.points, 0);
  const entryS = exit.s - 8;
  const waiting = { ...structuredClone(exit), id: 2, departure: undefined,
    trip: { ...exit.trip, id: 2 }, route: [lane.roadId], routeIndex: 0,
    s: entryS, pose: city.lanePose(lane, entryS), speed: 0,
    arrival: { accessId: departure.accessId, laneId: lane.id, entryS,
      points: [city.lanePose(lane, entryS), city.lanePose(lane, exit.s - 1),
        departure.points[1], departure.points[0]] as typeof departure.points } };
  city.vehicles.set(2, waiting);
  const incoming = [...city.network.lanes.values()].find(l => l.to === lane.from && l.roadId !== lane.roadId)!;
  const crossing = createCrossing(city.network, incoming.id, lane.id);
  crossing.distance = crossing.length - 1; crossing.progress = crossing.distance / crossing.length;
  const follower = { ...structuredClone(exit), id: 3, departure: undefined, arrival: undefined,
    trip: { ...exit.trip, id: 3, destination: lane.to }, laneId: incoming.id,
    route: [incoming.roadId, lane.roadId], routeIndex: 0, s: incoming.length,
    speed: 0, crossing, pose: crossingPose(crossing, crossing.distance) };
  city.vehicles.set(3, follower);
  city.movementReservations.set(3, crossing);
  city.nodeLocks.set(lane.from, new Set([3]));
  city.laneReservations.set(lane.id, new Set([3]));
  city.step();
  assert.equal(exit.departure?.merging, true, "the stopped arrival protects the exit from its queued follower");
  assert.ok(city.movementReservations.has(3), "do not discard the crossing's physical reservation");
  for (let tick = 0; tick < 200; tick++) {
    city.step();
    const cars = [...city.vehicles.values()];
    for (let i = 0; i < cars.length; i++) for (const other of cars.slice(i + 1))
      assert.ok(!overlaps(cars[i].pose, other.pose), `${cars[i].id} overlaps ${other.id} at ${city.time}`);
  }
  assert.equal(exit.departure, undefined);
  assert.ok(city.completed.some(car => car.id === 2), "the arrival then enters the vacated bay");
});

test("rerouting preserves the car, destination and driven path, with safe junctions and a change cooldown", t => {
  // A pinned pre-east-bank history keeps the same blocked queue under test.
  const city = new LiveCitySimulation(2404, 0, 0, 0, Infinity, Infinity, Infinity, 0, 300, Infinity);
  city.runUntil(300); city.apply("signal", "n3-2"); city.apply("patrol", "homes");
  city.runUntil(900);
  city.trafficRoutingFrom = 900.1;
  const changes = new Map<number, number>();
  const turners = new Set<number>();
  for (let tick = 0; tick < 9000; tick++) {
    const before = new Map([...city.vehicles].map(([id, v]) => [id, {
      route: v.route, index: v.routeIndex, trip: v.trip,
      target: v.arrival?.accessId, changes: v.routing?.changes ?? 0,
    }]));
    city.step();
    for (const car of city.vehicles.values()) {
      const old = before.get(car.id);
      if (!old || (car.routing?.changes ?? 0) === old.changes) continue;
      assert.equal(car.trip, old.trip);
      assert.equal(car.arrival?.accessId, old.target);
      assert.deepEqual(car.route.slice(0, old.index + 1), old.route.slice(0, old.index + 1));
      assert.ok(Math.hypot(car.pose.x - car.previousPose.x, car.pose.z - car.previousPose.z) < 0.2);
      assert.ok(city.time - (changes.get(car.id) ?? -Infinity) >= 45 - 1e-7);
      changes.set(car.id, city.time); turners.add(car.id);
      for (let i = 1; i < car.route.length; i++) assert.notEqual(car.route[i], car.route[i - 1]);
    }
    for (const id of turners) {
      const car = city.vehicles.get(id);
      if (!car) continue;
      for (const other of city.vehicles.values()) if (other.id !== id)
        assert.ok(!overlaps(car.pose, other.pose), `rerouted ${id} overlaps ${other.id} at ${city.time}`);
    }
  }
  t.diagnostic(JSON.stringify({ reroutedVehicles: [...changes.keys()] }));
  assert.ok(changes.size >= 1, "a blocked vehicle must actually take a new route");
  assert.ok(city.completed.some(v => turners.has(v.id)), "rerouted trips still finish");
});

test("v5 traffic resumes in place, then detours; cached and portable futures agree exactly", async () => {
  const old = new LiveCitySimulation(2404, 0, 0, 0, Infinity);
  old.runUntil(300); old.apply("signal", "n3-2"); old.apply("patrol", "homes");
  old.runUntil(650); old.observe(); old.notes = "정체가 있는 기존 도시";
  const save = old.save(), cache = captureLiveCheckpoint(old);
  (cache as any).version = "living-state-5";
  delete cache.state.world.trafficRoutingFrom;
  const copy = restoreLiveCheckpoint(cache, save), replay = await restoreLiveCity(save);
  assert.equal(copy.trafficRoutingFrom, 650.1);
  assert.equal(save.trafficRoutingFrom, undefined);
  for (const city of [copy, replay]) {
    assert.deepEqual([...city.vehicles], [...old.vehicles]);
    assert.deepEqual(city.observations, old.observations);
    assert.equal(city.notes, old.notes);
  }
  old.trafficRoutingFrom = 650.1;
  for (let tick = 0; tick < 500; tick++) {
    old.step(); copy.step(); replay.step();
    assert.deepEqual([...copy.vehicles], [...old.vehicles]);
    assert.deepEqual([...replay.vehicles], [...old.vehicles]);
  }
  const restored = restoreLiveCheckpoint(captureLiveCheckpoint(copy), copy.save());
  for (const city of [copy, restored]) city.runUntil(900);
  assert.deepEqual([...restored.vehicles], [...copy.vehicles]);
  assert.deepEqual(restored.news, copy.news);
  for (const trafficRoutingFrom of [-1, 0.05, Infinity, NaN, 900.2])
    assert.throws(() => validateLiveSave({ ...copy.save(), trafficRoutingFrom }));
  assert.throws(() => restoreLiveCheckpoint(captureLiveCheckpoint(copy), { ...copy.save(), trafficRoutingFrom: 0 }));
});

test("hour-long city traffic remains bounded across seeds and policies, and an old gridlock can recover", t => {
  for (const seed of [2404, 2405, 2406]) for (const policy of [false, true]) {
    const city = new LiveCitySimulation(seed, 0, 0, 0, 0, 0, 0, Infinity); // five-minute model
    const original = city.demand.map(v => v.id);
    const periods = [{ stopped: 0, pending: 0 }, { stopped: 0, pending: 0 }];
    let late30Stopped = 0;
    for (let seconds = 1; seconds <= 3600; seconds++) {
      city.runUntil(seconds);
      if (seconds === 300 && policy) { city.apply("signal", "n3-2"); city.apply("patrol", "homes"); }
      const period = periods[seconds <= 1800 ? 0 : 1];
      period.pending += city.pending.length;
      const stopped = [...city.vehicles.values()].filter(v => !city.serviceJourneys.has(v.id) &&
        !v.departure && v.arrival?.progress !== 1 && v.pose.x < 108 && v.speed < 0.5).length;
      period.stopped += stopped;
      if (seconds > 900 && seconds <= 1800) late30Stopped += stopped;
      const active = [...city.vehicles.values()].filter(v => !city.serviceJourneys.has(v.id)).length;
      assert.equal(city.completed.length + active + city.pending.length + city.demand.length - city.releasedCount,
        (Math.floor(seconds / 300) + 1) * 90);
    }
    const mean = periods.map(p => ({ stopped: +(p.stopped / 1800).toFixed(2), pending: +(p.pending / 1800).toFixed(2) }));
    t.diagnostic(JSON.stringify({ seed, policy, mean, late30Stopped: +(late30Stopped / 900).toFixed(2), completed: city.completed.length }));
    assert.ok(mean[1].stopped < 25);
    assert.ok(mean[1].pending < 10);
    assert.ok(mean[1].stopped < mean[0].stopped + 8);
    assert.ok(original.every(id => city.completed.some(v => v.id === id)));
  }
  const old = new LiveCitySimulation(2404, 0, 0, 0, Infinity);
  old.runUntil(300); old.apply("signal", "n3-2"); old.apply("patrol", "homes");
  old.runUntil(1200);
  const trapped = [...old.vehicles.values()].filter(v => !old.serviceJourneys.has(v.id)).map(v => v.id);
  const cache = captureLiveCheckpoint(old), copy = restoreLiveCheckpoint(cache, old.save());
  assert.deepEqual([...copy.vehicles], [...old.vehicles]);
  copy.runUntil(3600);
  assert.ok(trapped.every(id => copy.completed.some(v => v.id === id)), "existing queued vehicles must escape without deletion");
  assert.ok(copy.pending.length < 10);
  t.diagnostic(JSON.stringify({ resumedAt: 1200, previouslyTrapped: trapped.length, allFinished: true, pending: copy.pending.length }));
});
