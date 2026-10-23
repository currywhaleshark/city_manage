import test from "node:test";
import assert from "node:assert/strict";
import {
  LiveCitySimulation,
  EAST_WASTE_SITE,
  EAST_SHOP_SITE,
  STAGGER_TARGET,
  prepareLiveSave,
  restoreLiveCity,
} from "../src/simulation/live";
import { captureLiveCheckpoint, restoreLiveCheckpoint } from "../src/simulation/checkpoint";
import { createCityDemand, EAST_RUSH_WINDOW } from "../src/simulation/city-demand";
import {
  EAST_SIGNAL_NODES,
  EAST_SIGNAL_TARGET,
  RESPONSIVE_SIGNAL_NODES,
} from "../src/simulation/responsive-signals";
import { citySatisfaction } from "../src/simulation/satisfaction";
import { policyAvailability } from "../src/ui/live-policies";
import { createNetwork } from "../src/scenario";
import { LogisticsSimulation } from "../src/simulation/economy";

const eastNode = (id: string) => Number(/^n(\d+)-/.exec(id)?.[1] ?? -1) >= 5 ||
  id.startsWith("boundary-east");

test("rush hour crowds commutes across the river; staggering only restores their departure times", () => {
  const plain = createCityDemand(2405), rush = createCityDemand(2405, false, true);
  assert.equal(rush.length, plain.length);
  const byId = new Map(plain.map((t) => [t.id, t]));
  let crowded = 0;
  for (const t of rush) {
    const base = byId.get(t.id)!;
    assert.deepEqual({ ...t, departAt: 0 }, { ...base, departAt: 0 }, "same trips and draws");
    if (t.departAt !== base.departAt) {
      crowded++;
      assert.equal(t.purpose, "work");
      assert.ok(eastNode(t.destination));
      assert.ok(t.departAt <= 5 + EAST_RUSH_WINDOW + 3);
    }
  }
  assert.ok(crowded >= 20);

  const city = new LiveCitySimulation();
  city.apply("stagger", STAGGER_TARGET);
  city.runUntil(300);
  assert.equal(city.demand.length, plain.length);
  assert.deepEqual(
    city.demand.map((t) => ({ ...t, id: t.id - 1001000, departAt: +(t.departAt - 300).toFixed(1) })),
    createCityDemand(2405),
  );
});

test("a new city opens the east bank at once: shop collection, market curb and their own alerts", () => {
  const city = new LiveCitySimulation();
  city.runUntil(1);
  const shops = city.sites.find((s) => s.id === EAST_WASTE_SITE.id)!;
  assert.equal(shops.capacity, 40);
  assert.equal(city.trucks.filter((t) => t.itinerary.includes(shops.id)).length, 1);
  assert.ok(city.parking.parkingStats.sites.some((s) => s.id === "east-market"));
  city.runUntil(1500);
  const problems = city.news.filter((n) => n.type === "problem").map((n) => n.title);
  for (const title of ["작업장 배출구 아래", "강너머 상점가 수거장", "강너머 상가 거리"])
    assert.ok(problems.includes(title), `${title} is announced: ${problems.join(", ")}`);
  const east = city.news.filter((n) => n.type === "problem" && n.position!.x >= 128);
  assert.ok(east[0].time <= 400, "the first east story does not wait behind every western one");
  const market = city.parking.episodes.filter((e) => e.request.siteId === "east-market");
  assert.ok(market.length >= 3);
  assert.ok(market.every((e) => e.request.surface === "road"), "no walking route crosses the river");
});

test("an older city replays unchanged and gains the east bank only from its switch time", async () => {
  const old = new LiveCitySimulation(2404, 0, 0, 0, 0, Infinity, Infinity);
  old.apply("patrol", "school");
  old.runUntil(412.3);
  const save = old.save();
  assert.equal(save.eastBankFrom, undefined);
  assert.equal(prepareLiveSave(save).eastBankFrom, 412.4);
  assert.ok(!old.sites.some((s) => s.id === EAST_WASTE_SITE.id));
  assert.ok(!old.parking.episodes.some((e) => e.request.siteId === "east-market"));

  const checkpoint = captureLiveCheckpoint(old);
  (checkpoint as { version: string }).version = "living-state-7";
  delete checkpoint.state.world.eastBankFrom;
  delete checkpoint.state.world.eastShopFrom;
  delete checkpoint.state.world.eastQueue;
  const copy = restoreLiveCheckpoint(checkpoint, save);
  const replayed = await restoreLiveCity(save);
  for (const city of [copy, replayed]) {
    assert.equal(city.eastBankFrom, 412.4);
    assert.deepEqual([...city.vehicles], [...old.vehicles]);
    assert.deepEqual(city.news, old.news);
  }
  for (const city of [copy, replayed]) city.runUntil(900);
  assert.deepEqual([...copy.vehicles], [...replayed.vehicles]);
  assert.deepEqual(copy.save(), replayed.save());
  assert.ok(copy.sites.some((s) => s.id === EAST_WASTE_SITE.id));
  assert.ok(copy.parking.episodes.some((e) => e.request.siteId === "east-market"));
  assert.equal(captureLiveCheckpoint(copy).version, "living-state-9");
});

test("signal timing is chosen once per district and only retimes that district", () => {
  const city = new LiveCitySimulation();
  city.budget = 200;
  city.apply("signal", EAST_SIGNAL_TARGET);
  assert.deepEqual(city.targets("signal").map((t) => t.id), ["n3-2"]);
  assert.ok(policyAvailability(city, "signal").available);
  const west = [...RESPONSIVE_SIGNAL_NODES].map((id) => ({ ...city.network.nodes.get(id)!.signal }));
  city.runUntil(120);
  assert.deepEqual(
    [...RESPONSIVE_SIGNAL_NODES].map((id) => city.network.nodes.get(id)!.signal),
    west,
    "western junctions keep their fixed plan",
  );
  const fixed = createNetwork().nodes;
  assert.ok([...EAST_SIGNAL_NODES].some((id) =>
    city.network.nodes.get(id)!.signal.ns !== fixed.get(id)!.signal.ns ||
    city.network.nodes.get(id)!.signal.offset !== fixed.get(id)!.signal.offset));
  city.apply("signal", "n3-2");
  assert.equal(city.targets("signal").length, 0);
  assert.equal(policyAvailability(city, "signal").label, "시행 중");
  assert.throws(() => city.apply("signal", EAST_SIGNAL_TARGET), /이미 시행 중/);
  assert.equal(city.policyMap.places.filter((p) => p.id.startsWith("live-signal")).length, 2);
});

test("curb policies reach the east market, and lot E takes its long-stay customers", () => {
  const patrol = new LiveCitySimulation();
  patrol.apply("patrol", "east-market");
  const lot = new LiveCitySimulation();
  lot.apply("parkingLot", "market");
  const none = new LiveCitySimulation();
  for (const city of [patrol, lot, none]) city.runUntil(1200);
  const illegal = (city: LiveCitySimulation) =>
    city.parking.episodes
      .filter((e) => e.request.siteId === "east-market" && e.destination === "illegal")
      .reduce((n, e) => n + e.illegalSeconds, 0);
  assert.ok(illegal(patrol) < illegal(none));
  assert.ok(lot.parking.episodes.some((e) => e.request.siteId === "east-market" && e.destination === "lot"));
  assert.ok(illegal(lot) < illegal(none));
  const bay = new LiveCitySimulation();
  bay.apply("loadingBay", "east-market");
  assert.deepEqual(bay.parking.bayPose("east-market"), { x: 204, z: -58, angle: Math.PI / 2 });
});

test("satisfaction reads the east bank's own measurements once it is open", () => {
  const city = new LiveCitySimulation();
  city.runUntil(60);
  const s = citySatisfaction(city);
  assert.deepEqual(
    s.topics.parking.parts.map((p) => p.label),
    ["불법주차한 차", "강 서쪽 길에서 기다리는 차", "강 건너 길에서 기다리는 차"],
  );
  assert.equal(s.topics.parking.parts[2].value, city.eastStopped);
  assert.equal(s.topics.water.parts[0].value, city.water.cells[4].level);
  const old = new LiveCitySimulation(2404, 0, 0, 0, 0, Infinity, Infinity);
  assert.equal(citySatisfaction(old).topics.parking.parts.length, 2);
});

test("the shop across the river opens with the city, receives real deliveries and counts as a shop", () => {
  const lab = new LogisticsSimulation();
  assert.equal(lab.shops.length, 4, "the logistics experiment keeps its four shops");
  const city = new LiveCitySimulation();
  city.runUntil(1);
  const shop = city.logistics.shops.find((s) => s.id === EAST_SHOP_SITE.id)!;
  assert.equal(city.logistics.shops.length, 5);
  const factory = city.logistics.trucks.find((t) => t.sourceId === "factory")!;
  assert.ok(factory.itinerary.includes(shop.id));
  city.runUntil(1800);
  assert.ok(shop.delivered > 0, "the workshop truck drives to it");
  assert.ok(shop.bySource.factory > 0);
  assert.equal(
    city.values.supply,
    city.logistics.shops.filter((s) => s.stock < 3).length,
  );
  assert.equal(citySatisfaction(city).topics.supply.parts[0].bad, 5);
});

test("an older save gains the shop only from its own switch time, cached or replayed", async () => {
  // A save from the first east-bank version: east bank on, no shop yet.
  const old = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, Infinity);
  old.runUntil(512.3);
  const save = old.save();
  assert.equal(save.eastShopFrom, undefined);
  assert.equal(prepareLiveSave(save).eastShopFrom, 512.4);
  assert.equal(old.logistics.shops.length, 4);
  const checkpoint = captureLiveCheckpoint(old);
  (checkpoint as { version: string }).version = "living-state-8";
  delete checkpoint.state.world.eastShopFrom;
  const copy = restoreLiveCheckpoint(checkpoint, save);
  const replayed = await restoreLiveCity(save);
  for (const city of [copy, replayed]) {
    assert.deepEqual([...city.vehicles], [...old.vehicles]);
    assert.equal(city.logistics.shops.length, 4);
  }
  for (const city of [copy, replayed]) city.runUntil(900);
  assert.equal(copy.logistics.shops.length, 5);
  assert.deepEqual(copy.logistics.shops, replayed.logistics.shops);
  assert.deepEqual([...copy.vehicles], [...replayed.vehicles]);
  assert.deepEqual(copy.save(), replayed.save());
});
