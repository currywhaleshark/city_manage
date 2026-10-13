import { createPedestrianDemand } from "../src/simulation/pedestrians";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { TrafficSimulation, MODEL_VERSION } from "../src/simulation";
import { CONFIG, DEFAULT_POLICY, createDemand } from "../src/scenario";
mkdirSync("output", { recursive: true });
const scenarios: any[] = [];
for (const [name, policy] of Object.entries({
  baseline: DEFAULT_POLICY,
  signal: { ...DEFAULT_POLICY, signal: true },
  bypass: { ...DEFAULT_POLICY, bypass: true },
  oneWay: { ...DEFAULT_POLICY, oneWay: true },
  combined: { ...DEFAULT_POLICY, signal: true, bypass: true, oneWay: true },
})) {
  const start = performance.now(),
    sim = new TrafficSimulation(
      policy,
      createDemand(),
      undefined,
      createPedestrianDemand(),
    );
  sim.runUntil(CONFIG.duration);
  const { roads, ...stats } = sim.stats;
  const pedestrians = sim.pedestrians.stats;
  const laneChanges = sim.laneChangeEvents.length;
  const cpuMs = performance.now() - start,
    peakStopped = Math.max(...sim.history.map((p) => p.stopped));
  while (sim.completed.length < sim.demand.length && sim.time < 6500)
    sim.step();
  scenarios.push({
    name,
    policy,
    stats,
    laneChanges,
    pedestrians,
    cpuMs: Math.round(cpuMs),
    peakStopped,
    allArrivedAt: sim.time,
    allArrived: sim.completed.length === 140,
  });
}
const start = performance.now(),
  stress = new TrafficSimulation(
    { ...DEFAULT_POLICY, signal: true, bypass: true },
    createDemand(2404, 300),
    undefined,
    createPedestrianDemand(),
  );
stress.runUntil(420);
const stressMs = performance.now() - start;
const file = readFileSync("public/audio/policy-confirm.wav");
let offset = 12,
  format = 0,
  channels = 0,
  sampleRate = 0,
  bits = 0,
  dataStart = 0,
  dataLength = 0;
while (offset + 8 <= file.length) {
  const name = file.toString("ascii", offset, offset + 4),
    size = file.readUInt32LE(offset + 4);
  if (name === "fmt ") {
    format = file.readUInt16LE(offset + 8);
    channels = file.readUInt16LE(offset + 10);
    sampleRate = file.readUInt32LE(offset + 12);
    bits = file.readUInt16LE(offset + 22);
  }
  if (name === "data") {
    dataStart = offset + 8;
    dataLength = size;
    break;
  }
  offset += 8 + size + (size % 2);
}
let peak = 0,
  sum = 0,
  nonfinite = 0;
const bytes = bits / 8,
  count = dataLength / bytes;
for (let i = 0; i < count; i++) {
  const p = dataStart + i * bytes;
  const v =
    format === 3 && bits === 32
      ? file.readFloatLE(p)
      : format === 1 && bits === 16
        ? file.readInt16LE(p) / 32768
        : NaN;
  if (!Number.isFinite(v)) {
    nonfinite++;
    continue;
  }
  peak = Math.max(peak, Math.abs(v));
  sum += v * v;
}
const report = {
  modelVersion: MODEL_VERSION,
  seed: CONFIG.seed,
  observationSeconds: CONFIG.duration,
  demandCount: 140,
  pedestrianCount: 60,
  scenarios,
  stress: {
    count: 300,
    cpuMs: Math.round(stressMs),
    arrived: stress.stats.arrived,
    active: stress.stats.active,
    queued: stress.stats.queued,
  },
  audio: {
    format,
    channels,
    sampleRate,
    bits,
    durationSeconds: dataLength / (sampleRate * channels * bytes),
    peak,
    rms: Math.sqrt(sum / count),
    nonfinite,
    listeningVerified: false,
  },
};
writeFileSync("output/verification.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
