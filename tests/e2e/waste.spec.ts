import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";

async function choose(page: Page, id: string) {
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await expect(page.locator("[data-scenario]")).toHaveCount(8);
  await page.locator(`[data-scenario="${id}"]`).click();
}

test("waste trucks, local impacts, records and printed worksheet form a complete experiment", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mode=lab");
  await choose(page, "waste");
  await page.locator("#speed").selectOption("8");
  await page.getByRole("button", { name: "수거 현황", exact: true }).click();
  await expect(page.locator(".truck-row")).toHaveCount(2);
  await page.locator("#map-layer").selectOption("waste");
  await expect(page.locator(".facility-data:visible")).toHaveCount(6);
  await page.waitForFunction(
    () => (window as any).__mayor.simulation.wasteStats.collected > 1,
  );
  await page.locator("#pause").click();
  const stats = await page.evaluate(
    () => (window as any).__mayor.simulation.wasteStats,
  );
  await expect(
    page.locator("#waste-observation .big-metric strong"),
  ).toHaveText(`${stats.collectionRate.toFixed(1)}%`);
  await page.screenshot({ path: "output/playwright/waste-collecting.png" });
  const collecting = await page.evaluate(
    () =>
      (window as any).__mayor.simulation.trucks.find(
        (t: any) => t.phase === "collecting",
      ).id,
  );
  await page.locator(`[data-truck="${collecting}"]`).click();
  await expect(page.locator("#selection-detail")).toContainText(
    "멈춰서 수거 중",
  );
  await page.locator("#selection-detail summary").click();
  await expect(page.locator("#selection-detail")).toContainText("봉투");
  await page.screenshot({ path: "output/playwright/waste-truck.png" });
  await page.getByRole("button", { name: "주민 의견", exact: true }).click();
  await expect(page.locator(".resident-pin")).toHaveCount(6);
  await expect(page.locator("#resident-bubble")).toContainText("관찰한 사실");
  await expect(page.locator("[data-panel]:visible")).toHaveCount(1);
  await page.locator("#finish").click();
  await expect(page.locator("#mode-label")).toHaveText("시행 전 · 관찰 완료", {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  await page.locator('[data-policy="route"]').check();
  await page
    .locator("#decision-reason")
    .fill("주민 의견과 지도를 보고 서쪽부터 수거하기로 했어요.");
  await expect(page.locator("#budget")).toHaveText("80");
  await page.locator("#apply").click();
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  await expect(page.locator("#result-table")).toContainText(
    "한 차례 수거를 마친 곳",
  );
  await page.locator("#waste-regions-details summary").click();
  await expect(page.locator("#waste-regions-details .better")).not.toHaveCount(
    0,
  );
  await expect(page.locator("#waste-regions-details .worse")).not.toHaveCount(
    0,
  );
  await page
    .locator("#reflection")
    .fill("외곽은 나아졌지만 학교와 상점가는 더 기다렸어요.");
  await page.screenshot({ path: "output/playwright/waste-results.png" });
  const event = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await event;
  const raw = await fs.readFile((await download.path())!, "utf8");
  const record = JSON.parse(raw);
  expect(record.schemaVersion).toBe(5);
  expect(record.scenarioId).toBe("waste");
  expect(record.policyIds).toEqual(["route"]);
  expect(record.budget).toBe(80);
  expect(record.investigations.length).toBeGreaterThan(2);
  expect(record.residents).toHaveLength(6);
  expect(record.wasteBefore.time).toBe(600);
  expect(record.wasteAfter.time).toBe(600);
  expect(record.serviceEvents.some((e: any) => e.type === "collect")).toBe(
    true,
  );
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.locator("#print-current").click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#print-sheet")).toBeVisible();
  await expect(page.locator("#print-sheet")).toContainText(
    record.decisionReason,
  );
  await expect(page.locator("#print-sheet")).toContainText(
    "수거 순서 조정 (20)",
  );
  await page.pdf({
    path: "output/playwright/waste-worksheet.pdf",
    preferCSSPageSize: true,
  });
  const pdf = await fs.readFile("output/playwright/waste-worksheet.pdf");
  expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  await page.screenshot({
    path: "output/playwright/waste-worksheet.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.locator("#close-results").click();
  await page.locator("#reset").click();
  await page.locator("#pause").click();
  const time = await page.evaluate(
    () => (window as any).__mayor.simulation.time,
  );
  await page.locator("#record-file").setInputFiles({
    name: "experiment.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await expect(page.locator("#record-dialog")).toBeVisible();
  await expect(page.locator("#saved-record-content")).toContainText(
    record.reflection,
  );
  expect(
    await page.evaluate(() => (window as any).__mayor.simulation.time),
  ).toBe(time);
  await page.locator("#close-record").click();
  await page.locator("#record-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("broken"),
  });
  await expect(page.locator("#toast")).toContainText("읽을 수 없어요");
  await expect(page.locator("#record-dialog")).toBeHidden();
  const legacy = {
    ...record,
    schemaVersion: 3,
    scenarioId: undefined,
    policy: { signal: true },
    reflection: '<img src=x onerror="alert(1)"> 예전 기록',
  };
  await page.locator("#record-file").setInputFiles({
    name: "v3.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await expect(page.locator("#saved-record-content")).toContainText(
    "예전 기록",
  );
  await expect(page.locator("#saved-record-content img")).toHaveCount(0);
  await expect(page.locator("#saved-record-content")).toContainText(
    "막히는 등굣길",
  );
  await page.locator("#close-record").click();
  await choose(page, "traffic");
  await expect(page.locator("#mission-title")).toHaveText("막히는 등굣길");
  expect(
    await page.evaluate(() => ({
      baseline: (window as any).__mayor.baseline,
      demand: (window as any).__mayor.simulation.demand.length,
    })),
  ).toEqual({ baseline: undefined, demand: 140 });
  expect(errors).toEqual([]);
});

test("waste stays usable on mobile and selecting a removed third truck cannot crash a new run", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?mode=lab");
  await choose(page, "waste");
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  for (const id of ["extraTruck", "route", "reduce"])
    await page.locator(`[data-policy="${id}"]`).check();
  await expect(page.locator("#budget")).toHaveText("0");
  await page.screenshot({ path: "output/playwright/waste-policy-mobile.png" });
  await page.locator("#apply").click();
  await expect(page.locator("#mode-label")).toHaveText(
    "정책 시행 후 · 실험 중",
    { timeout: 60000 },
  );
  await page.getByRole("button", { name: "수거 현황", exact: true }).click();
  await expect(page.locator(".truck-row")).toHaveCount(3);
  await page.locator("#map-layer").selectOption("population");
  await expect(page.locator("#map-layer-note")).toContainText("가상");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const panel = await page.locator("#panel-traffic").boundingBox();
  const deck = await page.locator(".command-deck").boundingBox();
  expect(panel!.y + panel!.height).toBeLessThan(deck!.y);
  await page.screenshot({ path: "output/playwright/waste-mobile.png" });
  await page.locator('[data-truck="10002"]').click();
  await page.locator("#reset").click();
  await page.getByRole("button", { name: "수거 현황", exact: true }).click();
  await expect(page.locator(".truck-row")).toHaveCount(2);
  expect(errors).toEqual([]);
});
