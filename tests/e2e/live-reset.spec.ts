import { test, expect } from "@playwright/test";
import { LiveCitySimulation } from "../../src/simulation/live";

for (const width of [1440, 390])
  test(`reset clears city and checkpoint, supports backup/cancel and survives reload (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const original = new LiveCitySimulation();
    original.apply("handling");
    original.council.start("waterCare", "homes", "flexible", [
      "walker",
      "merchant",
      "worker",
    ]);
    original.runUntil(30);
    original.observe();
    original.notes = "초기화 전 조사 기록";
    await page.addInitScript((save) => {
      if (!localStorage.getItem("mayor-living-city-v1"))
        localStorage.setItem("mayor-living-city-v1", JSON.stringify(save));
    }, original.save());
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => (window as any).__liveCity?.busy))
      .toBe(false);
    await page.locator("#pause").click();
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++)
        document.querySelector<HTMLButtonElement>("#save-city")!.click();
    });
    const before = await page.evaluate(() =>
      localStorage.getItem("mayor-living-city-v1"),
    );
    await page.locator('[data-panel-open="notebook"]').click();
    await page
      .getByRole("button", { name: "저장 초기화", exact: true })
      .click();
    await expect(page.locator("#live-panel-title")).toHaveText(
      "저장한 도시를 초기화할까요?",
    );
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "초기화 전 기록 파일 저장" })
      .click();
    let backup = "";
    for await (const chunk of await (await download).createReadStream())
      backup += chunk.toString();
    expect(JSON.parse(backup)).toEqual(JSON.parse(before!));
    await page.screenshot({
      path: `output/playwright/live-reset-${width}.png`,
    });
    await page.locator("#cancel-reset").click();
    await expect(page.locator("#live-notes")).toHaveValue(
      "초기화 전 조사 기록",
    );
    expect(
      await page.evaluate(() => localStorage.getItem("mayor-living-city-v1")),
    ).toBe(before);
    expect(await page.evaluate(() => (window as any).__liveCity.paused)).toBe(
      true,
    );
    await page.locator("#help").click();
    await page
      .getByRole("button", { name: "저장 초기화", exact: true })
      .click();
    await page.getByRole("button", { name: "지우고 새로 시작" }).click();
    await expect(page.locator("#live-budget")).toHaveText("100");
    await expect
      .poll(() => page.evaluate(() => (window as any).__liveCity?.busy))
      .toBe(false);
    await page.locator("#pause").click();
    const cleared = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mayor-living-city-v1")!),
    );
    expect(cleared.actions).toEqual([]);
    expect(cleared.council).toEqual([]);
    expect(cleared.observations).toEqual([]);
    expect(cleared.notes).toBe("");
    expect(cleared.time).toBeLessThan(30);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<string>((resolve, reject) => {
              const request = indexedDB.open("mayor-live-state", 1);
              request.onsuccess = () => {
                const db = request.result,
                  read = db
                    .transaction("checkpoints")
                    .objectStore("checkpoints")
                    .get("latest");
                read.onsuccess = () => {
                  resolve(JSON.stringify(read.result?.save));
                  db.close();
                };
                read.onerror = () => reject(read.error);
              };
            }),
        ),
      )
      .toBe(JSON.stringify(cleared));
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => (window as any).__liveCity?.busy))
      .toBe(false);
    await expect(page.locator("#live-budget")).toHaveText("100");
    expect(
      await page.evaluate(() => (window as any).__liveCity.actions),
    ).toEqual([]);
    expect(
      await page.evaluate(() => (window as any).__liveCity.council),
    ).toEqual([]);
    expect(
      await page.evaluate(() => (window as any).__liveCity.time),
    ).toBeLessThan(30);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });

for (const input of ["long", "invalid"])
  test(`reset works directly from ${input} loading without resurrecting the old save`, async ({
    page,
  }) => {
    const raw =
      input === "long"
        ? JSON.stringify({ ...new LiveCitySimulation().save(), time: 86400 })
        : "invalid record";
    await page.addInitScript((value) => {
      if (!localStorage.getItem("mayor-living-city-v1"))
        localStorage.setItem("mayor-living-city-v1", value);
    }, raw);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page
      .getByRole("button", { name: "저장 초기화", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#retry-load")).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("mayor-living-city-v1")),
    ).toBe(raw);
    await page
      .getByRole("button", { name: "저장 초기화", exact: true })
      .click();
    await page.getByRole("button", { name: "지우고 새로 시작" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__liveCity?.busy))
      .toBe(false);
    await expect(page.locator("#live-budget")).toHaveText("100");
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => (window as any).__liveCity?.busy))
      .toBe(false);
    expect(
      await page.evaluate(() => (window as any).__liveCity.time),
    ).toBeLessThan(30);
    expect(errors).toEqual([]);
  });
