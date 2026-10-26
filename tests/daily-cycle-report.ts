import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { LiveCitySimulation } from "../src/simulation/live";
import { DAY_SECONDS, HOUR_SECONDS } from "../src/simulation/day-clock";
import { HOURLY_TRIPS } from "../src/simulation/city-demand";

// Three days of the living city per seed, with no policies, sampled every 10 s.
// See docs/DAILY_CYCLE.md. Vehicle counts exclude collection and delivery trucks.
const DAYS = Number(process.argv[2] ?? 3);
const runs = [];
for (const seed of [2404, 2405, 2406]) {
  const city = new LiveCitySimulation(seed);
  const hours: {
    day: number;
    hour: number;
    scheduled: number;
    arrived: number;
    meanOnRoad: number;
    maxOnRoad: number;
    meanStopped: number;
    meanTravel: number | null;
    pedestrians: number;
    engineMsPerCitySecond: number;
    /** End of the hour: bags at household collection points, sites over capacity, roadside litter. */
    collectionBags: number;
    collectionOverCapacity: number;
    illegalBags: number;
    /** Mean over the hour: shops below 3 boxes, illegally parked cars. */
    lowStockShops: number;
    illegalParking: number;
  }[] = [];
  const commutes: { day: number; traffic?: number; "traffic-east"?: number; "school-signal"?: number }[] = [];
  const seen = new Set<number>();
  // News keeps the latest 120 events, so collect announcements every hour.
  const problems: { when: string; type: string; title: string }[] = [];
  let lastNews = 0;
  for (let h = 0; h < DAYS * 24; h++) {
    const start = city.time;
    const { day, hour } = city.clock!;
    let onRoad = 0, maxOnRoad = 0, stopped = 0, pedestrians = 0, samples = 0, engine = 0,
      lowStock = 0, illegalParking = 0;
    for (let s = 10; s <= HOUR_SECONDS; s += 10) {
      const t0 = performance.now();
      city.runUntil(start + s);
      engine += performance.now() - t0;
      const cars = [...city.vehicles.values()].filter((v) => !city.serviceJourneys.has(v.id)).length;
      onRoad += cars;
      maxOnRoad = Math.max(maxOnRoad, cars);
      stopped += city.stats.stopped;
      pedestrians += city.pedestrians.active.size;
      lowStock += city.logistics.shops.filter((x) => x.stock < 3).length;
      illegalParking += city.parking.parkingStats.illegal;
      samples++;
    }
    // History keeps only the latest 1,500 trips, so count arrivals by id.
    const done = city.completed.filter((r) => !seen.has(r.id));
    for (const r of done) seen.add(r.id);
    hours.push({
      day,
      hour,
      scheduled: HOURLY_TRIPS[hour],
      arrived: done.length,
      meanOnRoad: +(onRoad / samples).toFixed(1),
      maxOnRoad,
      meanStopped: +(stopped / samples).toFixed(1),
      meanTravel: done.length
        ? Math.round(done.reduce((n, r) => n + r.travelTime, 0) / done.length)
        : null,
      pedestrians: +(pedestrians / samples).toFixed(1),
      engineMsPerCitySecond: +(engine / HOUR_SECONDS).toFixed(2),
      collectionBags: +city.sites.filter((x) => !x.kind).reduce((n, x) => n + x.remaining, 0).toFixed(1),
      collectionOverCapacity: city.sites.filter((x) => !x.kind && x.remaining > (x.capacity ?? Infinity)).length,
      illegalBags: +city.dumpingStats.illegalRemaining.toFixed(1),
      lowStockShops: +(lowStock / samples).toFixed(2),
      illegalParking: +(illegalParking / samples).toFixed(2),
    });
    if (city.clock!.hour === 10) commutes.push({ day, ...city.lastCommute });
    for (const n of city.news)
      if (n.id > lastNews && (n.type === "problem" || n.type === "improved"))
        problems.push({ when: city.timeLabel(n.time), type: n.type, title: n.title });
    lastNews = Math.max(lastNews, ...city.news.map((n) => n.id));
  }
  assert.equal(city.stats.unreachable, 0);
  const peak = hours.reduce((a, b) => (b.meanOnRoad > a.meanOnRoad ? b : a));
  runs.push({
    seed,
    days: DAYS,
    seconds: city.time,
    budget: city.budget,
    unreachable: city.stats.unreachable,
    pendingAtEnd: city.pending.length,
    peakHour: { day: peak.day, hour: peak.hour, meanOnRoad: peak.meanOnRoad, maxOnRoad: Math.max(...hours.map((h) => h.maxOnRoad)) },
    commutes,
    problems,
    hours,
  });
  console.log(JSON.stringify({ seed, peak: runs.at(-1)!.peakHour, commutes, pending: city.pending.length }));
}
assert.equal(HOURLY_TRIPS.length, 24);
await mkdir("output", { recursive: true });
await writeFile(
  "output/daily-cycle-experiments.json",
  `${JSON.stringify({ generatedAt: new Date().toISOString(), daySeconds: DAY_SECONDS, hourSeconds: HOUR_SECONDS, hourlyTrips: HOURLY_TRIPS, runs }, null, 2)}\n`,
);
console.log("output/daily-cycle-experiments.json");
