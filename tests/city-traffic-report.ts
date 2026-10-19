import { LiveCitySimulation } from "../src/simulation/live";

const seed = Number(process.argv[2] ?? 2404);
for (const mode of ["legacy", "city", "city-policy"] as const) {
  const city = new LiveCitySimulation(seed, mode === "legacy" ? Infinity : 0);
  const samples = [
    { start: 1, end: 900, west: 0, east: 0, river: 0, stopped: 0 },
    { start: 901, end: 1800, west: 0, east: 0, river: 0, stopped: 0 },
  ];
  const bridges = new Map([-48, 96, 240].map(z => [z, new Set<number>()]));
  for (let time = 1; time <= 1800; time++) {
    city.runUntil(time);
    if (time === 300 && mode === "city-policy") {
      city.apply("signal", "n3-2");
      city.apply("patrol", "homes");
    }
    const sample = samples[time <= 900 ? 0 : 1];
    for (const vehicle of city.vehicles.values()) {
      if (city.serviceJourneys.has(vehicle.id)) continue;
      const { x, z } = vehicle.pose;
      sample[x < 108 ? "west" : x > 132 ? "east" : "river"]++;
      if (vehicle.speed < 0.5) sample.stopped++;
      if (x > 108 && x < 132) {
        const bridge = [-48, 96, 240].find(b => Math.abs(b - z) < 5);
        if (bridge !== undefined) bridges.get(bridge)!.add(vehicle.id);
      }
    }
  }
  console.log(JSON.stringify({ mode, seed: city.seed, seconds: city.time,
    samples: samples.map(s => Object.fromEntries(Object.entries(s).map(([k, v]) =>
      [k, k === "start" || k === "end" ? v : +(v / 900).toFixed(2)]))),
    arrived: city.completed.length, queued: city.pending.length,
    bridges: Object.fromEntries([...bridges].map(([z, ids]) => [z, ids.size])),
    unreachable: city.stats.unreachable,
    illegalSeconds: city.parking.parkingStats.illegalSeconds,
    wasteCollected: +city.wasteStats.collected.toFixed(2),
    delivered: +city.logistics.logisticsStats.delivered.toFixed(2),
  }));
}
