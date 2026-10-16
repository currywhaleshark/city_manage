import { test, expect, type Page } from "@playwright/test";

async function chooseScenario(page: Page, id: string) {
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await page.locator(`[data-scenario="${id}"]`).click();
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
}

async function checkPlacementLayout(page: Page, count: number) {
  await expect(page.locator(".placement-pin:visible")).toHaveCount(count);
  await expect(page.locator("[data-panel]:visible")).toHaveCount(0);
  await expect(async () => {
    const boxes = await page
      .locator(".placement-banner,.placement-pin")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        }),
      );
    const viewport = page.viewportSize()!;
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.right).toBeLessThanOrEqual(viewport.width);
      expect(a.bottom).toBeLessThanOrEqual(viewport.height);
      for (const b of boxes.slice(i + 1))
        expect(
          Math.min(a.right, b.right) > Math.max(a.x, b.x) + 1 &&
            Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y) + 1,
        ).toBe(false);
    }
    const groundIsClear = await page
      .locator("#placement-map")
      .evaluate((root) => {
        const r = root.getBoundingClientRect();
        return Array.from(root.querySelectorAll("svg line")).every(
          (line) =>
            document.elementFromPoint(
              r.x + Number(line.getAttribute("x1")),
              r.y + Number(line.getAttribute("y1")),
            )?.id === "city-canvas",
        );
      });
    expect(groundIsClear).toBe(true);
  }).toPass({ timeout: 3000 });
}

for (const width of [1440, 390])
  test(`choose policy locations on the map and cancel safely (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?mode=lab");
    await chooseScenario(page, "parking");
    await page.locator('[data-policy="patrol"]').check();
    await checkPlacementLayout(page, 3);
    await expect(page.locator("#pause")).toBeDisabled();
    await expect(page.locator("#budget")).toHaveText("100");
    const time = await page.evaluate(
      () => (window as any).__mayor.simulation.time,
    );
    await page.keyboard.press("Space");
    await page.screenshot({
      path: `output/playwright/placement-sites-${width}.png`,
    });
    expect(
      await page.evaluate(() => (window as any).__mayor.simulation.time),
    ).toBe(time);
    await page.locator('[data-placement-target="homes"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#parking-locations")).toContainText(
      "주거지 골목",
    );
    await expect(page.locator("#budget")).toHaveText("70");
    await expect(page.locator(".applied-policy-pin")).toHaveCount(0);
    await expect(page.locator("#pause")).toBeEnabled();

    await page.locator('[data-pick-location="patrol"]').click();
    await expect(
      page.locator('[data-placement-target="homes"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#placement-map")).toHaveCount(0);
    await expect(page.locator("#parking-locations")).toContainText(
      "주거지 골목",
    );
    await page.locator('[data-policy="loadingBay"]').check();
    await checkPlacementLayout(page, 2);
    await expect(page.locator('[data-placement-target="homes"]')).toHaveCount(
      0,
    );
    await page.locator("#cancel-placement").click();
    await expect(page.locator('[data-policy="loadingBay"]')).not.toBeChecked();
    await expect(page.locator("#budget")).toHaveText("70");

    await page.locator('[data-policy="parkingLot"]').check();
    await checkPlacementLayout(page, 6);
    await page.screenshot({
      path: `output/playwright/placement-plots-${width}.png`,
    });
    // The connector starts at the actual ground marker. Clicking there exercises ray picking.
    const anchor = await page.locator("#placement-map").evaluate((root) => {
      const index = Array.from(
        root.querySelectorAll<HTMLElement>("[data-placement-target]"),
      ).findIndex((el) => el.dataset.placementTarget === "north");
      const line = root.querySelectorAll("svg line")[index],
        r = root.getBoundingClientRect();
      return {
        x: r.x + Number(line.getAttribute("x1")),
        y: r.y + Number(line.getAttribute("y1")),
      };
    });
    await page.mouse.click(anchor.x, anchor.y);
    await expect(page.locator("#parking-locations")).toContainText(
      "햇살 주거 공터",
    );
    await expect(page.locator("#budget")).toHaveText("15");
    await expect(page.locator('[data-policy="loadingBay"]')).toBeDisabled();
    await page.screenshot({
      animations: "disabled",
      path: `output/playwright/placement-plan-${width}.png`,
    });
    await page.locator("#apply").click();
    await expect(page.locator("[data-panel]:visible")).toHaveCount(0, {
      timeout: 60000,
    });
    await page.locator("#pause").click();
    expect(
      await page.evaluate(
        () => (window as any).__mayor.simulation.plan.patrolSite,
      ),
    ).toBe("homes");
    await page
      .getByRole("button", { name: "정책 만들기", exact: true })
      .click();
    await page.locator('[data-pick-location="patrol"]').click();
    await page.locator('[data-placement-target="school"]').click();
    await expect(page.locator("#parking-locations")).toContainText("학교 앞");
    expect(
      await page.evaluate(
        () => (window as any).__mayor.simulation.plan.patrolSite,
      ),
    ).toBe("homes");
    await expect(page.locator("#pause")).toHaveAttribute("aria-label", "재생");
    await page.locator('[data-pick-location="parkingLot"]').click();
    await page.locator("#reset").click();
    await expect(page.locator("#placement-map")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveAttribute(
      "data-placing-policy",
    );
    expect(errors).toEqual([]);
  });

test("facility plans share the map plot picker and retain land constraints", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?mode=lab");
  await chooseScenario(page, "facilities");
  await page.locator("#pick-facility-plot").click();
  await checkPlacementLayout(page, 6);
  await page.locator('[data-placement-target="west"]').click();
  await expect(page.locator("#facility-site")).toHaveValue("west");
  await expect(page.locator("#plot-area")).toContainText("484");
  await expect(page.locator('[data-policy="park"]')).toBeDisabled();
  await page.locator('[data-policy="library"]').check();
  await page.locator("#pick-facility-plot").click();
  await expect(page.locator('[data-placement-target="west"]')).toContainText(
    "도서관 예정",
  );
  await page.locator('[data-placement-target="north"]').click();
  await page.locator('[data-policy="park"]').check();
  await expect(page.locator("#budget")).toHaveText("10");
  await page.locator("#apply").click();
  await expect(page.locator("#results-dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).__mayor.simulation.facilityStats.usedPlots,
    ),
  ).toBe(2);
});
