import { FacilitySimulation } from "../../src/simulation/facilities";
import { test, expect, type Page } from "@playwright/test";

async function checkMapLayout(page: Page) {
  await expect(async () => {
    const layout = await page.evaluate(() => {
      const rect = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      };
      return {
        pins: [...document.querySelectorAll(".resident-pin")].map(rect),
        bubble: rect(document.querySelector("#resident-bubble")!),
        guide: rect(document.querySelector("#panel-residents")!),
        map: rect(document.querySelector("#city-canvas")!),
        pageWidth: document.documentElement.scrollWidth,
        width: innerWidth,
      };
    });
    const intersects = (a: typeof layout.bubble, b: typeof layout.bubble) =>
      Math.min(a.right, b.right) > Math.max(a.x, b.x) + 1 &&
      Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y) + 1;
    expect(layout.pageWidth).toBe(layout.width);
    for (const box of [...layout.pins, layout.bubble]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(layout.map.right);
      expect(box.y).toBeGreaterThanOrEqual(layout.guide.bottom);
      expect(box.bottom).toBeLessThanOrEqual(layout.map.bottom);
    }
    for (const [i, pin] of layout.pins.entries()) {
      expect(
        intersects(pin, layout.bubble),
        `pin ${i} must not cover the story`,
      ).toBe(false);
      for (const other of layout.pins.slice(i + 1))
        expect(intersects(pin, other), JSON.stringify({ pin, other })).toBe(
          false,
        );
    }
  }).toPass({ timeout: 3000 });
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`residents speak at their map locations, one at a time (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/?mode=lab");
    await page.getByRole("button", { name: "일시정지", exact: true }).click();
    const scenarios = [
      { id: "traffic", places: ["b6", "b4"] },
      { id: "waste", places: ["b0", "b4", "b8", "b12", "b7", "b6"] },
      {
        id: "facilities",
        places: new FacilitySimulation().neighborhoods.map(n => n.id),
      },
      { id: "environment", places: ["b12", "b13", "b6", "b15"] },
    ];
    for (const scenario of scenarios) {
      if (scenario.id !== "traffic") {
        await page
          .getByRole("button", { name: "동네 소식", exact: true })
          .click();
        await expect(page.locator("#resident-map")).toBeHidden();
        await page.locator("#choose-scenario").click();
        await page.locator(`[data-scenario="${scenario.id}"]`).click();
      }
      await page
        .getByRole("button", { name: "주민 의견", exact: true })
        .click();
      await expect(page.locator("#resident-map")).toBeVisible();
      await expect(page.locator(".resident-pin:visible")).toHaveCount(
        scenario.places.length,
      );
      await expect(page.locator("#resident-bubble")).toHaveCount(1);
      await expect(page.locator("#resident-evidence")).not.toHaveAttribute(
        "open",
        "",
      );
      for (const [index, facility] of scenario.places.entries()) {
        const pin = page.locator(
          `.resident-pin[data-facility-id="${facility}"]`,
        );
        await pin.click();
        await expect(pin).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#resident-count")).toHaveText(
          `${index + 1} / ${scenario.places.length}`,
        );
        await expect(page.locator("#resident-speaker")).toHaveText(
          await pin.locator("span").innerText(),
        );
        await expect(page.locator("#resident-quote")).not.toBeEmpty();
        await expect
          .poll(async () =>
            page.locator("#resident-bubble").getAttribute("data-resident"),
          )
          .toBe(await pin.getAttribute("data-resident"));
        await checkMapLayout(page);
      }
      await page.locator("#resident-next").click();
      await expect(page.locator("#resident-count")).toHaveText(
        `1 / ${scenario.places.length}`,
      );
      await page.screenshot({
        path: `output/playwright/residents-${scenario.id}-${viewport.width}.png`,
        animations: "disabled",
      });
      await page.locator("#resident-evidence summary").click();
      await expect(page.locator("#resident-fact")).toBeVisible();
      await expect(page.locator("#resident-opinion")).toBeVisible();
      // Live HUD updates must keep the expanded evidence and keyboard focus.
      await page.locator("#resident-evidence summary").focus();
      await page.waitForTimeout(500);
      await expect(page.locator("#resident-evidence summary")).toBeFocused();
      await expect(page.locator("#resident-evidence")).toHaveAttribute(
        "open",
        "",
      );
      await checkMapLayout(page);
      await page.keyboard.press("Escape");
      await expect(page.locator("#resident-map")).toBeHidden();
      await expect(
        page.getByRole("button", { name: "주민 의견", exact: true }),
      ).toBeFocused();
      if (scenario.id === "facilities") {
        await page
          .getByRole("button", { name: "정책 만들기", exact: true })
          .click();
        await page.locator('[data-policy="park"]').check();
        await page.locator("#apply").click();
        await expect(page.locator("#results-dialog")).toBeVisible();
        await page.locator("#close-results").click();
        await page
          .getByRole("button", { name: "주민 의견", exact: true })
          .click();
        await page.locator("#resident-evidence summary").click();
        await expect(page.locator("#resident-change")).toBeVisible();
        await expect(page.locator("#resident-change")).toContainText("명");
        await checkMapLayout(page);
        await page.keyboard.press("Escape");
      }
    }
    await page.getByRole("button", { name: "주민 의견", exact: true }).click();
    const pin = page.locator('.resident-pin[data-facility-id="b13"]');
    await pin.focus();
    await page.keyboard.press("Enter");
    await expect(pin).toHaveAttribute("aria-pressed", "true");
    const x = Number(await pin.getAttribute("data-anchor-x"));
    const y = Number(await pin.getAttribute("data-anchor-y"));
    await page.locator("#zoom-in").click();
    await expect
      .poll(async () =>
        Math.hypot(
          Number(await pin.getAttribute("data-anchor-x")) - x,
          Number(await pin.getAttribute("data-anchor-y")) - y,
        ),
      )
      .toBeGreaterThan(3);
    await page.locator("#camera-reset").click();
    const previous = Number(await pin.getAttribute("data-anchor-x"));
    await page.mouse.move(viewport.width - 12, 220);
    await page.mouse.down();
    await page.mouse.move(viewport.width - 80, 260, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        Math.abs(Number(await pin.getAttribute("data-anchor-x")) - previous),
      )
      .toBeGreaterThan(3);
    await page.locator("#camera-reset").click();
    await page
      .getByRole("button", { name: "정책 만들기", exact: true })
      .click();
    await expect(page.locator("#resident-map")).toBeHidden();
    expect(errors).toEqual([]);
  });
}

