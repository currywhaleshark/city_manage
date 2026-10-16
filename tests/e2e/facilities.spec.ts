import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { FacilitySimulation } from "../../src/simulation/facilities";
async function choose(page: Page, id: string) {
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await expect(page.locator("[data-scenario]")).toHaveCount(8);
  await page.locator(`[data-scenario="${id}"]`).click();
}
test("facility planning connects the map, local voices, site choice, capacity results and records", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mode=lab");
  await choose(page, "facilities");
  await expect(page.locator("#mode-label")).toHaveText(
    "시설 계획 · 주민 의견 듣기",
  );
  await expect(page.locator("#pause")).toBeHidden();
  await expect(page.locator("#finish")).toBeHidden();
  await page.locator("#help").click();
  await expect(page.locator("#help-dialog ol")).toContainText(
    "계획을 바로 비교",
  );
  await expect(page.locator("#help-dialog ol")).not.toContainText("관찰 시간");
  await page.locator("#close-help").click();
  await page.getByRole("button", { name: "시설 지도", exact: true }).click();
  await page.locator("#map-layer").selectOption("access");
  await expect(page.locator(".civic-label[data-level]:visible")).toHaveCount(
    12,
  );
  await page.locator("#facility-neighborhoods summary").click();
  await expect(page.locator("[data-neighborhood]")).toHaveCount(12);
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/facility-access.png",
  });
  await page.locator('[data-neighborhood="b8"]').click();
  await expect(page.locator("#selection-detail")).toContainText("보행 경로");
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/facility-walk-route.png",
  });
  await page.getByRole("button", { name: "주민 의견", exact: true }).click();
  await expect(page.locator(".resident-pin")).toHaveCount(12);
  await expect(page.locator("#resident-bubble")).toContainText("바라는 점");
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  await page.locator('[data-policy="library"]').check();
  await page.locator('[data-policy="expand"]').check();
  await expect(page.locator('[data-policy="park"]')).toBeEnabled();
  await expect(page.locator("#budget")).toHaveText("10");
  await page.locator("#facility-site").selectOption("north");
  await page
    .locator("#decision-reason")
    .fill("북쪽 주민의 도서관 요구와 정원을 함께 봤어요.");
  await page.locator("#preview-facility-site").click();
  await expect(page.locator("#selection-title")).toHaveText(
    "A · 햇살 주거 공터",
  );
  await page.locator('[data-select-site="north"]').click();
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/facility-policy.png",
  });
  await page.locator("#apply").click();
  await expect(page.locator("#results-dialog")).toBeVisible();
  await expect(page.locator("#result-table")).toContainText(
    "가까워도 자리가 부족한 주민",
  );
  expect(
    await page.evaluate(() => (window as any).__mayor.simulation.time),
  ).toBe(0);
  const expected = new FacilitySimulation(2404, ["library", "expand"], {
    siteId: "north",
  });
  expect(
    await page.evaluate(() => (window as any).__mayor.simulation.facilityStats),
  ).toEqual(expected.facilityStats);
  await page.locator("#facility-regions-details summary").click();
  await expect(page.locator("#facility-regions-details tbody tr")).toHaveCount(
    12,
  );
  await page
    .locator("#reflection")
    .fill(
      "모든 동네의 불편이 사라진 것은 아니에요. 공원이 필요한 주민도 있어요.",
    );
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/facility-results.png",
  });
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#export").click();
  const raw = await fs.readFile((await (await downloadEvent).path())!, "utf8"),
    record = JSON.parse(raw);
  expect(record.scenarioId).toBe("facilities");
  expect(record.timeUnit).toBe("planning-round");
  expect(record.round).toBe(1);
  expect(record.facilitiesAfter).toEqual(expected.facilityStats);
  expect(record.facilityPlan.siteId).toBe("north");
  expect(record.pedestrianDemand).toHaveLength(0);
  expect(record.investigations.length).toBeGreaterThan(2);
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.locator("#print-current").click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#print-sheet")).toContainText(
    "보행 시간은 예상치",
  );
  const pdf = await page.pdf({
    path: "output/playwright/facility-worksheet.pdf",
    preferCSSPageSize: true,
  });
  expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  await page.emulateMedia({ media: "screen" });
  await page.locator("#close-results").click();
  await page.keyboard.press("Escape");
  await page.locator("#camera-reset").click();
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/facility-built.png",
  });
  await page.locator("#reset").click();
  await page.locator("#record-file").setInputFiles({
    name: "facility.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await expect(page.locator("#saved-record-content")).toContainText(
    record.reflection,
  );
  await expect(page.locator("#saved-record-content")).toContainText(
    "A · 햇살 주거 공터",
  );
  expect(
    await page.evaluate(
      () => (window as any).__mayor.simulation.facilities.length,
    ),
  ).toBe(3);
  await page.locator("#close-record").click();
  await choose(page, "waste");
  await expect(page.locator("#pause")).toBeVisible();
  await expect(page.locator(".civic-label")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__mayor.simulation.trucks.length),
  ).toBe(2);
  await choose(page, "traffic");
  await expect(page.locator("#mission-title")).toHaveText("막히는 등굣길");
  expect(errors).toEqual([]);
});

test("facility policy locations remain selectable on mobile and repeat plans preserve the same baseline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?mode=lab");
  await choose(page, "facilities");
  for (const siteId of ["north", "south"]) {
    await page
      .getByRole("button", { name: "정책 만들기", exact: true })
      .click();
    await page.locator('[data-policy="park"]').check();
    await page.locator("#facility-site").selectOption(siteId);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      animations: "disabled",
      path: `output/playwright/facility-mobile-${siteId}.png`,
    });
    await page.locator("#apply").click();
    await expect(page.locator("#results-dialog")).toBeVisible();
    expect(
      await page.evaluate(() => (window as any).__mayor.baseline.facilityStats),
    ).toEqual(new FacilitySimulation().facilityStats);
    await page.locator("#close-results").click();
  }
  await page.getByRole("button", { name: "시설 지도", exact: true }).click();
  await page.locator("#access-service").selectOption("park");
  await page.locator("#map-layer").selectOption("access");
  await page.locator("#facility-neighborhoods summary").click();
  await expect(page.locator("#facility-neighborhoods")).toContainText(
    "공원 접근성",
  );
  const panel = await page.locator("#panel-traffic").boundingBox(),
    deck = await page.locator(".command-deck").boundingBox();
  expect(panel!.y + panel!.height).toBeLessThan(deck!.y);
  await page.screenshot({
    animations: "disabled",
    path: "output/playwright/facility-mobile-map.png",
  });
});
