import test from "node:test";
import assert from "node:assert/strict";
import {
  LiveCitySimulation,
  prepareLiveSave,
  restoreLiveCity,
  validateLiveSave,
} from "../src/simulation/live";
import { captureLiveCheckpoint, restoreLiveCheckpoint } from "../src/simulation/checkpoint";
import {
  SALES_BY_HOUR,
  WASTE_BY_HOUR,
  parkingOpen,
} from "../src/simulation/daily-profiles";
import { DAY_SECONDS, HOUR_SECONDS } from "../src/simulation/day-clock";
import { LogisticsSimulation } from "../src/simulation/economy";
import { SatisfactionTracker } from "../src/ui/satisfaction";

/** Simulation time of a clock hour (new cities start at 07:00). */
const at = (day: number, hour: number) => (day - 1) * DAY_SECONDS + (hour - 7) * HOUR_SECONDS;

test("profiles: quiet nights, shops closed 22–08, parking only in each site's busy hours", () => {
  for (const h of [0, 3, 5]) {
    assert.ok(WASTE_BY_HOUR[h] <= 0.1, `little waste at ${h}`);
    assert.equal(SALES_BY_HOUR[h], 0, `shops closed at ${h}`);
  }
  assert.ok(WASTE_BY_HOUR[19] > WASTE_BY_HOUR[12], "more rubbish in the evening");
  assert.ok(SALES_BY_HOUR[18] > SALES_BY_HOUR[12], "busiest after work");
  assert.equal(parkingOpen("school", 8), true);
  assert.equal(parkingOpen("school", 12), false);
  assert.equal(parkingOpen("market", 3), false);
  assert.equal(parkingOpen("homes", 20), true);
});

test("two days of the living city: nights pause waste, sales, rubbish and parking; shops are judged by day", () => {
  const city = new LiveCitySimulation();
  const tracker = new SatisfactionTracker();
  const generated = () => city.sites.filter((s) => !s.kind).reduce((n, s) => n + s.generated, 0);
  const sold = () => city.logistics.shops.reduce((n, s) => n + s.sold, 0);
  const requests = () => city.parking.episodes.length;
  const day: number[] = [], night: number[] = [];
  let nightSold = 0, nightParking = 0, nightDisposals = 0;
  for (let time = 10; time <= at(3, 8); time += 10) {
    const g = generated(), s = sold(), r = requests(), d = city.disposalEvents.length;
    city.runUntil(time);
    tracker.update(city);
    const hour = city.clock!.hour;
    if (hour >= 1 && hour < 5) {
      night.push(generated() - g);
      nightSold += sold() - s;
      nightParking += requests() - r;
      nightDisposals += city.disposalEvents.length - d;
    } else if (hour >= 10 && hour < 17) day.push(generated() - g);
  }
  const mean = (a: number[]) => a.reduce((n, v) => n + v, 0) / a.length;
  assert.ok(mean(night) < mean(day) * 0.2, `night waste ${mean(night)} vs day ${mean(day)}`);
  assert.equal(nightSold, 0, "closed shops sell nothing");
  assert.equal(nightParking, 0, "nobody arrives to park in the small hours");
  assert.equal(nightDisposals, 0, "nobody carries rubbish out at night");
  // Closed shops refill overnight; that is not called an improvement.
  const shopNews = city.news.filter((n) => n.title.startsWith("동네 상점"));
  assert.equal(shopNews.filter((n) => n.type === "problem").length, 1);
  for (const n of shopNews.filter((n) => n.type === "improved"))
    assert.match(n.evidence!, /오후 10:00/, "improvements are judged when the trading day ends");
  const sites = city.sites.filter((s) => !s.kind);
  assert.ok(sites.reduce((n, s) => n + s.remaining, 0) < 400, "collection keeps up over two days");
  assert.equal(tracker.trendLabel, "어제 이 시각", "arrows compare with the same time yesterday");
});

test("an extra delivery truck carries from the fullest supplier and parks when withdrawn", () => {
  const city = new LiveCitySimulation();
  city.runUntil(at(1, 9));
  city.apply("deliveryTruck");
  const truck = city.logistics.trucks[city.logistics.trucks.length - 1];
  assert.equal(truck.name, "3호 화물차");
  assert.equal(truck.itinerary.length, city.logistics.shops.length);
  assert.throws(() => city.apply("deliveryTruck"), /이미 시행/);
  city.runUntil(at(1, 14));
  assert.ok(truck.delivered > 0, "it really delivers");
  city.withdraw(city.actions.length - 1);
  city.runUntil(at(1, 18));
  assert.equal(truck.phase, "blocked", "it parks after its last delivery");
  assert.equal(truck.load, 0);
  assert.equal(city.serviceJourneys.has(truck.id), false);
  const lab = new LogisticsSimulation();
  assert.equal(lab.moveOnWhenFull(), false, "the logistics experiment keeps its rules");
  assert.equal(lab.salesFactor(), 1);
});

test("a city saved before phase 1b replays unchanged and starts the schedules where it was loaded", async () => {
  const old = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, 0, 300, Infinity);
  old.runUntil(at(1, 12) + 0.3);
  const save = old.save();
  assert.equal(save.dailyServicesFrom, undefined);
  const switchAt = prepareLiveSave(save).dailyServicesFrom!;
  assert.ok(Math.abs(switchAt - (old.time + 0.1)) < 0.06);
  const checkpoint = captureLiveCheckpoint(old);
  (checkpoint as { version: string }).version = "living-state-11";
  delete checkpoint.state.world.dailyServicesFrom;
  const cached = restoreLiveCheckpoint(checkpoint, save);
  const replayed = await restoreLiveCity(save);
  for (const city of [cached, replayed]) {
    assert.deepEqual([...city.vehicles], [...old.vehicles]);
    assert.equal(city.dailyServicesFrom, switchAt);
  }
  for (const city of [cached, replayed]) city.runUntil(at(1, 15));
  assert.deepEqual([...cached.vehicles], [...replayed.vehicles]);
  assert.deepEqual(cached.save(), replayed.save());
  assert.equal(captureLiveCheckpoint(cached).version, "living-state-12");
  for (const dailyServicesFrom of [-1, 0.05, old.time + 5, NaN])
    assert.throws(() => validateLiveSave({ ...save, dailyServicesFrom }));
});
