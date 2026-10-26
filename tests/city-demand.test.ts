import test from "node:test";
import assert from "node:assert/strict";
import { createCityDemand } from "../src/simulation/city-demand";
import { createDemand, createNetwork, SCHOOL_NODE } from "../src/scenario";
import { RIVER, boundaryNode } from "../src/city/world";
import { findRoute } from "../src/simulation/network";
import { LiveCitySimulation, prepareLiveSave, restoreLiveCity, validateLiveSave } from "../src/simulation/live";
import { captureLiveCheckpoint, restoreLiveCheckpoint } from "../src/simulation/checkpoint";
import type { Trip } from "../src/types";

test("city traffic covers local activity on both banks, bridges and all four gateways", () => {
  const network = createNetwork();
  for (const seed of [2404, 2405, 2406]) {
    const demand = createCityDemand(seed);
    assert.deepEqual(demand, createCityDemand(seed));
    assert.equal(demand.length, 90);
    assert.equal(new Set(demand.map(t => t.id)).size, 90);
    assert.equal(demand.filter(t => t.destination === SCHOOL_NODE).length, 5);
    assert.equal(demand.filter(t => t.origin === SCHOOL_NODE).length, 5);
    assert.equal(demand.filter(t => t.id % 18 >= 12 && t.id % 18 < 16).length, 20);
    for (const side of ["west", "east"] as const) for (const row of [0, 1] as const) {
      assert.ok(demand.some(t => t.origin === boundaryNode(side, row)));
      assert.ok(demand.some(t => t.destination === boundaryNode(side, row)));
    }
    const bridges = new Set<number>();
    for (const trip of demand) {
      assert.ok(trip.departAt >= 5 && trip.departAt < 300);
      assert.notEqual(trip.origin, trip.destination);
      const route = findRoute(network, trip.origin, trip.destination);
      assert.ok(route.length > 0);
      for (const id of route) {
        const road = network.roads.get(id)!;
        const a = network.nodes.get(road.startNodeId)!.position;
        const b = network.nodes.get(road.endNodeId)!.position;
        if ((a.x - RIVER.x) * (b.x - RIVER.x) < 0) bridges.add(a.z);
      }
    }
    assert.deepEqual([...bridges].sort((a,b) => a-b), [-48, 96, 240]);
  }
  assert.equal(createDemand().filter(t => t.purpose === "school").length, 70,
    "the separate school experiment retains its original comparison cohort");
});

test("production adds only industrial journeys and leaves every base journey unchanged", () => {
  const network = createNetwork();
  const base = createCityDemand(2405), more = createCityDemand(2405, true);
  assert.deepEqual(more.filter(t => t.id < 90), base);
  const extra = more.filter(t => t.id >= 90);
  assert.equal(extra.length, 20);
  for (const t of extra) {
    const factory = network.nodes.get(t.id % 2 === 0 ? t.destination : t.origin)!.position;
    assert.ok(factory.x > 132 && factory.z >= 48);
    assert.ok(findRoute(network, t.origin, t.destination).length);
    assert.notEqual(t.purpose, "school");
  }
  const city = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, Infinity); // five-minute model
  city.apply("production", "factory");
  city.runUntil(300);
  assert.equal(city.demand.length, 110);
  // A new city has the east-bank rush; only departure times differ from `more`.
  assert.deepEqual(city.demand.map(t => ({...t, id: t.id - 1001000, departAt: +(t.departAt - 300).toFixed(1)})),
    createCityDemand(2405, true, true));
});

test("recurring vehicles really travel on both banks and all bridges, with no dropped trips", () => {
  const city = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, Infinity); // five-minute model
  const trips = new Map<number, Trip>();
  const bridges = new Map([-48, 96, 240].map(z => [z, new Set<number>()]));
  let west = 0, east = 0;
  for (let time = 0; time <= 900; time++) {
    city.runUntil(time);
    for (const trip of city.demand) trips.set(trip.id, trip);
    for (const v of city.vehicles.values()) {
      if (city.serviceJourneys.has(v.id)) continue;
      if (v.pose.x < 108) west++;
      else if (v.pose.x > 132) east++;
      else for (const [z, crossed] of bridges) if (Math.abs(v.pose.z - z) < 5) crossed.add(v.id);
    }
  }
  assert.ok(east / (west + east) > 0.2, "east-bank activity persists between departure waves");
  assert.ok(west / 900 < 50, "west-bank traffic no longer grows like the school-heavy baseline");
  for (const crossed of bridges.values()) assert.ok(crossed.size >= 5);
  const localEast = city.completed.filter(done => {
    const t = trips.get(done.id)!;
    return city.network.nodes.get(t.origin)!.position.x > 132 &&
      city.network.nodes.get(t.destination)!.position.x > 132;
  });
  assert.ok(localEast.length >= 40, "east activity completes real local trips");
  const active = [...city.vehicles.values()].filter(v => !city.serviceJourneys.has(v.id));
  assert.equal(city.completed.length + active.length + city.pending.length +
    city.demand.length - city.releasedCount, trips.size);
  assert.equal(trips.size, 360);
  assert.equal(city.stats.unreachable, 0);
});

test("legacy JSON and v2 checkpoints preserve the city and switch only at the next cycle", async () => {
  const old = new LiveCitySimulation(2404, Infinity, 0, 0, 0, 0, 0, Infinity);
  old.apply("outreach", "river");
  old.runUntil(325.4);
  old.observe();
  old.notes = "기존 조사 기록";
  const save = old.save();
  assert.equal(save.cityTrafficFrom, undefined);
  const checkpoint = captureLiveCheckpoint(old);
  (checkpoint as any).version = "living-state-2";
  delete checkpoint.state.world.cityTrafficFrom;
  const copy = restoreLiveCheckpoint(checkpoint, save);
  assert.equal(copy.cityTrafficFrom, 600);
  assert.deepEqual([...copy.vehicles], [...old.vehicles]);
  assert.deepEqual(copy.demand, old.demand);
  assert.deepEqual(copy.news, old.news);
  // A legacy save has no daily cycle either; both start on the same boundary.
  assert.deepEqual(copy.save(), {...save, cityTrafficFrom: 600, dailyCycleFrom: 600});
  const replayed = await restoreLiveCity(save);
  assert.deepEqual([...copy.vehicles], [...replayed.vehicles]);
  assert.deepEqual(copy.news, replayed.news);
  old.cityTrafficFrom = 600;
  old.dailyCycleFrom = 600;
  for (const city of [old, copy, replayed]) city.runUntil(650);
  assert.deepEqual([...copy.vehicles], [...old.vehicles]);
  assert.deepEqual([...copy.vehicles], [...replayed.vehicles]);
  assert.deepEqual(copy.demand, old.demand);
  assert.equal(copy.clock?.hour, 7, "the day starts at 07:00 on the switch boundary");
  assert.ok(copy.demand.slice(copy.releasedCount).every(t => t.id >= 5000000),
    "after the switch only hourly departures are scheduled");
  assert.equal(copy.notes, "기존 조사 기록");
  assert.deepEqual(copy.observations, save.observations);
  assert.equal(save.cityTrafficFrom, undefined, "never mutate imported source data");
  const viaOldCache = await restoreLiveCity(copy.save(), undefined, {
    initialCity: restoreLiveCheckpoint(checkpoint, copy.save()),
  });
  const viaJson = await restoreLiveCity(copy.save());
  for (const restored of [viaOldCache, viaJson]) {
    assert.deepEqual([...restored.vehicles], [...copy.vehicles]);
    assert.deepEqual(restored.news, copy.news);
    assert.deepEqual(restored.save(), copy.save());
  }
});

test("patrol clears its local obstacle without changing demand or clearing other sites", () => {
  // Parking all day (no hourly schedule), so the street has cars to clear.
  const base = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, 0, 300, Infinity),
    policy = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, 0, 300, Infinity);
  base.runUntil(300);
  policy.runUntil(300);
  policy.apply("patrol", "homes");
  let baseIllegal = 0, policyIllegal = 0;
  let otherProblemRemains = false;
  const illegal = (city: LiveCitySimulation) =>
    city.parking.parkingStats.sites.find(s => s.id === "homes")!.illegal;
  for (let time = 301; time <= 900; time++) {
    base.runUntil(time);
    policy.runUntil(time);
    baseIllegal += illegal(base);
    policyIllegal += illegal(policy);
    // Arrival now takes real travel time; observe the period instead of one exact tick.
    otherProblemRemains ||= policy.parking.parkingStats.sites.some(s => s.id !== "homes" && s.illegal > 0);
  }
  assert.ok(policyIllegal < baseIllegal * 0.5);
  const passed = (city: LiveCitySimulation) => city.events.filter(e =>
    e.time > 300 && e.type === "enter" && e.fromLaneId === "n1-1_n1-2:n1-1:0").length;
  assert.ok(passed(policy) > passed(base), "the cleared lane carries real vehicles again");
  // Drivers can already detour around this street; a local patrol does not promise
  // a fixed percentage improvement to every journey in the whole city.
  assert.deepEqual(policy.demand, base.demand, "policy changes road conditions, not trip generation");
  assert.equal(policy.parking.parkingStats.sites.find(s => s.id === "homes")!.illegal, 0);
  assert.ok(otherProblemRemains,
    "a local policy does not magically clear every other problem");
});

test("traffic transition records reject incompatible caches and malformed transition times", () => {
  const city = new LiveCitySimulation(), save = city.save();
  for (const time of [-300, 1, 600, Infinity, NaN])
    assert.throws(() => validateLiveSave({...save, cityTrafficFrom: time}));
  assert.throws(() => restoreLiveCheckpoint(captureLiveCheckpoint(city), {...save, cityTrafficFrom: 300}));
  const old = new LiveCitySimulation(2404, Infinity, 0, 0, 0, 0, 0, Infinity);
  old.runUntil(301);
  assert.throws(() => restoreLiveCheckpoint(captureLiveCheckpoint(old), {...old.save(), cityTrafficFrom: 300}));
  assert.equal(prepareLiveSave({...save, time: 300, cityTrafficFrom: undefined}).cityTrafficFrom, 600);
  assert.equal(prepareLiveSave({...save, time: 0.3, cityTrafficFrom: undefined}).cityTrafficFrom, 300);
});
