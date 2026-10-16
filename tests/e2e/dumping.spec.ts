import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
for (const width of [1440, 390])
  test(`investigate dumping, choose map policies and compare recurrence (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?mode=lab");
    await page.getByRole("button", { name: "동네 소식", exact: true }).click();
    await page.locator("#choose-scenario").click();
    await page.locator('[data-scenario="dumping"]').click();
    await page.locator("#pause").click();
    await expect(page.locator(".dumping-label:visible")).toHaveCount(3);
    await page.locator('[data-dumping-label="river"]').click();
    await expect(page.locator("#selection-title")).toHaveText("새봄천 산책길");
    await page.screenshot({
      path: `output/playwright/dumping-site-${width}.png`,
      animations: "disabled",
    });
    await page.locator('[data-dumping-inquiry="river"]').click();
    await page.locator('[data-inquiry-action="fact"]').click();
    const saved = await page.locator(".inquiry-fact p").innerText();
    await page
      .locator('[data-inquiry-field="hypothesis"]')
      .fill("배출 장소가 멀고, 치운 뒤에도 다시 버려요.");
    await page.locator('[data-inquiry-step="2"]').last().click();
    await page.locator('[data-inquiry-action="opinion"]').click();
    await page.locator("#inquiry-place").selectOption("vacant");
    await page.locator('[data-inquiry-action="opinion"]').click();
    await page.locator('[data-inquiry-action="voices"]').click();
    await expect(page.locator(".resident-pin:visible")).toHaveCount(3);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "우리 동네 조사", exact: true })
      .click();
    await page.locator('[data-inquiry-step="3"]').last().click();
    await page.locator('[data-evidence="1"]').check();
    await page
      .locator('[data-inquiry-field="reason"]')
      .fill("하천변을 치우고 가까운 배출 장소를 마련해요.");
    await page
      .locator('[data-inquiry-field="alternative"]')
      .fill("청소만 하면 재발할 수 있어요.");
    await page.locator('[data-inquiry-action="policy"]').click();
    await page.locator('[data-policy="cleanup"]').check();
    await expect(page.locator(".placement-pin:visible")).toHaveCount(3);
    await page.locator('[data-placement-target="river"]').click();
    await page.locator('[data-policy="dropoff"]').check();
    await page.screenshot({
      path: `output/playwright/dumping-placement-${width}.png`,
      animations: "disabled",
    });
    await page.locator('[data-placement-target="river"]').click();
    await expect(page.locator("#budget")).toHaveText("20");
    await expect(page.locator('[data-policy="outreach"]')).toBeDisabled();
    await page.locator("#apply").click();
    await expect(page.locator("[data-panel]:visible")).toHaveCount(0, {
      timeout: 60000,
    });
    await page.locator("#pause").click();
    await page
      .getByRole("button", { name: "쓰레기 현황", exact: true })
      .click();
    await page.locator("#next-dumping-round").click();
    await expect(page.locator("#next-dumping-round")).toBeEnabled({
      timeout: 60000,
    });
    expect(
      await page.evaluate(() => (window as any).__mayor.simulation.time),
    ).toBe(300);
    await expect(page.locator("#pause")).toHaveAttribute("aria-label", "재생");
    await page.locator("#next-dumping-round").click();
    await expect(page.locator("#next-dumping-round")).toBeEnabled({
      timeout: 60000,
    });
    expect(
      await page.evaluate(() => (window as any).__mayor.simulation.time),
    ).toBe(600);
    await page.locator("#next-dumping-round").click();
    await expect(page.locator("#results-dialog")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.locator("#result-table")).toContainText(
      "청소 뒤 다시 버린 양",
    );
    await expect(page.locator("#result-table")).toContainText(
      "지정 장소에서 넘친 양",
    );
    await page.locator("#dumping-round-results summary").click();
    await page.screenshot({
      path: `output/playwright/dumping-results-${width}.png`,
      animations: "disabled",
    });
    await page.locator("#review-inquiry").click();
    await page.locator('[data-inquiry-step="5"]').last().click();
    await page
      .locator('[data-inquiry-field="proposal"]')
      .fill("배출함 넘침과 다른 수거장도 함께 살펴봐요.");
    await page.keyboard.press("Escape");
    await page.locator("#show-results").click();
    const download = page.waitForEvent("download");
    await page.locator("#export").click();
    const raw = await fs.readFile((await (await download).path())!, "utf8"),
      data = JSON.parse(raw);
    expect(data.schemaVersion).toBe(6);
    expect(data.dumpingPlan.dropoff).toBe("river");
    expect(data.inquiry.evidence[0].text).toBe(saved);
    expect(data.dumpingAfter.repeatDumped).toBeGreaterThan(0);
    expect(data.dumpingAfter.overflow).toBeGreaterThan(0);
    expect(data.dumpingRoundsAfter).toHaveLength(3);
    await page.evaluate(() => {
      window.print = () => {};
    });
    await page.locator("#print-current").click();
    await expect(page.locator("#print-sheet")).toContainText(saved);
    await expect(page.locator("#print-sheet")).toContainText(
      "배출함 넘침과 다른 수거장",
    );
    await page.locator("#close-results").click();
    await page
      .locator("#record-file")
      .setInputFiles({
        name: "dumping.json",
        mimeType: "application/json",
        buffer: Buffer.from(raw),
      });
    await expect(page.locator("#record-dialog")).toBeVisible();
    await expect(page.locator("#saved-record-content")).toContainText(
      "관찰 3차",
    );
    await page.locator("#close-record").click();
    await page.keyboard.press("Escape");
    await page.locator("#camera-reset").click();
    await page.screenshot({
      path: `output/playwright/dumping-city-${width}.png`,
      animations: "disabled",
    });
    await page.locator("#reset").click();
    expect(
      await page.evaluate(
        () => (window as any).__mayor.simulation.rounds.length,
      ),
    ).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
