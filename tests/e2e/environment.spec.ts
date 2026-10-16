import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { EnvironmentSimulation } from "../../src/simulation/environment";
async function choose(page: Page, id: string) {
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await expect(page.locator("[data-scenario]")).toHaveCount(8);
  await page.locator(`[data-scenario="${id}"]`).click();
}
test("development changes land and real traffic, regional burden, resident voices and saved records", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mode=lab");
  await choose(page, "environment");
  await page.getByRole("button", { name: "환경 자료", exact: true }).click();
  await page.locator("#map-layer").selectOption("environment");
  await expect(
    page.locator(".environment-label[data-level]:visible"),
  ).toHaveCount(17);
  await expect(page.locator("#environment-observation")).toContainText("760㎡");
  await page.locator("#environment-places summary").click();
  await expect(page.locator("[data-environment-place]")).toHaveCount(17);
  await page.locator('[data-environment-place="b13"]').click();
  await expect(page.locator("#selection-detail")).toContainText("현재 부담");
  await page.getByRole("button", { name: "주민 의견", exact: true }).click();
  await expect(page.locator(".resident-pin")).toHaveCount(4);
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  for (const id of ["industry", "housing", "buffer"])
    await page.locator(`[data-policy="${id}"]`).check();
  await expect(page.locator('[data-policy="conserve"]')).toBeDisabled();
  await page.locator('[data-policy="small"]').check();
  await expect(page.locator("#budget")).toHaveText("0");
  await page
    .locator("#decision-reason")
    .fill("공간을 늘리되 규모를 줄이고 공장 옆에 완충 녹지를 만들어요.");
  await page.screenshot({
    path: "output/playwright/environment-policy.png",
    animations: "disabled",
  });
  await page.locator("#apply").click();
  await page.locator("#speed").selectOption("8");
  await page.waitForFunction(() =>
    [...(window as any).__mayor.simulation.vehicles.keys()].some(
      (id: any) => id >= 2000,
    ),
  );
  await page.locator("#pause").click();
  await page.locator("#camera-reset").click();
  await page.screenshot({
    path: "output/playwright/environment-city.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "환경 자료", exact: true }).click();
  await page.locator("#environment-land summary").click();
  await page.locator('[data-development="industry"]').click();
  await expect(page.locator("#selection-detail")).toContainText("개발 96㎡");
  await page.screenshot({
    path: "output/playwright/environment-industry.png",
    animations: "disabled",
  });
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  await expect(page.locator("#results-dialog .dialog-intro")).toContainText(
    "추가된 차량",
  );
  await expect(page.locator("#results-dialog .result-caution")).toContainText(
    "가상 지표",
  );
  const expected = new EnvironmentSimulation(2404, [
    "industry",
    "housing",
    "buffer",
    "small",
  ]);
  expected.runUntil(420);
  expect(
    await page.evaluate(
      () => (window as any).__mayor.simulation.environmentStats,
    ),
  ).toEqual(expected.environmentStats);
  await page.screenshot({
    path: "output/playwright/environment-summary.png",
    animations: "disabled",
  });
  await page.locator("#environment-regions summary").click();
  await expect(page.locator("#environment-regions tbody tr")).toHaveCount(17);
  await page
    .locator("#reflection")
    .fill("모든 장소의 부담이 같지는 않아요. 기존 차량의 도착도 함께 봤어요.");
  await page.screenshot({
    path: "output/playwright/environment-results.png",
    animations: "disabled",
  });
  const downloaded = page.waitForEvent("download");
  await page.locator("#export").click();
  const raw = await fs.readFile((await (await downloaded).path())!, "utf8"),
    record = JSON.parse(raw);
  expect(record.environmentAfter).toEqual(expected.environmentStats);
  expect(record.policyIds).toHaveLength(4);
  expect(record.backgroundDemand).toHaveLength(140);
  expect(record.addedDemandBefore).toHaveLength(0);
  expect(record.addedDemandAfter).toHaveLength(36);
  expect(record.demand).toHaveLength(176);
  expect(record.demandBefore).toHaveLength(140);
  expect(record.analysis).toBeUndefined();
  expect(record.timeUnit).toBe("seconds");
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.locator("#print-current").click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#print-sheet")).toContainText(
    "환경 부담은 가상 지표",
  );
  const pdf = await page.pdf({
    path: "output/playwright/environment-worksheet.pdf",
    preferCSSPageSize: true,
  });
  expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  await page.emulateMedia({ media: "screen" });
  await page.locator("#close-results").click();
  await page.locator("#reset").click();
  await page.locator("#record-file").setInputFiles({
    name: "environment.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await expect(page.locator("#saved-record-content")).toContainText(
    record.reflection,
  );
  expect(
    await page.evaluate(
      () => (window as any).__mayor.simulation.addedDemand.length,
    ),
  ).toBe(0);
  await page.locator("#close-record").click();
  await choose(page, "facilities");
  await expect(page.locator(".environment-label")).toHaveCount(0);
  await expect(page.locator("#pause")).toBeHidden();
  await choose(page, "traffic");
  await expect(page.locator("#pause")).toBeVisible();
  expect(errors).toEqual([]);
});

test("environment planning and observations fit mobile and new conditions preserve comparison rules", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?mode=lab");
  await choose(page, "environment");
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page
    .locator(".experiment-settings:not(.display-settings) summary")
    .click();
  await page.locator("#experiment-seed").selectOption("2405");
  await page.locator("#experiment-duration").selectOption("180");
  await page.locator("#new-experiment").click();
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  await expect(page.locator("[data-policy-card]")).toHaveCount(5);
  for (const id of ["housing", "conserve", "buffer"])
    await page.locator(`[data-policy="${id}"]`).check();
  await page.screenshot({
    path: "output/playwright/environment-mobile-policy.png",
    animations: "disabled",
  });
  await page.locator("#apply").click();
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  const expected = new EnvironmentSimulation(2405, [
    "housing",
    "conserve",
    "buffer",
  ]);
  expected.runUntil(180);
  expect(
    await page.evaluate(
      () => (window as any).__mayor.simulation.environmentStats,
    ),
  ).toEqual(expected.environmentStats);
  await page.locator("#close-results").click();
  await page.getByRole("button", { name: "환경 자료", exact: true }).click();
  await page.locator("#map-layer").selectOption("environment");
  await page.locator("#environment-places summary").click();
  await page.screenshot({
    path: "output/playwright/environment-mobile-map.png",
    animations: "disabled",
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
