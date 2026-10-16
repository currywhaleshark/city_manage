import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

for (const mobile of [false, true])
  test(`expanded city and land-first construction ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mode=lab");
    await page.keyboard.press("Escape");
    await page.locator("#pause").click();
    await page.locator("#layer-land").click();
    await expect(page.locator(".plot-label:visible")).toHaveCount(6);
    await expect(page.locator(".district-label:visible")).toContainText([
      "햇살 주거지구",
      "중앙 상업지구",
      "강너머 상업지구",
      "강너머 산업지구",
      "새봄천",
      "강빛마을",
      "들녘마을",
    ]);
    expect(
      await page.evaluate(
        () => (window as any).__mayor.simulation.network.nodes.size,
      ),
    ).toBe(89);
    await page.screenshot({
      path: `output/playwright/expanded-${mobile ? "mobile" : "desktop"}.png`,
    });
    const plot = await page
      .locator(".plot-label")
      .filter({ hasText: "A ·" })
      .boundingBox();
    await page.mouse.click(
      plot!.x + plot!.width / 2,
      plot!.y + plot!.height + 5,
    );
    await expect(page.locator("#selection-title")).toContainText(
      "햇살 주거 공터",
    );
    await page.locator('[data-plan-plot="north"]').click();
    await expect(page.locator("#facility-site")).toHaveValue("north");
    await page.locator("#facility-site").selectOption("west");
    await expect(page.locator("#plot-area")).toContainText("484");
    await expect(page.locator('[data-policy="park"]')).toBeDisabled();
    await page.locator('[data-policy="library"]').check();
    await page.locator("#facility-site").selectOption("north");
    await page.locator('[data-policy="park"]').check();
    await expect(page.locator("#budget")).toHaveText("10");
    await page.locator("#planned-buildings summary").click();
    await expect(page.locator("#planned-buildings-list")).toContainText(
      "건설 예정 2곳 · 남는 공터 4곳",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `output/playwright/expanded-plan-${mobile ? "mobile" : "desktop"}.png`,
    });
    await page.locator("#apply").click();
    await expect(page.locator("#results-dialog")).toBeVisible();
    await page.locator("#facility-land-result summary").click();
    await expect(page.locator("#facility-land-result")).toContainText("4곳");
    const stats = await page.evaluate(
      () => (window as any).__mayor.simulation.facilityStats,
    );
    expect(stats.cost).toBe(90);
    expect(stats.usedPlots).toBe(2);
    expect(stats.usedLand).toBe(1384);
    expect(stats.freePlots).toBe(4);
    expect(stats.neighborhoods.length).toBeGreaterThan(7);
    const download = page.waitForEvent("download");
    await page.locator("#export").click();
    const raw = await fs.readFile((await (await download).path())!, "utf8");
    expect(JSON.parse(raw).facilityPlan.buildings).toEqual([
      { siteId: "west", kind: "library" },
      { siteId: "north", kind: "park" },
    ]);
    await page.evaluate(() => {
      window.print = () => {};
    });
    await page.locator("#print-current").click();
    await expect(page.locator("#print-sheet")).toContainText(
      "시설에 배정한 땅",
    );
    await page.locator("#close-results").click();
    await page.keyboard.press("Escape");
    await page.locator("#camera-reset").click();
    await page.screenshot({
      path: `output/playwright/expanded-built-${mobile ? "mobile" : "desktop"}.png`,
    });
    await page
      .locator("#record-file")
      .setInputFiles({
        name: "city.json",
        mimeType: "application/json",
        buffer: Buffer.from(raw),
      });
    await expect(page.locator("#saved-record-content")).toContainText(
      "B · 작은 골목 공터",
    );
    await expect(page.locator("#saved-record-content")).toContainText(
      "A · 햇살 주거 공터",
    );
    expect(errors).toEqual([]);
  });
