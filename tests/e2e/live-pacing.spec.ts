import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
  { width: 390, height: 600 },
])
  test(`quiet start and a narrow vertical map rail (${viewport.width}x${viewport.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#live-state")).toContainText("도시가");
    await page.locator("#pause").click();
    expect(
      await page.evaluate(() => (window as any).__liveCity.news.length),
    ).toBe(0);
    await expect(page.locator(".resident-pin:visible")).toHaveCount(0);
    await expect(page.locator(".resident-bubble")).toBeHidden();
    await expect(page.locator(".live-resident-nav")).toHaveCount(0);
    await expect(page.locator("#news-peek")).toBeHidden();

    const buttons = await page.locator(".map-layer").evaluateAll((elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width };
      }),
    );
    expect(buttons.length).toBeGreaterThan(5);
    for (let i = 0; i < buttons.length; i++) {
      expect(buttons[i].x).toBe(buttons[0].x);
      expect(buttons[i].width).toBeLessThanOrEqual(118);
      if (i) expect(buttons[i].y).toBeGreaterThanOrEqual(buttons[i - 1].y + 44);
    }
    // The last map remains reachable even on a short phone screen.
    await page.locator("#layer-population").click();
    await expect(
      page.locator('[data-layer-legend="population"]'),
    ).toBeVisible();
    await page.locator("#layer-stock").click();
    await expect(page.locator('[data-layer-legend="stock"]')).toBeVisible();
    const rail = await page.locator(".map-tools").boundingBox();
    const legend = await page.locator("#overlay-legend").boundingBox();
    const deck = await page.locator(".command-deck").boundingBox();
    expect(legend!.x).toBeGreaterThanOrEqual(rail!.x + rail!.width);
    expect(legend!.x + legend!.width).toBeLessThanOrEqual(viewport.width);
    expect(rail!.y + rail!.height).toBeLessThanOrEqual(deck!.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `output/playwright/live-rail-${viewport.width}x${viewport.height}.png`,
    });
    await page.getByRole("button", { name: "동네 소식", exact: true }).click();
    await expect(page.locator("#news-list")).toContainText(
      "아직 새 소식이 없어요",
    );
  });

for (const width of [1440, 390])
  test(`one resident story after observing, with history available (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem(
        "mayor-living-city-v1",
        JSON.stringify({
          version: "living-city-v1",
          seed: 2404,
          time: 120,
          actions: [],
          notes: "",
          observations: [],
        }),
      ),
    );
    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => (window as any).__liveCity?.busy))
      .toBe(false);
    await page.locator("#pause").click();
    await expect(page.locator(".resident-pin:visible")).toHaveCount(1);
    await expect(page.locator(".resident-bubble")).toBeVisible();
    await expect(page.locator("#news-peek")).toBeVisible();
    // Wait for label placement, then verify the story does not cover the tools.
    await expect
      .poll(async () => {
        const bubble = await page.locator(".resident-bubble").boundingBox();
        const rail = await page.locator(".map-tools").boundingBox();
        return (
          !!bubble &&
          !!rail &&
          (bubble.x >= rail.x + rail.width ||
            bubble.x + bubble.width <= rail.x ||
            bubble.y >= rail.y + rail.height ||
            bubble.y + bubble.height <= rail.y)
        );
      })
      .toBe(true);
    await page.screenshot({
      path: `output/playwright/live-story-${width}.png`,
    });
    const preview = await page.locator(".resident-bubble").boundingBox();
    expect(preview!.height).toBeLessThan(190);
    await expect(page.locator("#resident-bubble .live-story-actions")).toHaveCount(0);
    await page.locator("#read-story").focus();
    await page.locator("#read-story").press("Enter");
    await expect(page.locator(".live-story-detail")).toBeVisible();
    await expect(page.locator("#live-panel-title")).toBeFocused();
    await expect(page.locator(".resident-bubble")).toBeHidden();
    await page.locator("#close-panel").click();
    await expect(page.locator("#read-story")).toBeFocused();
    await page.getByRole("button", { name: "말풍선 닫기", exact: true }).click();
    await expect(page.locator(".resident-bubble")).toBeHidden();
    await expect(page.locator("#live-panel")).toBeHidden();
    await page.getByRole("button", { name: "동네 소식", exact: true }).click();
    await expect(page.locator(".live-news")).toHaveCount(1);
    await page.locator(".live-news").click();
    await expect(page.locator(".live-story-detail")).toBeVisible();
    expect(errors).toEqual([]);
  });
