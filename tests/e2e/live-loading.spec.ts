import { test, expect } from "@playwright/test";

const saved = (time: number) => ({
  version: "living-city-v1",
  seed: 2404,
  time,
  actions: [],
  notes: "보존할 조사 기록",
  observations: [],
});

test("legacy city migrates once and resumes without starting a replay worker", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((save) => {
    if (!localStorage.getItem("mayor-living-city-v1"))
      localStorage.setItem("mayor-living-city-v1", JSON.stringify(save));
  }, saved(300));
  let workers = 0;
  page.on("worker", () => workers++);
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => (window as any).__liveCity?.busy))
    .toBe(false);
  expect(workers).toBe(1);
  await page.locator("#pause").click();
  await page.locator("#save-city").click();
  const time = await page.evaluate(() => (window as any).__liveCity.time);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const request = indexedDB.open("mayor-live-state", 1);
            request.onsuccess = () => {
              const db = request.result,
                read = db
                  .transaction("checkpoints")
                  .objectStore("checkpoints")
                  .get("latest");
              read.onsuccess = () => {
                resolve(read.result?.save.time ?? -1);
                db.close();
              };
              read.onerror = () => reject(read.error);
            };
          }),
      ),
    )
    .toBe(time);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => (window as any).__liveCity?.busy))
    .toBe(false);
  expect(workers, "a matching checkpoint never replays the whole city").toBe(1);
  expect(
    await page.evaluate(() => (window as any).__liveCity.time),
  ).toBeGreaterThanOrEqual(time);
  await page.locator("#help").click();
  await page.locator("#display-quality").selectOption("light");
  expect(
    await page.evaluate(() => localStorage.getItem("mayor-display-quality")),
  ).toBe("light");
  await page.locator("#close-panel").click();
  await page.getByRole("button", { name: "조사 기록", exact: true }).click();
  await expect(page.locator("#live-notes")).toHaveValue("보존할 조사 기록");
  expect(errors).toEqual([]);
});

test("cancelling a long restore keeps the original record and export intact", async ({
  page,
}) => {
  const original = JSON.stringify(saved(86400));
  await page.addInitScript(
    (value) => localStorage.setItem("mayor-living-city-v1", value),
    original,
  );
  await page.goto("/");
  await page.locator("#cancel-load").click();
  await expect(page.locator("#live-panel-title")).toHaveText(
    "기존 기록은 그대로 있어요",
  );
  await expect(page.locator("#retry-load")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__liveCity.busy)).toBe(true);
  await page.locator("#save-city").click();
  expect(
    await page.evaluate(() => localStorage.getItem("mayor-living-city-v1")),
  ).toBe(original);
  const download = page.waitForEvent("download");
  await page.locator("#export-loading").click();
  let exported = "";
  for await (const chunk of await (await download).createReadStream())
    exported += chunk.toString();
  expect(exported).toBe(original);
});

test("unavailable worker falls back to cooperative replay; invalid records stay safe", async ({
  page,
}) => {
  await page.addInitScript((save) => {
    localStorage.setItem("mayor-living-city-v1", JSON.stringify(save));
    window.Worker = class {
      constructor() {
        throw new Error("workers unavailable");
      }
    } as any;
  }, saved(30));
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => (window as any).__liveCity?.busy))
    .toBe(false);
  expect(
    await page.evaluate(() => (window as any).__liveCity.time),
  ).toBeGreaterThanOrEqual(30);
  await page.locator("#pause").click();
  await page.evaluate(() =>
    localStorage.setItem("mayor-living-city-v1", "invalid-city-record"),
  );
  // Another navigation is unnecessary: import failure must leave even a malformed source downloadable.
  await page.locator('[data-panel-open="notebook"]').click();
  await page
    .locator("#city-file")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("invalid-city-record"),
    });
  await expect(page.locator("#live-panel-title")).toHaveText(
    "도시를 불러오지 못했어요",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("mayor-living-city-v1")),
  ).toBe("invalid-city-record");
});
