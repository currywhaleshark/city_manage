import { test, expect, type Page } from "@playwright/test";
import { wasteColor, accessBand } from "../../src/renderer/map-data";
import { FacilitySimulation } from "../../src/simulation/facilities";

async function choose(page: Page, id: string) {
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await page.locator(`[data-scenario="${id}"]`).click();
}
const visualization = (page: Page) =>
  page.evaluate(() => (window as any).__mayor.mapVisualization);

test("left map tools follow the scenario and waste really recolors building geometry as collection progresses", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mode=lab");
  await expect(page.locator("[data-map-layer]:visible")).toHaveCount(3);
  await choose(page, "waste");
  await page.locator("#pause").click();
  const original = (await visualization(page)).buildings;
  await expect(page.locator("[data-map-layer]:visible")).toHaveCount(4);
  await page.locator("#layer-waste").click();
  await expect(page.locator("#map-layer")).toHaveValue("waste");
  await expect(page.locator('[data-layer-legend="waste"]')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await visualization(page)).buildings.filter((b: any) => b.tinted)
          .length,
    )
    .toBe(6);
  const checkColors = async () => {
    const sites = await page.evaluate(() =>
      (window as any).__mayor.simulation.sites.map((s: any) => ({
        id: s.facilityId,
        remaining: s.remaining,
      })),
    );
    await expect
      .poll(async () =>
        (await visualization(page)).buildings
          .filter((b: any) => b.tinted)
          .map((b: any) => ({ id: b.id, color: b.color })),
      )
      .toEqual(
        original
          .filter((b: any) => sites.some((s: any) => s.id === b.id))
          .map((b: any) => ({
            id: b.id,
            color: wasteColor(sites.find((s: any) => s.id === b.id).remaining),
          })),
      );
  };
  await checkColors();
  const first = (await visualization(page)).buildings;
  await page.locator("#finish").click();
  await expect(page.locator("#mode-label")).toHaveText("시행 전 · 관찰 완료");
  await checkColors();
  expect((await visualization(page)).buildings).not.toEqual(first);
  await page.screenshot({ path: "output/playwright/map-waste-colors.png" });
  await page.locator("#overlay").click();
  await expect(page.locator("#layer-waste")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect
    .poll(async () => (await visualization(page)).buildings)
    .toEqual(original);
  await page.getByRole("button", { name: "수거 현황", exact: true }).click();
  await page.locator("#map-layer").selectOption("population");
  await expect(page.locator("#layer-population")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.locator("#layer-population").click();
  await expect(page.locator("#overlay-legend")).toBeHidden();
  await choose(page, "environment");
  await expect(page.locator("#layer-waste")).toBeHidden();
  await expect(page.locator("#layer-environment")).toBeVisible();
  expect(errors).toEqual([]);
});

test("access buildings, five-minute coverage and service buttons follow actual applied facility plans", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mode=lab");
  await choose(page, "facilities");
  await expect(page.locator("#overlay")).toBeHidden();
  await page.locator("#layer-access").click();
  const checkAccess = async (
    sim: FacilitySimulation,
    kind: "library" | "park",
  ) => {
    await expect
      .poll(async () =>
        (await visualization(page)).buildings
          .filter((b: any) => b.tinted)
          .map((b: any) => ({ id: b.id, color: b.color })),
      )
      .toEqual(
        sim.access.map((n) => ({
          id: n.id,
          color: accessBand(n.services[kind].nearest?.route.seconds ?? null)
            .color,
        })),
      );
    const state = (await visualization(page)).coverage;
    expect(state.visible).toBe(true);
    expect(state.service).toBe(kind);
    expect(state.facilityIds).toEqual(
      sim.facilities.filter((f) => f.kind === kind).map((f) => f.id),
    );
    expect(state.cells).toBeGreaterThan(0);
  };
  await checkAccess(new FacilitySimulation(), "library");
  await page.screenshot({ path: "output/playwright/map-access-library.png" });
  await page.locator('[data-access-service="park"]').click();
  await expect(page.locator("#access-service")).toHaveValue("park");
  await checkAccess(new FacilitySimulation(), "park");
  await page.screenshot({ path: "output/playwright/map-access-park.png" });
  await page.getByRole("button", { name: "시설 지도", exact: true }).click();
  await page.locator("#access-service").selectOption("library");
  await expect(page.locator('[data-access-service="library"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  await page.locator('[data-policy="library"]').check();
  await page.locator("#facility-site").selectOption("north");
  await page.locator("#apply").click();
  await expect(page.locator("#results-dialog")).toBeVisible();
  await page.locator("#close-results").click();
  await checkAccess(
    new FacilitySimulation(2404, ["library"], { siteId: "north" }),
    "library",
  );
  await page.screenshot({
    path: "output/playwright/map-access-new-library.png",
  });
  await page.locator("#layer-access").click();
  await expect
    .poll(async () => (await visualization(page)).coverage.visible)
    .toBe(false);
  await expect
    .poll(async () =>
      (await visualization(page)).buildings.some((b: any) => b.tinted),
    )
    .toBe(false);
  expect(errors).toEqual([]);
});

test("mobile map tools keep the selected legend within the city and coexist with citywide policies", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?mode=lab");
  await choose(page, "facilities");
  await page.locator("#layer-access").click();
  await page.locator('[data-access-service="park"]').click();
  const mobileLegend = await page.locator("#overlay-legend").boundingBox();
  const workspace = await page.locator(".workspace").boundingBox();
  expect(mobileLegend!.y).toBeGreaterThan(workspace!.height * 0.65);
  expect(mobileLegend!.y + mobileLegend!.height).toBeLessThan(
    workspace!.height,
  );
  await page.screenshot({ path: "output/playwright/map-access-mobile.png" });
  await choose(page, "waste");
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  await page.locator('[data-policy="reduce"]').check();
  await page.locator("#apply").click();
  await expect(page.locator("#mode-label")).toHaveText(
    "정책 시행 후 · 실험 중",
  );
  await page.locator("#layer-waste").click();
  const tools = await page.locator(".map-tools").boundingBox();
  const shared = await page.locator("#applied-shared").boundingBox();
  const deck = await page.locator(".command-deck").boundingBox();
  expect(tools!.y).toBeGreaterThan(shared!.y + shared!.height);
  expect(tools!.y + tools!.height).toBeLessThan(deck!.y);
  expect(tools!.x + tools!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "output/playwright/map-waste-mobile.png" });
});

