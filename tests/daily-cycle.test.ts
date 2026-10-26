import test from "node:test";
import assert from "node:assert/strict";
import {
  dayClock,
  formatClock,
  formatDayClock,
  isNight,
  nextHourAt,
  DAILY_BUDGET,
  DAY_SECONDS,
  HOUR_SECONDS,
} from "../src/simulation/day-clock";
import {
  createHourlyDemand,
  DAILY_PEDESTRIANS,
  DAILY_TRIPS,
  EAST_RUSH_WINDOW,
  HOURLY_PEDESTRIANS,
  HOURLY_TRIPS,
} from "../src/simulation/city-demand";
import {
  LiveCitySimulation,
  STAGGER_TARGET,
  STARTING_BUDGET,
  prepareLiveSave,
  restoreLiveCity,
  validateLiveSave,
} from "../src/simulation/live";
import {
  captureLiveCheckpoint,
  restoreLiveCheckpoint,
} from "../src/simulation/checkpoint";
import { CityTutorial } from "../src/ui/city-tutorial";
import { createNetwork, SCHOOL_NODE } from "../src/scenario";
import { findRoute } from "../src/simulation/network";
import { EAST_SIGNAL_TARGET } from "../src/simulation/responsive-signals";

/** Simulation time of a clock hour on a given day, for a city that started at 07:00. */
const at = (day: number, hour: number, minute = 0) =>
  (day - 1) * DAY_SECONDS + (hour - 7) * HOUR_SECONDS + (minute / 60) * HOUR_SECONDS;

test("the day clock is derived from elapsed time: 07:00 start, hours of 120 s, nights", () => {
  assert.deepEqual(dayClock(0, 0), { day: 1, hour: 7, minute: 0, intoHour: 0, hourIndex: 0 });
  assert.equal(formatDayClock(dayClock(at(1, 8, 10), 0)), "1일차 오전 8:10");
  assert.equal(formatClock(dayClock(at(1, 13, 59), 0)), "오후 1:50", "ten-minute steps");
  assert.equal(formatClock({ hour: 0, minute: 0 }), "오전 12:00");
  assert.equal(formatClock({ hour: 12, minute: 30 }), "오후 12:30");
  const midnight = dayClock(at(2, 0), 0);
  assert.equal(midnight.day, 2);
  assert.equal(midnight.hour, 0);
  assert.equal(dayClock(900 + at(1, 9), 900).hour, 9, "a later switch shifts the clock");
  assert.equal(dayClock(0.1 * 1200, 0).hour, 8, "floating engine ticks land on the hour");
  assert.deepEqual([21, 22, 0, 5, 6].map(isNight), [false, true, true, true, false]);
  assert.equal(nextHourAt(at(1, 8), 0, 7), at(2, 7), "strictly after: the next day");
  assert.equal(nextHourAt(at(1, 6.5 + 24), 0, 7), at(2, 7));
  assert.equal(nextHourAt(at(1, 9, 30), 0, 10), at(1, 10));
});

test("hourly demand keeps the daily average load with morning and evening peaks", () => {
  const active = HOURLY_TRIPS.filter((_, h) => h >= 6 && h < 22);
  assert.equal(active.reduce((n, c) => n + c, 0), DAILY_TRIPS);
  assert.equal(HOURLY_TRIPS.reduce((n, c) => n + c, 0), DAILY_TRIPS + 12);
  assert.equal(Math.max(...HOURLY_TRIPS.slice(6, 12)), HOURLY_TRIPS[8], "the morning peak is at 08:00");
  assert.ok(HOURLY_TRIPS[8] > HOURLY_TRIPS[13] * 2);
  assert.ok(HOURLY_TRIPS[18] > HOURLY_TRIPS[13] * 2, "the evening commute is a peak too");
  assert.equal(HOURLY_PEDESTRIANS.reduce((n, c) => n + c, 0), DAILY_PEDESTRIANS);
  assert.ok(HOURLY_PEDESTRIANS.every((n, h) => !isNight(h) || n === 0), "nobody crosses at night");
  const network = createNetwork();
  for (const hour of [3, 7, 8, 12, 15, 18, 20]) {
    const trips = createHourlyDemand(2404 + hour, hour);
    assert.deepEqual(trips, createHourlyDemand(2404 + hour, hour));
    assert.equal(trips.length, HOURLY_TRIPS[hour]);
    assert.equal(new Set(trips.map((t) => t.id)).size, trips.length);
    for (const t of trips) {
      assert.ok(t.departAt >= 0 && t.departAt < HOUR_SECONDS);
      assert.notEqual(t.origin, t.destination);
      assert.ok(findRoute(network, t.origin, t.destination).length > 0);
    }
  }
  assert.ok(createHourlyDemand(1, 8).filter((t) => t.destination === SCHOOL_NODE).length >= 5);
  assert.ok(createHourlyDemand(1, 15).some((t) => t.origin === SCHOOL_NODE && t.purpose === "home"));
  assert.ok(createHourlyDemand(1, 18).filter((t) => t.purpose === "home").length >
    createHourlyDemand(1, 18).length / 2, "evenings head home");
  // The rush crowds morning commutes into the start of the hour, with the same draws.
  const plain = createHourlyDemand(5, 8), rush = createHourlyDemand(5, 8, false, true);
  assert.equal(rush.length, plain.length);
  const crowded = rush.filter((t) => t.departAt <= EAST_RUSH_WINDOW + 3).length;
  assert.ok(crowded > plain.filter((t) => t.departAt <= EAST_RUSH_WINDOW + 3).length + 10);
  assert.deepEqual(createHourlyDemand(5, 13, false, true), createHourlyDemand(5, 13),
    "no rush outside the morning");
  const more = createHourlyDemand(5, 8, true);
  assert.ok(more.length > plain.length, "production adds commuters in the morning");
  assert.equal(createHourlyDemand(5, 13, true).length, HOURLY_TRIPS[13]);
});

test("a whole day: peaks, a quiet night, one daily budget and every trip accounted for", () => {
  const city = new LiveCitySimulation();
  assert.equal(city.clock?.hour, 7);
  const onRoad = () => [...city.vehicles.values()].filter((v) => !city.serviceJourneys.has(v.id)).length;
  const hourly = new Map<number, number[]>();
  let nightPedestrians = 0;
  const end = DAY_SECONDS + 4 * HOUR_SECONDS; // until 11:00 on day 2
  for (let time = 20; time <= end; time += 20) {
    city.runUntil(time);
    const { day, hour } = city.clock!;
    if (day === 1 || hour < 7) hourly.set(hour, [...(hourly.get(hour) ?? []), onRoad()]);
    if (hour >= 1 && hour < 5) nightPedestrians += city.pedestrians.active.size;
    if (Math.abs(time - (at(2, 6) - 20)) < 1e-6) assert.equal(city.budget, STARTING_BUDGET);
    if (Math.abs(time - (at(2, 6) + 20)) < 1e-6) assert.equal(city.budget, STARTING_BUDGET + DAILY_BUDGET);
  }
  const mean = (h: number) => hourly.get(h)!.reduce((n, v) => n + v, 0) / hourly.get(h)!.length;
  const morning = Math.max(mean(8), mean(9));
  assert.ok(morning > mean(13) * 2, `morning peak ${morning} vs midday ${mean(13)}`);
  assert.ok(morning < 90, `the calibrated morning peak stays below 90 cars: ${morning}`);
  assert.ok(mean(18) > mean(13) * 1.5, `evening peak ${mean(18)} vs midday ${mean(13)}`);
  assert.ok(mean(2) < 3, `quiet night ${mean(2)}`);
  assert.equal(nightPedestrians, 0);
  assert.equal(city.budget, STARTING_BUDGET + DAILY_BUDGET, "the budget arrives once a day");
  // Hours scheduled: 07:00 of day 1 through 11:00 of day 2.
  let expected = 0;
  for (let i = 0; i <= Math.floor(end / HOUR_SECONDS); i++) expected += HOURLY_TRIPS[(7 + i) % 24];
  assert.ok(city.completed.length < 1500, "no trimmed history in this window");
  assert.equal(city.completed.length + onRoad() + city.pending.length +
    city.demand.length - city.releasedCount, expected);
  assert.equal(city.stats.unreachable, 0);
  assert.ok(city.pending.length < 10);
});

// Controlled observations exercise the commute issue lifecycle (see live-change-messages).
function commuteFixture() {
  const city = new LiveCitySimulation();
  const state = { time: 20, stopped: 0 };
  const traffic = city.stats,
    parking = city.parking.parkingStats;
  const schoolRoad = city.network.nodes.get(SCHOOL_NODE)!.connectedRoadIds[0];
  Object.defineProperty(city, "time", { get: () => state.time });
  Object.defineProperty(city, "stats", {
    get: () => ({
      ...traffic,
      stopped: state.stopped,
      roads: traffic.roads.map((r) => ({ ...r, stopped: r.id === schoolRoad ? state.stopped : 0 })),
    }),
  });
  Object.defineProperty(city.parking, "parkingStats", {
    get: () => ({ ...parking, illegal: 0, sites: parking.sites.map((s) => ({ ...s, illegal: 0 })) }),
  });
  for (const site of city.sites) site.remaining = 0;
  city.water.packets.length = 0;
  for (const shop of city.logistics.shops) shop.stock = 10;
  for (const place of city.facilities.access) place.unserved = 0;
  const detect = (time: number, stopped: number) => {
    state.time = time;
    state.stopped = stopped;
    (city as unknown as { detectIssues(): void }).detectIssues();
  };
  return { city, state, detect };
}
const trafficNews = (city: LiveCitySimulation, type: string) =>
  city.news.filter((n) => n.type === type && n.title.startsWith("막히는 등굣길"));

test("commute congestion is heard during the commute and judged better only after a whole low commute", () => {
  const { city, detect } = commuteFixture();
  // Commute levels are the mean of the three highest checks so far (announce ≥ 32, better ≤ 29).
  detect(at(1, 8), 40);
  detect(at(1, 8, 20), 40);
  assert.equal(trafficNews(city, "problem").length, 1);
  assert.match(trafficNews(city, "problem")[0].evidence!, /1일차 오전 8:20/);
  assert.match(trafficNews(city, "problem")[0].evidence!, /출근 시간 중 많던 때\) 40\.0/);
  assert.ok(city.isCommuteIssue(trafficNews(city, "problem")[0]));
  detect(at(1, 9), 0);
  assert.equal(trafficNews(city, "improved").length, 0, "a lull inside the commute is not a fix");
  detect(at(1, 9, 40), 40);
  detect(at(1, 10), 0);
  assert.equal(trafficNews(city, "improved").length, 0, "the commute simply ended; it was congested");
  detect(at(1, 13), 0);
  assert.equal(trafficNews(city, "improved").length, 0);
  for (const minute of [10, 30, 50]) detect(at(2, 8, minute), 25);
  detect(at(2, 10), 25);
  const improved = trafficNews(city, "improved");
  assert.equal(improved.length, 1, "a whole quiet commute the next day");
  assert.match(improved[0].evidence!, /2일차 오전 10:00/);
  assert.match(improved[0].evidence!, /출근 시간\(7~10시\)/);
  detect(at(2, 17), 50);
  detect(at(2, 17, 40), 50);
  assert.equal(trafficNews(city, "problem").length, 1, "outside the commute window it is not this problem");
});

test("commute problems go ahead of older problems, which can wait until after the commute", () => {
  const { city, detect } = commuteFixture();
  city.sites.find((s) => !s.kind)!.remaining = 60;
  // Both have waited long enough when the first problem can be announced.
  detect(at(1, 7, 10), 40);
  detect(at(1, 8), 40);
  assert.equal(city.news.filter((n) => n.type === "problem")[0].title, "막히는 등굣길");
});

test("commute policies are compared with the next whole commute after they take effect", () => {
  const city = new LiveCitySimulation();
  city.runUntil(at(1, 8));
  city.apply("signal", SCHOOL_NODE);
  city.apply("stagger", STAGGER_TARGET);
  city.apply("patrol", "school");
  assert.equal(city.effectReadyAt(city.actions[1]), at(1, 9), "the next morning hour");
  assert.equal(city.reactionAt(0), at(2, 10));
  assert.equal(city.reactionAt(1), at(2, 10));
  assert.equal(city.reactionAt(2), at(1, 8) + 120, "other policies keep the two-minute reaction");
  city.runUntil(at(1, 10));
  city.apply("signal", EAST_SIGNAL_TARGET);
  assert.equal(city.reactionAt(3), at(2, 10));
  city.runUntil(at(2, 10) + 1);
  const reactions = city.news.filter((n) => n.type === "reaction");
  assert.equal(reactions.length, 4);
  const signal = reactions.find((r) => r.title.startsWith("초록불"))!;
  assert.match(signal.evidence!, /시행 전 출근 시간 [\d.]+ → 효과가 시작된 뒤 출근 시간 [\d.]+/);
  const late = new LiveCitySimulation();
  late.runUntil(at(1, 11));
  late.apply("stagger", STAGGER_TARGET);
  assert.equal(late.effectReadyAt(late.actions[0]), at(2, 6));
});

test("a city saved mid-day restores the same clock and future from JSON and from its cache", async () => {
  const city = new LiveCitySimulation();
  city.runUntil(at(1, 9));
  city.apply("signal", SCHOOL_NODE);
  city.runUntil(1000.3);
  city.observe();
  const save = JSON.parse(JSON.stringify(city.save()));
  assert.equal(save.dailyCycleFrom, 0);
  const cached = restoreLiveCheckpoint(captureLiveCheckpoint(city), save);
  const replayed = await restoreLiveCity(save);
  for (const copy of [cached, replayed]) {
    assert.deepEqual(copy.clock, city.clock);
    assert.deepEqual([...copy.vehicles], [...city.vehicles]);
    assert.deepEqual(copy.news, city.news);
  }
  for (const c of [city, cached, replayed]) c.runUntil(1400);
  assert.deepEqual([...cached.vehicles], [...city.vehicles]);
  assert.deepEqual([...replayed.vehicles], [...city.vehicles]);
  assert.deepEqual(replayed.save(), city.save());
  for (const dailyCycleFrom of [-300, 1, 150.5, 1500, Infinity, NaN])
    assert.throws(() => validateLiveSave({ ...save, dailyCycleFrom }), String(dailyCycleFrom));
});

test("an older city replays unchanged and starts its day at 07:00 on the next five-minute boundary", async () => {
  const old = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, Infinity, 100);
  old.apply("patrol", "school");
  old.runUntil(412.3);
  const save = old.save();
  assert.equal(save.dailyCycleFrom, undefined);
  assert.equal(prepareLiveSave(save).dailyCycleFrom, 600);
  const checkpoint = captureLiveCheckpoint(old);
  (checkpoint as { version: string }).version = "living-state-9";
  for (const key of ["dailyCycleFrom", "commuteSamples", "commutePeaks"])
    delete checkpoint.state.world[key];
  const copy = restoreLiveCheckpoint(checkpoint, save);
  const replayed = await restoreLiveCity(save);
  for (const city of [copy, replayed]) {
    assert.equal(city.dailyCycleFrom, 600);
    assert.equal(city.clock, undefined, "no clock before the switch");
    assert.deepEqual([...city.vehicles], [...old.vehicles]);
    assert.deepEqual(city.news, old.news);
  }
  for (const city of [copy, replayed]) city.runUntil(900);
  assert.deepEqual([...copy.vehicles], [...replayed.vehicles]);
  assert.deepEqual(copy.save(), replayed.save());
  assert.equal(copy.clock?.hour, 9);
  assert.equal(copy.clock?.minute, 30);
  assert.equal(copy.budget, 100 - 30 + 20, "the five-minute grant stops at the switch");
  assert.ok(copy.timeLabel(300).endsWith("초"));
  assert.equal(copy.timeLabel(600), "1일차 오전 7:00");
  assert.equal(captureLiveCheckpoint(copy).version, "living-state-11");
});

test("the first lesson prefers a problem that shows a result soon, and waits for a commute result", () => {
  const { city, state, detect } = commuteFixture();
  detect(at(1, 8), 40);
  detect(at(1, 8, 20), 40);
  const tutorial = new CityTutorial();
  tutorial.start();
  tutorial.advance(city, 12);
  assert.equal(tutorial.stage, "observe", "a commute problem is not the first example at once");
  tutorial.advance(city, 30);
  assert.equal(tutorial.stage, "spotlight", "but it is used if nothing else appears");
  tutorial.advance(city, 4);
  tutorial.policiesOpened();
  city.apply("signal", SCHOOL_NODE);
  tutorial.policyApplied(city);
  state.time = at(1, 8, 20) + 120;
  tutorial.advance(city, 1);
  assert.equal(tutorial.stage, "watch", "two minutes are not a commute");
  state.time = at(2, 10);
  tutorial.advance(city, 1);
  assert.equal(tutorial.stage, "result");
});
