import { WaterSimulation } from "../src/simulation/water";
import { TrafficSimulation } from "../src/simulation";
import { createDemand, DEFAULT_POLICY } from "../src/scenario";
import { createPedestrianDemand } from "../src/simulation/pedestrians";
import { WasteSimulation } from "../src/simulation/services/waste";
import { DumpingSimulation } from "../src/simulation/services/dumping";
import { FacilitySimulation } from "../src/simulation/facilities";
import { EnvironmentSimulation } from "../src/simulation/environment";
import { LogisticsSimulation } from "../src/simulation/economy";
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
  await page.goto("http://127.0.0.1:5176/?mode=lab", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("새봄동을 준비하고 있어요.")).toBeVisible();
  release();
  await expect(page.locator("#city-canvas")).toBeVisible();
  await page.unrouteAll();
  expect(await page.evaluate(() => (window as any).__mayor)).toBeUndefined();
  await page.locator("#help").click();
  await page.getByText("화면이 느릴 때", { exact: true }).click();
  await page.getByLabel("화면 품질", { exact: true }).selectOption("light");
  await page.locator("#close-help").click();
  async function checkResidentMap(count: number) {
    await page.getByRole("button", { name: "주민 의견", exact: true }).click();
    await expect(page.locator(".resident-pin:visible")).toHaveCount(count);
    await expect(page.locator("#resident-bubble")).toBeVisible();
    await page.locator("#resident-next").click();
    await expect(page.locator("#resident-count")).toHaveText(`2 / ${count}`);
    await page.locator("#resident-evidence summary").click();
    await expect(page.locator("#resident-fact")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#resident-map")).toBeHidden();
  }
  await checkResidentMap(2);
  const mapLayers: string[] = [];
  async function checkMapLayer(layer: string, buttonId = `layer-${layer}`) {
    await page.locator(`#${buttonId}`).click();
    await expect(page.locator("#map-layer")).toHaveValue(layer);
    await expect(page.locator(`[data-layer-legend="${layer}"]`)).toBeVisible();
    await expect(
      page.locator("[data-map-layer][aria-pressed=true]"),
    ).toHaveCount(1);
    if (layer === "waste")
      await expect(
        page.locator('.facility-data[data-layer="waste"]:visible'),
      ).toHaveCount(6);
    if (layer === "stock")
      await expect(page.locator(".stock-label:visible")).toHaveCount(4);
    if (layer === "access") {
      await page.locator('[data-access-service="park"]').click();
      await expect(page.locator("#access-service")).toHaveValue("park");
      await expect(
        page.locator(".civic-label[data-level]:visible"),
      ).toHaveCount(12);
    }
    mapLayers.push(layer);
    await page.locator(`#${buttonId}`).click();
    await expect(page.locator("#overlay-legend")).toBeHidden();
  }
  await checkMapLayer("traffic", "overlay");
  const appliedPolicyCounts: { local: number; shared: number }[] = [];
  async function checkAppliedPolicies(local: number, shared: number) {
    await expect(page.locator(".applied-policy-pin:visible")).toHaveCount(
      local,
    );
    await expect(page.locator("[data-shared-policy]:visible")).toHaveCount(
      shared,
    );
    const first = local
      ? page.locator(".applied-policy-pin").first()
      : page.locator("[data-shared-policy]").first();
    await first.click();
    await expect(page.locator("#selection-description")).toContainText(
      "시행한 정책",
    );
    await expect(page.locator(".applied-policy-detail")).not.toHaveCount(0);
    await page.keyboard.press("Escape");
    appliedPolicyCounts.push({ local, shared });
  }
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
  await page.locator("#close-results").click();
  await checkAppliedPolicies(1, 0);
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await page.locator('[data-scenario="waste"]').click();
  await checkMapLayer("waste");
  await checkResidentMap(6);
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  await page.locator('[data-policy="extraTruck"]').check();
  await page.locator("#apply").click();
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  const wasteDownload = page.waitForEvent("download");
  await page.locator("#export").click();
  const wasteStream = await (await wasteDownload).createReadStream();
  let wasteJSON = "";
  for await (const chunk of wasteStream) wasteJSON += chunk.toString();
  const waste = JSON.parse(wasteJSON);
  const wasteBefore = new WasteSimulation(),
    wasteAfter = new WasteSimulation(2404, ["extraTruck"]);
  wasteBefore.runUntil(600);
  wasteAfter.runUntil(600);
  expect(waste.wasteBefore).toEqual(wasteBefore.wasteStats);
  expect(waste.wasteAfter).toEqual(wasteAfter.wasteStats);
  expect(waste.schemaVersion).toBe(5);
  expect(waste.serviceTrucks).toHaveLength(3);
  await page.locator("#close-results").click();
  await checkAppliedPolicies(0, 1);
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await page.locator('[data-scenario="facilities"]').click();
  await checkMapLayer("access");
  await checkResidentMap(12);
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  await page.locator('[data-policy="expand"]').check();
  await page.locator('[data-policy="gate"]').check();
  await page.locator("#apply").click();
  await expect(page.locator("#results-dialog")).toBeVisible();
  const facilityDownload = page.waitForEvent("download");
  await page.locator("#export").click();
  let facilityJSON = "";
  for await (const chunk of await (await facilityDownload).createReadStream())
    facilityJSON += chunk.toString();
  const facility = JSON.parse(facilityJSON);
  expect(facility.facilitiesBefore).toEqual(
    new FacilitySimulation().facilityStats,
  );
  expect(facility.facilitiesAfter).toEqual(
    new FacilitySimulation(2404, ["expand", "gate"]).facilityStats,
  );
  expect(facility.timeUnit).toBe("planning-round");
  await page.locator("#close-results").click();
  await checkAppliedPolicies(1, 0);
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await page.locator('[data-scenario="environment"]').click();
  await checkMapLayer("environment");
  await checkResidentMap(4);
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  for (const id of ["industry", "buffer"])
    await page.locator(`[data-policy="${id}"]`).check();
  await page.locator("#apply").click();
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  const environmentDownload = page.waitForEvent("download");
  await page.locator("#export").click();
  let environmentJSON = "";
  for await (const chunk of await (
    await environmentDownload
  ).createReadStream())
    environmentJSON += chunk.toString();
  const environment = JSON.parse(environmentJSON),
    environmentBefore = new EnvironmentSimulation(),
    environmentAfter = new EnvironmentSimulation(2404, ["industry", "buffer"]);
  environmentBefore.runUntil(420);
  environmentAfter.runUntil(420);
  expect(environment.environmentBefore).toEqual(
    environmentBefore.environmentStats,
  );
  expect(environment.environmentAfter).toEqual(
    environmentAfter.environmentStats,
  );
  expect(environment.addedDemandAfter).toHaveLength(48);
  expect(environment.backgroundDemand).toHaveLength(140);
  await page.locator("#close-results").click();
  await checkAppliedPolicies(2, 0);
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await page.locator('[data-scenario="logistics"]').click();
  await checkMapLayer("stock");
  await checkResidentMap(5);
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  for (const id of ["cargoTruck", "handling", "diversify"])
    await page.locator(`[data-policy="${id}"]`).check();
  await page.locator("#apply").click();
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  const logisticsDownload = page.waitForEvent("download");
  await page.locator("#export").click();
  let logisticsJSON = "";
  for await (const chunk of await (await logisticsDownload).createReadStream())
    logisticsJSON += chunk.toString();
  const logistics = JSON.parse(logisticsJSON),
    logisticsBefore = new LogisticsSimulation(),
    logisticsAfter = new LogisticsSimulation(2404, [
      "cargoTruck",
      "handling",
      "diversify",
    ]);
  logisticsBefore.runUntil(600);
  logisticsAfter.runUntil(600);
  expect(logistics.logisticsBefore).toEqual(logisticsBefore.logisticsStats);
  expect(logistics.logisticsAfter).toEqual(logisticsAfter.logisticsStats);
  expect(logistics.cargoTrucks).toHaveLength(3);
  await page.locator("#close-results").click();
  await checkAppliedPolicies(2, 1);
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await page.locator('[data-scenario="parking"]').click();
  await checkResidentMap(3);
  await page
    .getByRole("button", { name: "우리 동네 조사", exact: true })
    .click();
  await page.locator('[data-inquiry-step="1"]').last().click();
  await page.locator('[data-inquiry-action="fact"]').click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  await page.locator('[data-policy="patrol"]').check();
  await page.locator('[data-placement-target="school"]').click();
  await page.locator('[data-policy="loadingBay"]').check();
  await page.locator('[data-placement-target="market"]').click();
  await page.locator("#apply").click();
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  const parkingDownload = page.waitForEvent("download");
  await page.locator("#export").click();
  let parkingJSON = "";
  for await (const chunk of await (await parkingDownload).createReadStream())
    parkingJSON += chunk.toString();
  const parking = JSON.parse(parkingJSON),
    parkingAfter = new ParkingSimulation(2404, ["patrol", "loadingBay"]);
  parkingAfter.runUntil(420);
  expect(parking.parkingAfter).toEqual(parkingAfter.parkingStats);
  expect(parking.inquiry.evidence).toHaveLength(1);
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.locator("#print-current").click();
  await expect(page.locator("#print-sheet")).toContainText("우리의 조사 수첩");
  await page.locator("#close-results").click();
  await checkAppliedPolicies(2, 0);
  await page.locator("#record-file").setInputFiles({
    name: "parking.json",
    mimeType: "application/json",
    buffer: Buffer.from(parkingJSON),
  });
  await expect(page.locator("#saved-record-content")).toContainText("학교 앞");
  await page.locator("#close-record").click();
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await page.locator('[data-scenario="dumping"]').click();
  await checkResidentMap(3);
  await page
    .getByRole("button", { name: "우리 동네 조사", exact: true })
    .click();
  await page.locator('[data-inquiry-step="1"]').last().click();
  await page.locator('[data-inquiry-action="fact"]').click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  for (const id of ["cleanup", "dropoff"]) {
    await page.locator(`[data-policy="${id}"]`).check();
    await page.locator('[data-placement-target="river"]').click();
  }
  await page.locator("#apply").click();
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  const dumpingDownload = page.waitForEvent("download");
  await page.locator("#export").click();
  let dumpingJSON = "";
  for await (const chunk of await (await dumpingDownload).createReadStream())
    dumpingJSON += chunk.toString();
  const dumping = JSON.parse(dumpingJSON),
    dumpingExpected = new DumpingSimulation(2404, ["cleanup", "dropoff"]);
  dumpingExpected.runUntil(900);
  expect(dumping.schemaVersion).toBe(6);
  expect(dumping.dumpingAfter).toEqual(dumpingExpected.dumpingStats);
  expect(dumping.dumpingAfter.repeatDumped).toBeGreaterThan(0);
  await page.locator("#print-current").click();
  await expect(page.locator("#print-sheet")).toContainText(
    "청소 뒤 다시 버린 양",
  );
  await page.locator("#close-results").click();
  await checkAppliedPolicies(1, 0);
  await page.locator("#record-file").setInputFiles({
    name: "dumping.json",
    mimeType: "application/json",
    buffer: Buffer.from(dumpingJSON),
  });
  await expect(page.locator("#saved-record-content")).toContainText("관찰 3차");
  await page.locator("#close-record").click();
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await page.locator('[data-scenario="water"]').click();
  await checkResidentMap(3);
  // Water opens with its own layer selected; exercise both directions.
  await page.locator("#layer-water").click();
  await checkMapLayer("water");
  await page
    .getByRole("button", { name: "우리 동네 조사", exact: true })
    .click();
  await page.locator('[data-inquiry-step="1"]').last().click();
  await page.locator('[data-inquiry-action="fact"]').click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  for (const [id, target] of [
    ["outlet", "factoryNorth"],
    ["sewer", "riverside"],
  ]) {
    await page.locator(`[data-policy="${id}"]`).check();
    await page.locator(`[data-placement-target="${target}"]`).click();
  }
  await page.locator("#apply").click();
  await page.locator("#finish").click();
  await expect(page.locator("#results-dialog")).toBeVisible({ timeout: 60000 });
  const waterDownload = page.waitForEvent("download");
  await page.locator("#export").click();
  let waterJSON = "";
  for await (const chunk of await (await waterDownload).createReadStream())
    waterJSON += chunk.toString();
  const water = JSON.parse(waterJSON),
    waterExpected = new WaterSimulation(2404, ["outlet", "sewer"]);
  waterExpected.runUntil(900);
  expect(water.schemaVersion).toBe(7);
  expect(water.waterAfter).toEqual(waterExpected.waterStats);
  expect(water.waterRoundsAfter[0].levels[2]).toBe(
    water.waterRoundsBefore[0].levels[2],
  );
  expect(water.waterAfter.sites[2].level).toBeLessThan(
    water.waterBefore.sites[2].level,
  );
  await page.locator("#print-current").click();
  await expect(page.locator("#print-sheet")).toContainText(
    "지도 밖 하류로 나간 오염",
  );
  await page.locator("#close-results").click();
  await checkAppliedPolicies(2, 0);
  await page.locator("#record-file").setInputFiles({
    name: "water.json",
    mimeType: "application/json",
    buffer: Buffer.from(waterJSON),
  });
  await expect(page.locator("#saved-record-content")).toContainText("관찰 3차");
  await page.locator("#close-record").click();
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
  await failure.goto("http://127.0.0.1:5176/?mode=lab");
  await expect(
    failure.getByRole("heading", { name: "도시를 열지 못했어요" }),
  ).toBeVisible();
  await failure.unrouteAll();
  await failure.getByRole("button", { name: "다시 열기" }).click();
  await expect(failure.locator("#city-canvas")).toBeVisible();
  const living = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  living.on("pageerror", (e) => errors.push(e.message));
  await living.goto("http://127.0.0.1:5176/");
  await expect(living.locator("#live-state")).toContainText("도시가");
  await expect(living.locator("#clock")).not.toHaveText("0:00");
  await living.locator("#pause").click();
  await expect(living.locator("#pause")).toHaveAttribute(
    "aria-label",
    "계속하기",
  );
  const livingTime = await living.locator("#clock").textContent();
  await living
    .getByRole("button", { name: "정책 만들기", exact: true })
    .click();
  await living.locator("#policy-topic").selectOption("supply");
  await living.locator('[data-live-policy="handling"]').click();
  await living.locator("#apply-live-policy").click();
  await expect(living.locator("#live-budget")).toHaveText("80");
  await expect(living.locator("#clock")).toHaveText(livingTime!);
  await expect(living.locator("#applied-shared")).toContainText(
    "상점 하역 개선",
  );
  expect(
    await living.evaluate(() => (window as any).__liveCity),
  ).toBeUndefined();
  await living.locator('[data-panel-open="news"]').click();
  await living
    .getByRole("button", { name: "주민 회의 열기", exact: true })
    .click();
  await living.locator('[data-community-project="walking"]').click();
  await living.locator("#cancel-placement").click();
  await expect(living.locator("#live-budget")).toHaveText("80");
  await expect(living.locator("#clock")).toHaveText(livingTime!);
  await living.locator('[data-community-project="walking"]').click();
  await living.locator('[data-placement-target="school"]').click();
  for (let i = 0; i < 3; i++) await living.locator("#community-next").click();
  await living.locator('[data-community-method="together"]').click();
  await living.locator("#start-community").click();
  await expect(living.locator("#live-budget")).toHaveText("75");
  await expect(living.locator("#clock")).toHaveText(livingTime!);
  await expect(
    living.locator('[data-policy-place="community-walking-school"]'),
  ).toBeVisible();
  const participation = await living.evaluate(
    () => JSON.parse(localStorage.getItem("mayor-living-city-v1")!).council[0],
  );
  expect(participation.heard).toEqual(["child", "driver", "worker"]);
  expect(participation.policyCount).toBe(1);
  await living.screenshot({ path: "output/playwright/live-production.png" });
  // Verify the built module worker and its persisted checkpoint, not only dev imports.
  const resumeFixture = await living.evaluate(() => {
    const save = JSON.parse(localStorage.getItem("mayor-living-city-v1")!);
    save.time = 300;
    return JSON.stringify(save);
  });
  await living.close();
  const resuming = await browser.newPage();
  resuming.on("pageerror", (e) => errors.push(e.message));
  let restoreWorkers = 0;
  resuming.on("worker", () => restoreWorkers++);
  await resuming.addInitScript((value) => {
    if (!localStorage.getItem("mayor-living-city-v1"))
      localStorage.setItem("mayor-living-city-v1", value);
  }, resumeFixture);
  await resuming.goto("http://127.0.0.1:5176/");
  await expect(resuming.locator("#live-state")).toHaveText(
    "도시가 살아가고 있어요",
    { timeout: 60000 },
  );
  await expect(resuming.locator("#live-budget")).toHaveText("95");
  expect(restoreWorkers).toBe(1);
  await resuming.locator("#pause").click();
  await resuming.locator("#save-city").click();
  await resuming.waitForTimeout(500);
  await resuming.reload();
  await expect(resuming.locator("#live-state")).toHaveText(
    "도시가 살아가고 있어요",
    { timeout: 60000 },
  );
  await expect(resuming.locator("#live-budget")).toHaveText("95");
  expect(restoreWorkers).toBe(1);
  await resuming.close();
  expect(errors).toEqual([]);
  await mkdir("output", { recursive: true });
  const report = {
    productionBuild: true,
    livingCity: {
      defaultEntry: true,
      timePreserved: true,
      sharedPolicy: true,
      budget: 75,
      communityMeeting: true,
      participationOnMap: true,
      workerRestore: true,
      checkpointResume: true,
    },
    water: {
      modelVersion: water.waterModelVersion,
      downstreamBefore: water.waterBefore.sites[2].level,
      downstreamAfter: water.waterAfter.sites[2].level,
      treated: water.waterAfter.treated,
      outflow: water.waterAfter.outflow,
      firstRoundDownstreamUnchanged:
        water.waterRoundsAfter[0].levels[2] ===
        water.waterRoundsBefore[0].levels[2],
      rounds: water.waterRoundsAfter.length,
    },
    dumping: {
      modelVersion: dumping.dumpingModelVersion,
      illegalRemainingBefore: dumping.dumpingBefore.illegalRemaining,
      illegalRemainingAfter: dumping.dumpingAfter.illegalRemaining,
      repeatDumped: dumping.dumpingAfter.repeatDumped,
      overflow: dumping.dumpingAfter.overflow,
      rounds: dumping.dumpingRoundsAfter.length,
    },
    parking: {
      modelVersion: parking.parkingModelVersion,
      illegalSecondsBefore: parking.parkingBefore.illegalSeconds,
      illegalSecondsAfter: parking.parkingAfter.illegalSeconds,
      inquiryEvidence: parking.inquiry.evidence.length,
    },
    mapLayers,
    residentMap: {
      scenarioCounts: [2, 6, 12, 4, 5, 3, 3, 3],
      oneExpandedBubble: true,
    },
    appliedPolicyMap: appliedPolicyCounts,
    logistics: {
      modelVersion: logistics.logisticsModelVersion,
      deliveredBefore: logistics.logisticsBefore.delivered,
      deliveredAfter: logistics.logisticsAfter.delivered,
      unmetBefore: logistics.logisticsBefore.unmet,
      unmetAfter: logistics.logisticsAfter.unmet,
      trucks: logistics.cargoTrucks.length,
      observationSeconds: logistics.duration,
    },
    environment: {
      modelVersion: environment.environmentModelVersion,
      developedArea: environment.environmentAfter.developedArea,
      greenArea: environment.environmentAfter.greenArea,
      addedTrips: environment.environmentAfter.addedTrips,
      meanBurdenBefore: environment.environmentBefore.meanBurden,
      meanBurdenAfter: environment.environmentAfter.meanBurden,
      observationSeconds: environment.duration,
    },
    facilities: {
      servedBefore: facility.facilitiesBefore.served,
      servedAfter: facility.facilitiesAfter.served,
      modelVersion: facility.facilityModelVersion,
      timeUnit: facility.timeUnit,
    },
    waste: {
      schemaVersion: waste.schemaVersion,
      collectionRateBefore: waste.wasteBefore.collectionRate,
      collectionRateAfter: waste.wasteAfter.collectionRate,
      trucks: waste.serviceTrucks.length,
      observationSeconds: waste.duration,
    },
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
  console.log(JSON.stringify(report, null, 2));
  // Keep the verified result in the runner output even if Windows temporarily locks the report.
  for (let attempt = 0; ; attempt++) {
    try {
      await writeFile("output/production.json", JSON.stringify(report, null, 2));
      break;
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
import { ParkingSimulation } from "../src/simulation/parking";
