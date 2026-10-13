import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

const measurements: any[] = [];
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
