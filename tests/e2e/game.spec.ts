import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("complete classroom flow: observe, budget, policies, fair comparison, export and reset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "우리 동네 시장님", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#travel")).toHaveText("집계 중");
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  const start = await page.locator("#clock").innerText();
  await page.waitForTimeout(350);
  await expect(page.locator("#clock")).toHaveText(start);
  await expect(page.locator("#apply")).toBeDisabled();
  await page.locator("#overlay").click();
  await expect(page.locator("#overlay")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#overlay-legend")).toBeVisible();
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#focus-school").click();
  await expect(page.locator("#selection-title")).toHaveText("학교 앞 교차로");
  await page.locator("#camera-reset").click();
  await page.locator("#speed").selectOption("8");
  await page.locator("#finish").click();
  await expect(page.locator("#mode-label")).toHaveText("시행 전 · 관찰 완료", {
    timeout: 60000,
  });
  const before = await page.evaluate(() => {
    const w = window as any;
    return w.__mayor.simulation.stats;
  });
  expect(before.stopped).toBeGreaterThan(30);
  expect(before.arrived).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await page.locator("#overlay").click();
  await expect(page.locator("#toast")).not.toHaveClass(/visible/);
  await page.screenshot({
    path: "output/playwright/city-overview.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  await page.locator('[data-policy-card="signal"]').click();
  await expect(page.locator("#budget")).toHaveText("85");
  await page.locator('[data-policy-card="bypass"]').click();
  await expect(page.locator("#budget")).toHaveText("30");
  await page.locator('[data-policy-card="oneWay"]').click();
  await expect(page.locator("#budget")).toHaveText("0");
  await expect(page.locator("#signal-setting")).toBeVisible();
  await page.screenshot({
    path: "output/playwright/policy-panel.png",
    animations: "disabled",
  });
  await page.locator("#apply").click();
  await expect(page.locator("#mode-label")).toHaveText(
    "정책 시행 후 · 실험 중",
  );
  await expect(page.locator("[data-panel]:visible")).toHaveCount(0);
  const network = await page.evaluate(() => {
    const s = (window as any).__mayor.simulation;
    return {
      bypass: s.network.roads.has("n2-1_n3-1"),
      oneway: s.network.roads.get("n1-2_n2-2").direction,
      ew: s.network.nodes.get("n3-2").signal.ew,
      sameDemand: s.demand === (window as any).__mayor.baseline.demand,
      samePedestrians:
        s.pedestrians.demand ===
        (window as any).__mayor.baseline.pedestrians.demand,
    };
  });
  expect(network).toEqual({
    bypass: true,
    oneway: "one-way",
    ew: 26,
    sameDemand: true,
    samePedestrians: true,
  });
  await page.locator("#speed").selectOption("4");
  await page.waitForFunction(
    () =>
      [...(window as any).__mayor.simulation.pedestrians.active.values()].some(
        (v: any) => v.crossing && v.trip.routeId === "school-front",
      ),
    {},
    { timeout: 60000 },
  );
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  expect(
    await page.evaluate(() => {
      const game = (window as any).__mayor.simulation;
      return {
        crossing: game.pedestrians.stats.crossing > 0,
        turnLanes: [...game.network.lanes.values()]
          .filter((lane: any) => lane.roadId === "n1-2_n2-2")
          .map((lane: any) => lane.turns),
      };
    }),
  ).toEqual({
    crossing: true,
    turnLanes: [
      ["left", "straight"],
      ["straight", "right"],
    ],
  });
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#focus-school").click();
  await page.keyboard.press("Escape");
  for (let i = 0; i < 4; i++) await page.locator("#zoom-in").click();
  await page.screenshot({
    path: "output/playwright/city-pedestrians.png",
    animations: "disabled",
  });
  await page.locator("#camera-reset").click();
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  await expect(page.locator("#result-table tbody tr")).toHaveCount(6);
  await expect(page.locator("#purpose-comparison")).toBeHidden();
  await page.locator("#impact-details summary").click();
  await expect(page.locator("#purpose-comparison tbody tr")).toHaveCount(3);
  await page.locator("#purpose-comparison").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/results-impact.png",
    animations: "disabled",
  });
  await page.locator('[data-analysis-group="direction"]').click();
  await expect(page.locator("#purpose-comparison")).toBeHidden();
  await expect(page.locator("#direction-comparison tbody tr")).toHaveCount(4);
  await page.locator("#matched-details summary").click();
  await expect(page.locator("#direction-comparison")).toBeHidden();
  await expect(page.locator("#matched-table")).toBeVisible();
  await page.locator("#matched-table").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/results-matched.png",
    animations: "disabled",
  });
  await page.locator("#matched-details summary").click();
  await page
    .locator("#reflection")
    .fill("정책마다 좋아진 점과 불편해진 점이 달라요. 반대 방향도 살펴볼래요.");
  await page.screenshot({
    path: "output/playwright/policy-results.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.locator("#pedestrian-details summary").click();
  await expect(page.locator("#pedestrian-details tbody tr")).toHaveCount(3);
  await page.locator("#pedestrian-details").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "output/playwright/pedestrian-results.png" });
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloadPromise;
  const path = await download.path();
  const exported = JSON.parse(await fs.readFile(path!, "utf8"));
  expect(exported.before.time).toBe(420);
  expect(exported.after.time).toBe(420);
  expect(exported.demand).toHaveLength(140);
  expect(exported.after.averageDemandWait).not.toBe(
    exported.before.averageDemandWait,
  );
  expect(exported.analysis.matched.count).toBeGreaterThan(0);
  expect(exported.modelVersion).toBe("pedestrians-v4");
  expect(Array.isArray(exported.laneChangesAfter)).toBe(true);
  expect(exported.schemaVersion).toBe(3);
  expect(exported.pedestrianDemand).toHaveLength(60);
  expect(exported.pedestriansAfter.arrived).toBe(60);
  expect(exported.reflection).toContain("반대 방향");
  await fs.mkdir("output", { recursive: true });
  await fs.writeFile(
    "output/browser-metrics.json",
    JSON.stringify(
      {
        before: exported.before,
        after: exported.after,
        drawCalls: await page.evaluate(() => (window as any).__mayor.drawCalls),
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  await page.locator("#close-results").click();
  await expect(page.locator("#show-results")).toBeEnabled();
  await page.locator("#show-results").click();
  await expect(page.locator("#results-dialog")).toBeVisible();
  await page.locator("#close-results").click();
  await page.locator("#reset").click();
  await expect(page.locator("#budget")).toHaveText("100");
  await expect(page.locator("#arrived")).toHaveText("0");
  await expect(page.locator("#apply")).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as any).__mayor.simulation.network.roads.has("n2-1_n3-1"),
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});
test("responsive layout has no horizontal overflow and keeps the city and policies accessible", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 800, height: 900 },
    { width: 826, height: 466 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#city-canvas")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator("[data-panel]:visible")).toHaveCount(0);
    await page.screenshot({
      path: `output/playwright/city-${viewport.width}.png`,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "정책 만들기", exact: true })
      .click();
    await expect(page.locator("#apply")).toBeVisible();
    await expect(page.locator("[data-panel]:visible")).toHaveCount(1);
    const panel = await page.locator("#panel-policy").boundingBox();
    const deck = await page.locator(".command-deck").boundingBox();
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.y + panel!.height).toBeLessThan(deck!.y);
    await page.screenshot({
      path: `output/playwright/layout-${viewport.width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "교통 현황", exact: true }).click();
    await expect(page.locator("#panel-policy")).toBeHidden();
    await expect(page.locator("#panel-traffic")).toBeVisible();
    await expect(page.locator("[data-panel]:visible")).toHaveCount(1);
    await expect(page.locator("#traffic-chart")).toBeHidden();
    await expect(page.locator("#pedestrian-status")).toBeHidden();
    await page.locator(".pedestrian-observation summary").click();
    await expect(page.locator("#pedestrian-status")).toContainText("60명");
    await page.locator(".vehicle-history summary").click();
    await expect(page.locator("#pedestrian-status")).toBeHidden();
    await expect(page.locator("#traffic-chart")).toBeVisible();
    if (viewport.width === 1280) {
      await page.screenshot({
        path: "output/playwright/traffic-panel.png",
        animations: "disabled",
      });
    }
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-panel]:visible")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "교통 현황", exact: true }),
    ).toBeFocused();
  }
});

test("new mornings and observation windows clear the previous baseline and remain fair on mobile", async ({
  page,
}) => {
  await page.goto("/");
  let previousDemand = "";
  for (const [seed, duration] of [
    [2405, 180],
    [2406, 600],
  ]) {
    if (seed === 2406) await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "동네 소식", exact: true }).click();
    if (!(await page.locator("#experiment-seed").isVisible()))
      await page.getByText("관찰 조건 바꾸기", { exact: true }).click();
    await page.locator("#experiment-seed").selectOption(String(seed));
    await page.locator("#experiment-duration").selectOption(String(duration));
    await page.locator("#new-experiment").click();
    await expect(page.locator("[data-panel]:visible")).toHaveCount(0);
    await expect(page.locator("#elapsed")).toContainText(
      `/ ${duration / 60}:00`,
    );
    expect(
      await page.evaluate(() => (window as any).__mayor.baseline),
    ).toBeUndefined();
    const demand = await page.evaluate(() =>
      JSON.stringify((window as any).__mayor.simulation.demand),
    );
    expect(demand).not.toBe(previousDemand);
    previousDemand = demand;
    await page
      .getByRole("button", { name: "정책 만들기", exact: true })
      .click();
    await page.locator('[data-policy-card="signal"]').click();
    await page.locator("#apply").click();
    await expect(page.locator("#mode-label")).toHaveText(
      "정책 시행 후 · 실험 중",
    );
    await page.locator("#finish").click();
    await expect(page.locator("#results-dialog")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.locator(".dialog-intro")).toContainText(
      `${duration / 60}분 동안`,
    );
    expect(
      await page.evaluate(() => {
        const game = (window as any).__mayor;
        return {
          before: game.baseline.time,
          after: game.simulation.time,
          sameDemand: game.baseline.demand === game.simulation.demand,
          samePedestrians:
            game.baseline.pedestrians.demand ===
            game.simulation.pedestrians.demand,
        };
      }),
    ).toEqual({
      before: duration,
      after: duration,
      sameDemand: true,
      samePedestrians: true,
    });
    await page.locator("#impact-details summary").click();
    await expect(page.locator("#purpose-comparison")).toBeVisible();
    if (seed === 2406) {
      expect(
        await page
          .locator("#purpose-comparison")
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
      ).toBe(true);
      await page.locator("#purpose-comparison").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: "output/playwright/results-mobile.png",
        animations: "disabled",
      });
    }
    await page.locator("#pedestrian-details summary").click();
    await expect(page.locator("#pedestrian-details tbody tr")).toHaveCount(3);
    await page.locator("#pedestrian-details").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "output/playwright/pedestrian-results.png" });
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export").click();
    const download = await downloadPromise;
    const path = await download.path();
    const exported = JSON.parse(await fs.readFile(path!, "utf8"));
    expect(exported.seed).toBe(seed);
    expect(exported.duration).toBe(duration);
    expect(exported.analysis.observationSeconds).toBe(duration);
    expect(
      exported.analysis.byPurpose.reduce(
        (sum: number, g: any) => sum + g.total,
        0,
      ),
    ).toBe(140);
    await page.locator("#close-results").click();
  }
});
