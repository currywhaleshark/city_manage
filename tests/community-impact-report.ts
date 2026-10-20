import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { LiveCitySimulation, LIVE_POLICIES } from "../src/simulation/live";
import { communityProject, communityMethod, holdCommunityVote, type CommunityProjectId } from "../src/simulation/community";

// Run: node --import tsx tests/community-impact-report.ts [seed] [topic]
// Independent issue comparisons: only one resident activity is allowed at a time.
// Measure the same post-intervention windows, including preparation and river travel.
const seeds = process.argv[2] ? [Number(process.argv[2])] : [2404, 2405, 2406];
const topic = process.argv[3];
const definitions = [
  { topic: "parking", project: "walking", target: "homes", policy: "patrol", policyTarget: "homes" },
  { topic: "waste", project: "sorting", target: "alley", policy: "dropoff", policyTarget: "alley" },
  { topic: "water", project: "waterCare", target: "homes", policy: "sewer", policyTarget: "riverside" },
  { topic: "traffic", project: "walking", target: "homes", policy: "signal", policyTarget: "n3-2" },
] as const;
assert.ok(!topic || definitions.some(d => d.topic === topic), "known issue");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const output = process.env.CITY_IMPACT_OUTPUT ?? "output/release/community-impact";
await mkdir(output, { recursive: true });
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function snapshot(city: LiveCitySimulation) {
  const parking = city.parking.parkingStats;
  const waste = city.wasteStats;
  const water = city.water.waterStats;
  // Conserved material: participation changes generation or legal disposal,
  // rather than deleting existing waste, pollution, or already parked cars.
  assert.ok(Math.abs(waste.initial + waste.generated - waste.remaining - waste.collected - city.transferredToRiver) < 1e-6);
  assert.ok(Math.abs(water.initial + water.generated - water.treated - water.remaining - water.outflow) < 1e-6);
  return {
    time: city.time,
    localParkingSeconds: parking.sites.find(s => s.id === "homes")!.illegalSeconds,
    allParkingSeconds: parking.illegalSeconds,
    alleyDumped: city.disposalEvents.filter(e => e.source === "alley" && e.kind === "illegal").reduce((n, e) => n + e.amount, 0),
    alleyDisposed: city.disposalEvents.filter(e => e.source === "alley").reduce((n, e) => n + e.amount, 0),
    alleyRemaining: city.illegal("alley").remaining,
    alleyBinRemaining: city.bin("alley").remaining,
    sources: structuredClone(city.water.sources),
    values: city.values,
    allWasteRemaining: waste.remaining,
    normalWasteRemaining: city.dumpingStats.normalRemaining,
    wasteCollected: waste.collected,
    delivered: city.logistics.logisticsStats.delivered,
    arrived: city.completed.length,
    budget: city.budget,
    contributions: city.council.records.map(r => ({
      walkingTrips: r.walkingTrips, guidedBags: r.guidedBags, preventedPollution: r.preventedPollution,
    })),
  };
}
type Snapshot = ReturnType<typeof snapshot>;
function difference(before: Snapshot, after: Snapshot, stopped: number, west: number, pending: number) {
  const duration = after.time - before.time;
  const source = (s: Snapshot) => s.sources.find(v => v.id === "homes")!;
  return {
    start: before.time, end: after.time,
    // Exact simulation-tick accumulator, unlike the earlier 1-second parking sample.
    localParkingSeconds: after.localParkingSeconds - before.localParkingSeconds,
    allParkingSeconds: after.allParkingSeconds - before.allParkingSeconds,
    alleyDumped: after.alleyDumped - before.alleyDumped,
    alleyDisposed: after.alleyDisposed - before.alleyDisposed,
    householdEntered: source(after).entered - source(before).entered,
    householdRaw: source(after).raw - source(before).raw,
    householdTreated: source(after).treated - source(before).treated,
    allEntered: after.sources.reduce((n, s, i) => n + s.entered - before.sources[i].entered, 0),
    meanStopped: stopped / duration,
    meanWestStopped: west / duration,
    meanPending: pending / duration,
    arrived: after.arrived - before.arrived,
    endpoint: after,
  };
}

for (const seed of seeds) {
  assert.ok(Number.isSafeInteger(seed));
  const runs = [];
  const conditions = [
    { id: "none", definition: undefined, participation: false },
    ...definitions.filter(d => !topic || d.topic === topic).flatMap(d => [
      { id: `${d.topic}-policy`, definition: d, participation: false },
      { id: `${d.topic}-community`, definition: d, participation: true },
    ]),
  ];
  for (const condition of conditions) {
    const started = performance.now();
    const city = new LiveCitySimulation(seed);
    const demandHistory = new Map(city.demand.map(t => [t.id, t]));
    city.runUntil(120);
    const before = snapshot(city);
    const d = condition.definition;
    if (d) city.apply(d.policy, d.policyTarget);
    if (d?.topic === "traffic") city.apply("patrol", "homes");
    if (d && condition.participation) {
      const project: CommunityProjectId = d.project;
      city.council.decide(project, d.target, communityProject(project).voices.map(v => v.id),
        holdCommunityVote(seed, project, d.target, city.budget));
    }
    let startFollowup: Snapshot | undefined;
    let primary: ReturnType<typeof difference> | undefined;
    let followup: ReturnType<typeof difference> | undefined;
    const samples = [{ stopped: 0, west: 0, pending: 0 }, { stopped: 0, west: 0, pending: 0 }];
    const timeline = [];
    for (let second = 121; second <= 1500; second++) {
      city.runUntil(second);
      for (const t of city.demand) demandHistory.set(t.id, t);
      const cars = [...city.vehicles.values()].filter(v => !city.serviceJourneys.has(v.id));
      assert.equal(city.completed.length + cars.length + city.pending.length + city.demand.length - city.releasedCount,
        (Math.floor(second / 300) + 1) * 90, "ordinary travel demand is conserved");
      const sample = second <= 720 ? samples[0] : second > 900 ? samples[1] : undefined;
      if (sample) {
        const stopped = cars.filter(v => !v.departure && v.arrival?.progress !== 1 && v.speed < 0.5);
        sample.stopped += stopped.length;
        sample.west += stopped.filter(v => v.pose.x < 108).length;
        sample.pending += city.pending.length;
      }
      if (second % 60 === 0) timeline.push(snapshot(city));
      if (second === 720) primary = difference(before, snapshot(city), samples[0].stopped, samples[0].west, samples[0].pending);
      if (second === 900) {
        startFollowup = snapshot(city);
        assert.equal(city.council.current, undefined, "the voluntary activity has ended");
        if (condition.participation) assert.ok(city.council.records[0].result);
      }
      if (second === 1500) followup = difference(startFollowup!, snapshot(city), samples[1].stopped, samples[1].west, samples[1].pending);
    }
    const r = city.council.records[0];
    const result = {
      id: condition.id, seed, policy: d?.policy ?? null, target: d?.target ?? null,
      policyTarget: d?.policyTarget ?? null,
      cost: (d ? LIVE_POLICIES.find(p => p.id === d.policy)!.cost : 0) +
        (d?.topic === "traffic" ? LIVE_POLICIES.find(p => p.id === "patrol")!.cost : 0) +
        (r ? communityMethod(r.method).cost : 0),
      additionalPolicy: d?.topic === "traffic" ? { policy: "patrol", target: "homes" } : null,
      vote: r?.vote ?? null, method: r?.method ?? null, activeFrom: r?.startsAt ?? null, activeUntil: r?.endsAt ?? null,
      ordinaryDemandHash: hash([...demandHistory.values()].sort((a, b) => a.id - b.id)),
      disposalDemandHash: hash(city.disposalEvents.map(e => ({ time: e.time, request: e.request, source: e.source, amount: e.amount }))),
      before, primary: primary!, followup: followup!, timeline,
      elapsedSeconds: (performance.now() - started) / 1000,
    };
    if (runs.length) {
      assert.deepEqual(result.before, runs[0].before, "identical city before intervention");
      assert.equal(result.ordinaryDemandHash, runs[0].ordinaryDemandHash, "identical general travel demand");
      assert.equal(result.disposalDemandHash, runs[0].disposalDemandHash, "identical disposal requests");
    }
    runs.push(result);
    await writeFile(`${output}/${seed}${topic ? `-${topic}` : ""}.json`, JSON.stringify({
      revision, seed, interventionAt: 120, windows: [[120, 720], [900, 1500]],
      workingTreeChanged: execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" }).trim().length > 0,
      note: "Independent local issue interventions. Policy and elected activity begin at 120 seconds. Preparation delay is retained. The organized activity ends after 10 minutes; learned habits decay over the next 20 minutes. No second meeting. Follow-up starts at 900 seconds. Units are simulated, not empirical measurements.",
      runs,
    }, null, 2));
    console.log(JSON.stringify({
      seed, id: result.id, method: result.method, cost: result.cost,
      primary: { parking: primary!.localParkingSeconds, waste: primary!.alleyDumped, water: primary!.householdEntered,
        downstream: primary!.endpoint.values.water, stopped: primary!.meanWestStopped },
      followup: { parking: followup!.localParkingSeconds, waste: followup!.alleyDumped, water: followup!.householdEntered,
        downstream: followup!.endpoint.values.water, stopped: followup!.meanWestStopped },
      elapsedSeconds: result.elapsedSeconds,
    }));
  }
}
