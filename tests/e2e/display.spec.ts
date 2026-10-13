import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });

test("display quality changes drawing only, persists, and restores shadows", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.locator("#finish").click();
  await expect(page.locator("#mode-label")).toHaveText("시행 전 · 관찰 완료", {
    timeout: 60000,
  });
  const before = await page.evaluate(
    () => (window as any).__mayor.simulation.stats,
  );
  const pedestrianBefore = await page.evaluate(
    () => (window as any).__mayor.simulation.pedestrians.stats,
  );
  await page.screenshot({
    path: "output/playwright/quality-normal.png",
    animations: "disabled",
  });
  await page.locator("#help").click();
  await expect(page.locator("#display-quality")).toBeHidden();
  await page.getByText("화면이 느릴 때", { exact: true }).click();
  for (const quality of ["light", "normal", "light"]) {
    await page.getByLabel("화면 품질", { exact: true }).selectOption(quality);
    const state = await page.evaluate(() => ({
      display: (window as any).__mayor.displaySettings,
      stats: (window as any).__mayor.simulation.stats,
      pedestrians: (window as any).__mayor.simulation.pedestrians.stats,
    }));
    expect(state.stats).toEqual(before);
    expect(state.pedestrians).toEqual(pedestrianBefore);
    expect(state.display).toMatchObject({
      quality,
      shadows: quality === "normal",
      pixelRatio: quality === "normal" ? 1.5 : 1,
      maxFPS: quality === "normal" ? 60 : 30,
    });
    expect(state.display.width).toBe(1280 * state.display.pixelRatio);
    await page.waitForTimeout(120);
  }
  await page.screenshot({
    path: "output/playwright/display-settings.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(page.locator("#help")).toBeFocused();
  await page.screenshot({
    path: "output/playwright/quality-light.png",
    animations: "disabled",
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__mayor?.displaySettings.quality),
    )
    .toBe("light");
  await page.locator("#finish").click();
  await expect(page.locator("#mode-label")).toHaveText("시행 전 · 관찰 완료", {
    timeout: 60000,
  });
  expect(
    await page.evaluate(() => (window as any).__mayor.simulation.stats),
  ).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#help").click();
  await page.getByText("화면이 느릴 때", { exact: true }).click();
  await expect(page.getByLabel("화면 품질", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/playwright/display-mobile.png",
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("blocked preference storage does not prevent drawing or quality changes", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage unavailable", "SecurityError");
      },
    }),
  );
  await page.goto("/");
  await page.locator("#help").click();
  await page.getByText("화면이 느릴 때", { exact: true }).click();
  await page.getByLabel("화면 품질", { exact: true }).selectOption("light");
  expect(
    await page.evaluate(() => (window as any).__mayor.displaySettings.quality),
  ).toBe("light");
  await page.locator("#close-help").click();
  await expect(page.locator("#city-canvas")).toBeVisible();
});
