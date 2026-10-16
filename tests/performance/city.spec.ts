import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

const measurements: any[] = [];
const wasteMeasurements: any[] = [];
const facilityMeasurements: any[] = [];
const environmentMeasurements: any[] = [];
const logisticsMeasurements: any[] = [];
for (const quality of ["normal", "light"]) {
  test(`logistics / ${quality} / CPU 4x slowdown`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/fixtures/performance.html");
    await page.waitForFunction(() => (window as any).__performance);
    await page.evaluate(
      (quality) =>
        (window as any).__performance.prepare(140, quality, "logistics"),
      quality,
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const measured = await page.evaluate(() =>
      (window as any).__performance.measure(5000),
    );
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    expect(measured.logistics.trucks).toBe(3);
    expect(measured.logistics.stockLabels).toBe(4);
    expect(measured.logistics.inTrucks).toBeGreaterThan(0);
    expect(measured.frames).toBeGreaterThan(0);
    expect(measured.demandCount).toBe(140);
    expect(errors).toEqual([]);
    logisticsMeasurements.push({ cpuSlowdownRate: 4, ...measured });
    await fs.mkdir("output", { recursive: true });
    await fs.writeFile(
      "output/logistics-performance.json",
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          method:
            "Isolated renderer harness, 140 ordinary trips, 60 pedestrians, 3 cargo trucks, handling and diverse supply. Stock building colors, 7 quantity labels, applied policy pins. Chrome CPU slowdown 4x is emulation, not school hardware. Full production HUD is excluded.",
          measurements: logisticsMeasurements,
        },
        null,
        2,
      ),
    );
  });
}
for (const quality of ["normal", "light"]) {
  test(`environment / ${quality} / CPU 4x slowdown`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/fixtures/performance.html");
    await page.waitForFunction(() => (window as any).__performance);
    await page.evaluate(
      (quality) =>
        (window as any).__performance.prepare(140, quality, "environment"),
      quality,
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const measured = await page.evaluate(() =>
      (window as any).__performance.measure(5000),
    );
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    expect(measured.environment.addedTrips).toBe(72);
    expect(measured.demandCount).toBe(212);
    expect(measured.pedestrianCount).toBe(60);
    expect(measured.environment.sampleCount).toBeGreaterThan(180);
    expect(measured.frames).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    environmentMeasurements.push({ cpuSlowdownRate: 4, ...measured });
    await fs.writeFile(
      "output/environment-performance.json",
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          method:
            "Isolated renderer harness: 140 background + 72 development trips, 60 pedestrians, two developed parcels, buffer trees and 17 environment labels; CPU 4x is Chrome emulation, not school hardware.",
          measurements: environmentMeasurements,
        },
        null,
        2,
      ),
    );
  });
}
for (const quality of ["normal", "light"]) {
  test(`facilities / ${quality} / CPU 4x slowdown`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/fixtures/performance.html");
    await page.waitForFunction(() => (window as any).__performance);
    await page.evaluate(
      (quality) =>
        (window as any).__performance.prepare(0, quality, "facilities"),
      quality,
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const measured = await page.evaluate(() =>
      (window as any).__performance.measure(5000),
    );
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    expect(measured.facilities).toBe(4);
    expect(measured.accessLabels).toBe(12);
    expect(measured.simulationSecondsAdvanced).toBe(0);
    expect(measured.demandCount).toBe(0);
    expect(measured.frames).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    facilityMeasurements.push({ cpuSlowdownRate: 4, ...measured });
    await fs.writeFile(
      "output/facility-performance.json",
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          method:
            "Same isolated renderer harness; facility planning with north library and existing library expansion, 12 access labels, static planning time and no animated population. Chrome CPU slowdown 4x is emulation, not school hardware.",
          measurements: facilityMeasurements,
        },
        null,
        2,
      ),
    );
  });
}
for (const quality of ["normal", "light"]) {
  test(`waste / ${quality} / CPU 4x slowdown`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/fixtures/performance.html");
    await page.waitForFunction(() => (window as any).__performance);
    await page.evaluate(
      (quality) => (window as any).__performance.prepare(140, quality, "waste"),
      quality,
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const measured = await page.evaluate(() =>
      (window as any).__performance.measure(5000),
    );
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    expect(measured.serviceTrucks).toBe(3);
    expect(measured.waste.collected).toBeGreaterThan(0);
    expect(measured.frames).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    wasteMeasurements.push({ cpuSlowdownRate: 4, ...measured });
    await fs.writeFile(
      "output/waste-performance.json",
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          method:
            "Same isolated renderer harness as performance.json; 140 ordinary trips, 60 pedestrians, 3 real service trucks, all waste policies. Chrome CPU slowdown 4x is emulation, not school hardware.",
          measurements: wasteMeasurements,
        },
        null,
        2,
      ),
    );
  });
}
for (const cpuRate of [1, 4])
  for (const count of [80, 150, 300])
    for (const quality of ["normal", "light"]) {
      test(`${count} trips / ${quality} / CPU ${cpuRate}x slowdown`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("/tests/fixtures/performance.html");
        await page.waitForFunction(() => (window as any).__performance);
        await page.evaluate(
          ({ count, quality }) =>
            (window as any).__performance.prepare(count, quality),
          { count, quality },
        );
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
        const measured = await page.evaluate(() =>
          (window as any).__performance.measure(5000),
        );
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        measurements.push({ cpuSlowdownRate: cpuRate, ...measured });
        const stats = measured.stats;
        expect(
          stats.arrived + stats.active + stats.queued + stats.unreleased,
        ).toBe(count);
        expect(measured.frames).toBeGreaterThan(0);
        expect(Number.isFinite(measured.frameP95Ms)).toBe(true);
        expect(errors).toEqual([]);
        await fs.mkdir("output", { recursive: true });
        await fs.writeFile(
          "output/performance.json",
          JSON.stringify(
            {
              measuredAt: new Date().toISOString(),
              method:
                "Shared CityRenderer and TrafficSimulation in an isolated Vite development harness, fixed camera, 1280x720 CSS pixels, device scale 1.5, seed 2404, 60 pedestrian trips with a separate active count and metrics, all policies, start at simulation second 180, 1.5s rendering warmup, 5s sample at 2x simulation speed. CPU slowdown is Chrome emulation, not a school PC or GPU emulation. Active vehicles are reported separately from trip demand. FPS counts calls to render; CPU submission time excludes asynchronous GPU work. The production HUD and cold startup are not measured here.",
              measurements,
            },
            null,
            2,
          ),
        );
        console.log(
          JSON.stringify({
            demand: count,
            quality,
            cpuRate,
            fps: +measured.renderedFPS.toFixed(1),
            frameP95Ms: +measured.frameP95Ms.toFixed(1),
            active: [measured.minActive, measured.maxActive],
          }),
        );
      });
    }
