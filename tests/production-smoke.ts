import { TrafficSimulation } from "../src/simulation";
import { createDemand, DEFAULT_POLICY } from "../src/scenario";
import { createPedestrianDemand } from "../src/simulation/pedestrians";
import { preview } from "vite";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const server = await preview({
  preview: { host: "127.0.0.1", port: 5176, strictPort: true },
});
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1.5,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/assets/main-*.js", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("http://127.0.0.1:5176/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("등굣길을 준비하고 있어요.")).toBeVisible();
  release();
  await expect(page.locator("#city-canvas")).toBeVisible();
  await page.unrouteAll();
  expect(await page.evaluate(() => (window as any).__mayor)).toBeUndefined();
  await page.locator("#help").click();
  await page.getByText("화면이 느릴 때", { exact: true }).click();
  await page.getByLabel("화면 품질", { exact: true }).selectOption("light");
  await page.locator("#close-help").click();
  await page.locator("#finish").click();
  await expect(page.locator("#mode-label")).toHaveText("시행 전 · 관찰 완료", {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  await page.locator('[data-policy-card="signal"]').click();
  await page.locator("#apply").click();
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  let json = "";
  for await (const chunk of stream) json += chunk.toString();
  const data = JSON.parse(json);
  const expectedBefore = new TrafficSimulation(
    DEFAULT_POLICY,
    createDemand(),
    undefined,
    createPedestrianDemand(),
  );
  expectedBefore.runUntil(420);
  expect(data.before).toEqual(expectedBefore.stats);
  expect(data.pedestriansBefore).toEqual(expectedBefore.pedestrians.stats);
  const expectedAfter = new TrafficSimulation(
    { ...DEFAULT_POLICY, signal: true },
    createDemand(),
    undefined,
    createPedestrianDemand(),
  );
  expectedAfter.runUntil(420);
  expect(data.after).toEqual(expectedAfter.stats);
  expect(data.pedestriansAfter).toEqual(expectedAfter.pedestrians.stats);
  expect(data.before.time).toBe(data.after.time);
  expect(errors).toEqual([]);
  const scripts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.endsWith(".js"))
      .map((entry) => new URL(entry.name).pathname),
  );
  expect(scripts.some((path) => path.includes("/main-"))).toBe(true);
  expect(scripts.some((path) => path.includes("/three-"))).toBe(true);
  const failure = await browser.newPage();
  await failure.route("**/assets/main-*.js", (route) => route.abort());
  await failure.goto("http://127.0.0.1:5176/");
  await expect(
    failure.getByRole("heading", { name: "도시를 열지 못했어요" }),
  ).toBeVisible();
  await failure.unrouteAll();
  await failure.getByRole("button", { name: "다시 열기" }).click();
  await expect(failure.locator("#city-canvas")).toBeVisible();
  await mkdir("output", { recursive: true });
  const report = {
    productionBuild: true,
    modelVersion: data.modelVersion,
    loadingView: true,
    importFailureRecovery: true,
    quality: "light",
    debugEndpointAbsent: true,
    beforeArrived: data.before.arrived,
    afterArrived: data.after.arrived,
    observationSeconds: data.after.time,
    scriptPaths: scripts,
    errors,
  };
  await writeFile("output/production.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
