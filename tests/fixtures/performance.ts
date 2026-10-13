import { createPedestrianDemand } from "../../src/simulation/pedestrians";
import "../../src/styles.css";
import { CityRenderer } from "../../src/renderer/city";
import { RenderClock, type DisplayQuality } from "../../src/renderer/quality";
import { TrafficSimulation, MODEL_VERSION } from "../../src/simulation";
import { createDemand, DEFAULT_POLICY } from "../../src/scenario";

const nextFrame = () =>
  new Promise<number>((resolve) => requestAnimationFrame(resolve));
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ] ?? 0;
let city: CityRenderer, sim: TrafficSimulation, quality: DisplayQuality;

Object.assign(window, {
  __performance: {
    async prepare(count: number, chosenQuality: DisplayQuality) {
      quality = chosenQuality;
      sim = new TrafficSimulation(
        { ...DEFAULT_POLICY, signal: true, bypass: true, oneWay: true },
        createDemand(2404, count),
        undefined,
        createPedestrianDemand(),
      );
      sim.runUntil(180);
      city = new CityRenderer(
        document.querySelector("canvas")!,
        document.querySelector("#map-labels")!,
        quality,
      );
      city.setSimulation(sim);
      const metrics = sim.stats;
      const warmup = performance.now();
      while (performance.now() - warmup < 1500) {
        await nextFrame();
        city.render(sim, false, metrics.roads, true);
      }
    },
    async measure(duration: number) {
      const gl = city.renderer.getContext();
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const start = await nextFrame();
      let previous = start,
        lastRender = start,
        lastMetrics = start;
      const renderClock = new RenderClock();
      let animationFrames = 0;
      let frameCount = 0,
        renderMs = 0,
        simulationMs = 0,
        metrics = sim.stats;
      const startTime = sim.time,
        frameIntervals: number[] = [];
      let minActive = sim.vehicles.size,
        maxActive = minActive;
      while (previous - start < duration) {
        const now = await nextFrame();
        animationFrames++;
        const cpuStart = performance.now();
        sim.advance(Math.min((now - previous) / 1000, 0.25) * 2);
        if (now - lastMetrics >= 250) {
          metrics = sim.stats;
          lastMetrics = now;
        }
        simulationMs += performance.now() - cpuStart;
        minActive = Math.min(minActive, sim.vehicles.size);
        maxActive = Math.max(maxActive, sim.vehicles.size);
        if (renderClock.due(now, quality)) {
          const renderStart = performance.now();
          city.render(sim, false, metrics.roads);
          renderMs += performance.now() - renderStart;
          frameIntervals.push(now - lastRender);
          frameCount++;
          lastRender = now;
        }
        previous = now;
      }
      const elapsed = (previous - start) / 1000;
      const { roads, ...stats } = sim.stats;
      return {
        modelVersion: MODEL_VERSION,
        demandCount: sim.demand.length,
        pedestrianCount: sim.pedestrians.demand.length,
        pedestrianActive: sim.pedestrians.active.size,
        quality,
        measuredSeconds: elapsed,
        speed: 2,
        simulationStart: startTime,
        simulationSecondsAdvanced: sim.time - startTime,
        renderedFPS: frameCount / elapsed,
        animationFrameRate: animationFrames / elapsed,
        frameP50Ms: percentile(frameIntervals, 0.5),
        frameP95Ms: percentile(frameIntervals, 0.95),
        framesOver50Ms: frameIntervals.filter((t) => t > 50.5).length,
        frames: frameCount,
        renderCpuMsPerSecond: renderMs / elapsed,
        simulationCpuMsPerSecond: simulationMs / elapsed,
        minActive,
        maxActive,
        stats,
        pedestrians: sim.pedestrians.stats,
        display: city.displaySettings,
        drawCalls: city.drawCalls,
        memory: { ...city.renderer.info.memory },
        gpu: debug
          ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
      };
    },
  },
});
