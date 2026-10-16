import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
test("full living city performance at 15 minutes", async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem("mayor-living-city-v1"))
      localStorage.setItem(
        "mayor-living-city-v1",
        JSON.stringify({
          version: "living-city-v1",
          seed: 2404,
          time: 900,
          actions: [],
          notes: "성능 측정",
          observations: [],
        }),
      );
    localStorage.setItem("mayor-display-quality", "normal");
  });
  const start = Date.now();
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => (window as any).__liveCity?.busy), {
      timeout: 120000,
    })
    .toBe(false);
  const initialLoadMs = Date.now() - start;
  await page.locator("#speed").selectOption("4");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const measures = [];
  for (const layer of ["normal", "water"]) {
    if (layer === "water") await page.locator("#layer-water").click();
    const before = await cdp.send("Performance.getMetrics");
    const frames = await page.evaluate(
      () =>
        new Promise<{ count: number; p95: number; elapsed: number }>(
          (resolve) => {
            const gaps: number[] = [];
            let start = performance.now(),
              last = start;
            const frame = (now: number) => {
              gaps.push(now - last);
              last = now;
              if (now - start < 5000) requestAnimationFrame(frame);
              else
                resolve({
                  count: gaps.length,
                  elapsed: now - start,
                  p95: gaps.sort((a, b) => a - b)[
                    Math.floor(gaps.length * 0.95)
                  ],
                });
            };
            requestAnimationFrame(frame);
          },
        ),
    );
    const after = await cdp.send("Performance.getMetrics");
    const delta = (name: string) =>
      after.metrics.find((m) => m.name === name)!.value -
      before.metrics.find((m) => m.name === name)!.value;
    measures.push({
      layer,
      ...frames,
      taskMs: delta("TaskDuration") * 1000,
      layoutCount: delta("LayoutCount"),
      layoutMs: delta("LayoutDuration") * 1000,
    });
  }
  await page.locator("#save-city").click();
  // Leave enough time for asynchronous checkpoint persistence, if supported.
  await page.waitForTimeout(600);
  const reloadStart = Date.now();
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => (window as any).__liveCity?.busy), {
      timeout: 120000,
    })
    .toBe(false);
  const report = {
    initialLoadMs,
    reloadMs: Date.now() - reloadStart,
    measures,
    errors,
  };
  console.log(JSON.stringify(report));
  await writeFile(
    `output/live-ui-${process.env.PERF_LABEL ?? "latest"}.json`,
    JSON.stringify(report, null, 2),
  );
  expect(errors).toEqual([]);
});
