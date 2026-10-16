import { createPedestrianDemand } from "../../src/simulation/pedestrians";
import "../../src/styles.css";
import { CityRenderer } from "../../src/renderer/city";
import { RenderClock, type DisplayQuality } from "../../src/renderer/quality";
import { TrafficSimulation, MODEL_VERSION } from "../../src/simulation";
import { createDemand, DEFAULT_POLICY } from "../../src/scenario";
import { WasteSimulation } from "../../src/simulation/services/waste";
import { FacilitySimulation } from "../../src/simulation/facilities";
import { EnvironmentSimulation } from "../../src/simulation/environment";
import { LogisticsSimulation } from "../../src/simulation/economy";

const nextFrame = () =>
  new Promise<number>((resolve) => requestAnimationFrame(resolve));
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ] ?? 0;
let city: CityRenderer, sim: TrafficSimulation, quality: DisplayQuality;

Object.assign(window, {
  __performance: {
    async prepare(
      count: number,
      chosenQuality: DisplayQuality,
      scenario = "traffic",
    ) {
      quality = chosenQuality;
      sim =
        scenario === "logistics"
          ? new LogisticsSimulation(2404, [
              "cargoTruck",
              "handling",
              "diversify",
            ])
          : scenario === "environment"
            ? new EnvironmentSimulation(2404, ["industry", "housing", "buffer"])
            : scenario === "facilities"
              ? new FacilitySimulation(2404, ["library", "expand"], {
                  siteId: "north",
                })
              : scenario === "waste"
                ? new WasteSimulation(
                    2404,
                    ["extraTruck", "route", "reduce"],
                    undefined,
                    count,
                  )
                : new TrafficSimulation(
                    {
                      ...DEFAULT_POLICY,
                      signal: true,
                      bypass: true,
                      oneWay: true,
                    },
                    createDemand(2404, count),
                    undefined,
                    createPedestrianDemand(),
                  );
      if (!(sim instanceof FacilitySimulation)) sim.runUntil(180);
      city = new CityRenderer(
        document.querySelector("canvas")!,
        document.querySelector("#map-labels")!,
        quality,
      );
      city.setSimulation(sim);
      if (sim instanceof LogisticsSimulation) city.setMapLayer("stock");
      if (sim instanceof FacilitySimulation) city.setMapLayer("access");
      if (sim instanceof EnvironmentSimulation) city.setMapLayer("environment");
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
        if (!(sim instanceof FacilitySimulation))
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
        logistics:
          sim instanceof LogisticsSimulation
            ? {
                trucks: sim.trucks.length,
                delivered: sim.logisticsStats.delivered,
                inTrucks: sim.logisticsStats.inTrucks,
                stockLabels: document.querySelectorAll(".stock-label").length,
              }
            : undefined,
        environment:
          sim instanceof EnvironmentSimulation
            ? {
                addedTrips: sim.addedDemand.length,
                sampleCount: sim.environmentStats.sampleCount,
              }
            : undefined,
        scenarioId:
          sim instanceof LogisticsSimulation
            ? "logistics"
            : sim instanceof EnvironmentSimulation
              ? "environment"
              : sim instanceof FacilitySimulation
                ? "facilities"
                : sim instanceof WasteSimulation
                  ? "waste"
                  : "traffic",
        facilities:
          sim instanceof FacilitySimulation
            ? sim.facilityStats.facilities.length
            : undefined,
        accessLabels:
          sim instanceof FacilitySimulation
            ? document.querySelectorAll(".civic-label[data-level]").length
            : undefined,
        serviceTrucks: sim instanceof WasteSimulation ? sim.trucks.length : 0,
        waste: sim instanceof WasteSimulation ? sim.wasteStats : undefined,
        demandCount: sim.demand.length,
        pedestrianCount: sim.pedestrians.demand.length,
        pedestrianActive: sim.pedestrians.active.size,
        quality,
        measuredSeconds: elapsed,
        speed: sim instanceof FacilitySimulation ? 0 : 2,
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
