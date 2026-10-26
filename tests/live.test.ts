import test from "node:test";
import assert from "node:assert/strict";
import {
  LiveCitySimulation,
  restoreLiveCity,
  validateLiveSave,
  CITY_PACING,
} from "../src/simulation/live";
import { ParkingSimulation } from "../src/simulation/parking";
import { TrafficSimulation } from "../src/simulation";
import { DEFAULT_POLICY } from "../src/scenario";

test("a new city gives observation time, then reveals persistent problems and one voice at a time", () => {
  const city = new LiveCitySimulation();
  assert.equal(city.news.length, 0);
  assert.equal(city.voices.length, 0);
  city.runUntil(CITY_PACING.observe - 1);
  assert.equal(city.news.length, 0);
  assert.equal(city.activeIssues.length, 0);
  city.runUntil(CITY_PACING.observe);
  assert.equal(city.news.filter((n) => n.type === "problem").length, 1);
  assert.equal(city.voices.length, 1);
  const first = city.voices[0].id;
  city.runUntil(CITY_PACING.observe + CITY_PACING.speaking);
  assert.equal(city.voices.length, 0, "leave a quiet gap after a story");
  city.runUntil(CITY_PACING.observe + CITY_PACING.interval);
  assert.equal(city.voices.length, 1);
  assert.notEqual(city.voices[0].id, first);
  for (let time = city.time + 1; time <= 440; time++) {
    city.runUntil(time);
    assert.ok(city.voices.length <= 1);
  }
  const problems = city.news.filter((n) => n.type === "problem");
  for (let i = 1; i < problems.length; i++)
    assert.ok(problems[i].time - problems[i - 1].time >= CITY_PACING.interval);
});

test("early improvements are rechecked instead of announcing a stale starting problem", () => {
  const city = new LiveCitySimulation();
  city.apply("patrol", "school");
  city.runUntil(200);
  assert.equal(
    city.parking.parkingStats.sites.find((s) => s.id === "school")!.illegal,
    0,
  );
  assert.ok(
    !city.news.some((n) => n.type === "problem" && n.title === "학교 앞"),
  );
  assert.ok(
    city.news.some((n) => n.type === "reaction"),
    "policy feedback remains in the news record",
  );
});

test("one clock and transport state; applying a policy preserves the living world", () => {
  const s = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, 0, 100); // a city that began at 100
  s.runUntil(25);
  assert.equal(s.parking.vehicles, s.vehicles);
  assert.equal(s.logistics.vehicles, s.vehicles);
  assert.equal(s.water.time, s.time);
  assert.equal(s.parking.pedestrians, s.pedestrians);
  const vehicles = s.vehicles,
    pile = s.illegal("river").remaining,
    time = s.time;
  s.apply("patrol", "homes", "길을 비워 수거차도 지나가게 해요.");
  assert.equal(s.time, time);
  assert.equal(s.vehicles, vehicles);
  assert.equal(s.illegal("river").remaining, pile);
  assert.equal(s.budget, 70);
  s.runUntil(66);
  assert.equal(s.time, 66);
  assert.equal(
    s.parking.parkingStats.sites.find((p) => p.id === "homes")!.illegal,
    0,
  );
  s.runUntil(150);
  assert.ok(s.news.some((n) => n.type === "reaction"));
});

test("shared parked cars obstruct service traffic, with no hidden second traffic step", () => {
  const host = new TrafficSimulation(DEFAULT_POLICY, []),
    parking = new ParkingSimulation(2404, [], undefined, [], [], host);
  const time = host.time;
  parking.step();
  assert.equal(host.time, time);
  assert.equal(host.vehicles.size, 3);
  const road = host.vehicles.get(30000)!;
  assert.equal(host.serviceJourneys.get(road.id)!.arrived, true);
  host.step();
  assert.equal(host.time, 0.1);
  assert.equal(road.speed, 0);
  assert.throws(() => parking.runUntil(5));
  const clear = new TrafficSimulation(DEFAULT_POLICY, []);
  for (const world of [host, clear])
    world.dispatchService(90000, "n2-2", "n2-2_n3-2:n2-2:0");
  host.runUntil(25);
  clear.runUntil(25);
  assert.equal(clear.serviceJourneys.get(90000)!.arrived, true);
  assert.equal(host.serviceJourneys.get(90000)!.arrived, false);
  assert.ok(host.vehicles.get(90000)!.waitingTime > 0);
});

test("real dumping litter transfers into the river with conservation; new waves and collections continue after 15 minutes", () => {
  const s = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, Infinity, 100); // five-minute model, began at 100
  s.runUntil(1250);
  assert.ok(s.transferredToRiver > 0);
  const w = s.wasteStats,
    r = s.water.waterStats;
  assert.ok(
    Math.abs(
      w.initial +
        w.generated -
        w.remaining -
        w.collected -
        s.transferredToRiver,
    ) < 1e-7,
  );
  assert.ok(
    Math.abs(
      r.litterInitial +
        r.externalLitter -
        r.litterRemaining -
        r.litterCollected -
        r.litterOutflow -
        s.removedFromBoom,
    ) < 1e-7,
  );
  assert.ok(s.disposalEvents.some((e) => e.time > 900));
  assert.ok(s.parking.episodes.some((e) => e.request.id > 300000));
  assert.ok(s.demand.some((t) => t.departAt > 1200));
  assert.ok(s.trucks.every((t) => t.phase !== "finished"));
  assert.equal(s.budget, 180);
});

test("production has real benefits and wastewater costs, and parcel/budget validation is atomic", () => {
  const base = new LiveCitySimulation(),
    more = new LiveCitySimulation();
  more.apply("production", "factory");
  base.runUntil(180);
  more.runUntil(180);
  assert.ok(
    more.logistics.sources.find((s) => s.id === "factory")!.generated >
      base.logistics.sources.find((s) => s.id === "factory")!.generated,
  );
  assert.ok(more.water.waterStats.generated > base.water.waterStats.generated);
  const s = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, 0, 100); // a city that began at 100
  s.apply("parkingLot", "riverside");
  const budget = s.budget;
  assert.throws(() => s.apply("park", "riverside"));
  assert.equal(s.budget, budget);
  assert.equal(s.actions.length, 1);
  assert.throws(() => s.apply("sewer", "south"));
  assert.equal(s.budget, budget);
  s.apply("park", "north");
  assert.equal(s.facilities.plan.buildings!.length, 1);
  assert.equal(s.parcels.length, 2);
  const signal = new LiveCitySimulation();
  signal.runUntil(5);
  const previousSignal = { ...signal.network.nodes.get("n3-2")!.signal };
  signal.apply("signal", "n3-2");
  assert.equal(signal.time, 5);
  assert.deepEqual(signal.network.nodes.get("n3-2")!.signal, previousSignal,
    "a new signal policy waits for the existing cycle to finish");
});

test("saved continuous cities replay actions at their original time and reject malformed records", async () => {
  const s = new LiveCitySimulation();
  s.runUntil(20);
  s.apply("outlet", "factoryNorth");
  s.runUntil(100);
  s.apply("outreach", "river");
  s.runUntil(220);
  s.observe();
  s.notes = "물이 흐르는 방향도 함께 조사해요.";
  const restored = await restoreLiveCity(s.save());
  assert.deepEqual(restored.values, s.values);
  assert.deepEqual(restored.actions, s.actions);
  assert.equal(restored.budget, s.budget);
  assert.equal(restored.notes, s.notes);
  assert.deepEqual(restored.news, s.news);
  assert.throws(() => validateLiveSave({ ...s.save(), time: Infinity }));
  assert.throws(() =>
    validateLiveSave({
      ...s.save(),
      actions: [{ time: -1, id: "reduce", target: "", reason: "" }],
    }),
  );
});

test("policy markers disambiguate a parking location from a same-named vacant plot", () => {
  const s = new LiveCitySimulation();
  s.apply("loadingBay", "market");
  assert.deepEqual(s.policyMap.places[0].position, { x: 52, z: -33 });
  const route = s.trucks.find((t) => t.itinerary.includes("illegal-river"))!;
  s.apply("cleanup", "river");
  s.apply("cleanup", "river");
  assert.equal(
    route.itinerary.filter((id) => id === "illegal-river").length,
    1,
  );
});
