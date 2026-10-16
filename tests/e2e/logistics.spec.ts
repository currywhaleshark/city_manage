import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { LogisticsSimulation } from "../../src/simulation/economy";
import { stockBand } from "../../src/renderer/map-data";
async function choose(page: Page, id = "logistics") {
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await expect(page.locator("[data-scenario]")).toHaveCount(8);
  await page.locator(`[data-scenario="${id}"]`).click();
}
async function checkStock(page: Page) {
  await expect(page.locator(".stock-label:visible")).toHaveCount(4);
  const shops = await page.evaluate(
    () => (window as any).__mayor.simulation.shops,
  );
  await expect
    .poll(async () =>
      (
        await page.evaluate(
          () => (window as any).__mayor.mapVisualization.buildings,
        )
      )
        .filter((b: any) => b.tinted)
        .map((b: any) => ({ id: b.id, color: b.color })),
    )
    .toEqual(
      shops.map((s: any) => ({
        id: s.facilityId,
        color: stockBand(s.stock).color,
      })),
    );
}

test("cargo runs on real roads and inventory maps, local policies, records and print follow the simulation", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mode=lab");
  await choose(page);
  await page.locator("#pause").click();
  await page.locator("#layer-stock").click();
  await expect(page.locator('[data-layer-legend="stock"]')).toBeVisible();
  await checkStock(page);
  await expect(page.locator(".supply-label:visible")).toHaveCount(2);
  await page.getByRole("button", { name: "물류 현황", exact: true }).click();
  await expect(page.locator("#logistics-observation")).toContainText(
    "도착해 내려놓아야",
  );
  await expect(page.locator("[data-truck]")).toHaveCount(2);
  await page.locator("#logistics-sources summary").click();
  await page.locator('[data-cargo-source="factory"]').click();
  await expect(page.locator("#selection-detail")).toContainText("처음 물자");
  await page.keyboard.press("Escape");
  await page.locator("#camera-reset").click();
  await page.getByRole("button", { name: "주민 의견", exact: true }).click();
  await expect(page.locator(".resident-pin:visible")).toHaveCount(5);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  for (const id of ["shortcut", "cargoTruck", "handling"])
    await page.locator(`[data-policy="${id}"]`).check();
  await expect(page.locator('[data-policy="diversify"]')).toBeDisabled();
  await expect(page.locator("#budget")).toHaveText("10");
  await page
    .locator("#decision-reason")
    .fill("지름길과 화물차, 하역 지원을 함께 비교해요.");
  await page.locator("#apply").click();
  await page.locator("#speed").selectOption("8");
  await page.waitForFunction(() =>
    (window as any).__mayor.simulation.trucks.some((t: any) => t.load > 3),
  );
  await page.locator("#pause").click();
  await expect(page.locator(".applied-policy-pin:visible")).toHaveCount(2);
  await expect(page.locator("[data-shared-policy]:visible")).toHaveCount(1);
  await checkStock(page);
  await page.screenshot({ path: "output/playwright/logistics-map.png" });
  await page.getByRole("button", { name: "물류 현황", exact: true }).click();
  await expect(page.locator("[data-truck]")).toHaveCount(3);
  await page.locator('[data-truck="20000"]').click();
  await page.locator("#cargo-route summary").click();
  await expect(page.locator("#selection-detail")).toContainText("물자의 출처");
  await page.screenshot({ path: "output/playwright/logistics-truck.png" });
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  const expected = new LogisticsSimulation(2404, [
    "shortcut",
    "cargoTruck",
    "handling",
  ]);
  expected.runUntil(600);
  expect(
    await page.evaluate(
      () => (window as any).__mayor.simulation.logisticsStats,
    ),
  ).toEqual(expected.logisticsStats);
  await expect(page.locator("#result-table tbody tr")).toHaveCount(7);
  await page.locator("#logistics-regions summary").click();
  await expect(page.locator("#logistics-regions tbody tr")).toHaveCount(4);
  await page
    .locator("#reflection")
    .fill("공장에 물건이 있어도 길이 막히면 상점에 도착하지 못해요.");
  await page.screenshot({ path: "output/playwright/logistics-results.png" });
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const raw = await fs.readFile((await (await download).path())!, "utf8"),
    record = JSON.parse(raw);
  expect(record.logisticsAfter).toEqual(expected.logisticsStats);
  expect(record.cargoTrucks).toHaveLength(3);
  expect(record.goodsEvents.length).toBeGreaterThan(0);
  expect(record.analysis).toBeUndefined();
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.locator("#print-current").click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#print-sheet")).toContainText(
    "시장에 물건이 부족해요",
  );
  const pdf = await page.pdf({
    path: "output/playwright/logistics-worksheet.pdf",
    preferCSSPageSize: true,
  });
  expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  await page.emulateMedia({ media: "screen" });
  await page.locator("#close-results").click();
  await page.locator("#reset").click();
  await expect(page.locator("[data-shared-policy]:visible")).toHaveCount(0);
  await page.locator("#record-file").setInputFiles({
    name: "logistics.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await expect(page.locator("#saved-record-content")).toContainText(
    record.reflection,
  );
  expect(
    await page.evaluate(() => (window as any).__mayor.simulation.trucks.length),
  ).toBe(2);
  await page.locator("#close-record").click();
  await choose(page, "traffic");
  await expect(page.locator(".stock-label,.supply-label")).toHaveCount(0);
  await expect(page.locator("#layer-stock")).toBeHidden();
  expect(errors).toEqual([]);
});

test("mobile cargo view keeps the map readable and new conditions and external supply compare fairly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?mode=lab");
  await choose(page);
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page
    .locator(".experiment-settings:not(.display-settings) summary")
    .click();
  await page.locator("#experiment-seed").selectOption("2405");
  await page.locator("#experiment-duration").selectOption("300");
  await page.locator("#new-experiment").click();
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  for (const id of ["cargoTruck", "handling", "diversify"])
    await page.locator(`[data-policy="${id}"]`).check();
  await page.screenshot({
    path: "output/playwright/logistics-mobile-policy.png",
  });
  await page.locator("#apply").click();
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  const expected = new LogisticsSimulation(2405, [
    "cargoTruck",
    "handling",
    "diversify",
  ]);
  expected.runUntil(300);
  expect(
    await page.evaluate(
      () => (window as any).__mayor.simulation.logisticsStats,
    ),
  ).toEqual(expected.logisticsStats);
  await page.locator("#close-results").click();
  await page.locator("#layer-stock").click();
  await checkStock(page);
  await expect(page.locator(".supply-label:visible")).toHaveCount(3);
  for (const label of await page
    .locator(".supply-label:visible,.stock-label:visible")
    .all()) {
    const box = await label.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: "output/playwright/logistics-mobile-map.png" });
  await page.getByRole("button", { name: "물류 현황", exact: true }).click();
  await page.locator("#logistics-shops summary").click();
  await page.screenshot({
    path: "output/playwright/logistics-mobile-panel.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const panel = await page.locator("#panel-traffic").boundingBox(),
    deck = await page.locator(".command-deck").boundingBox();
  expect(panel!.y + panel!.height).toBeLessThan(deck!.y);
  expect(errors).toEqual([]);
});
