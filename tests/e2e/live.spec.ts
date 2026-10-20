import { test, expect } from "@playwright/test";

for (const width of [1440, 390])
  test(`continuous city, map policy, reaction and resume (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.locator("#live-state")).toContainText("도시가");
    await expect
      .poll(() => page.evaluate(() => (window as any).__liveCity?.time))
      .toBeGreaterThan(5);
    await page.locator("#pause").click();
    const before = await page.evaluate(() => (window as any).__liveCity.time);
    await page
      .getByRole("button", { name: "정책 만들기", exact: true })
      .click();
    await page.locator('[data-live-policy="patrol"]').click();
    await expect(page.locator(".placement-pin:visible")).toHaveCount(3);
    await page.locator('[data-placement-target="homes"]').click();
    await page
      .locator("#live-reason")
      .fill("주거지 길을 비워 수거차도 다니게 해요.");
    await page.locator("#apply-live-policy").click();
    await expect(page.locator("#live-budget")).toHaveText("70");
    expect(await page.evaluate(() => (window as any).__liveCity.time)).toBe(
      before,
    );
    await expect(
      page.locator('[data-policy-place="live-patrol-homes"]'),
    ).toBeVisible();
    for (const layer of ["waste", "water", "stock", "access"]) {
      await page.locator("#layer-" + layer).click();
      await expect(
        page.locator(`[data-layer-legend="${layer}"]`),
      ).toBeVisible();
    }
    await page.getByRole("button", { name: "조사 기록", exact: true }).click();
    await page.locator("#capture-observation").click();
    await page
      .locator("#live-notes")
      .fill("지금은 주거지 주차를 살펴보고 다음에는 하천을 조사해요.");
    await page.locator("#close-panel").click();
    if (width <= 700) await page.locator("#city-options-toggle").click();
    await page.locator("#speed").selectOption("8");
    await page.locator("#pause").click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as any).__liveCity.news.some(
              (n: any) => n.type === "reaction",
            ),
          ),
        { timeout: 90000 },
      )
      .toBe(true);
    await page.locator("#pause").click();
    if (width <= 700) await page.locator("#city-options-toggle").click();
    await page.locator("#save-city").click();
    const elapsed = await page.evaluate(() => (window as any).__liveCity.time);
    await page.screenshot({ path: `output/playwright/live-city-${width}.png` });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => (window as any).__liveCity?.busy), {
        timeout: 60000,
      })
      .toBe(false);
    await expect(page.locator("#live-budget")).toHaveText("70");
    expect(
      await page.evaluate(() => (window as any).__liveCity.time),
    ).toBeGreaterThanOrEqual(elapsed);
    await page.getByRole("button", { name: "조사 기록", exact: true }).click();
    await expect(page.locator("#live-notes")).toHaveValue(
      "지금은 주거지 주차를 살펴보고 다음에는 하천을 조사해요.",
    );
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
