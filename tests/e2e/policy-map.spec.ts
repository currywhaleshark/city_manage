import { test, expect, type Page } from "@playwright/test";

async function choose(page: Page, id: string) {
  await page.getByRole("button", { name: "동네 소식", exact: true }).click();
  await page.locator("#choose-scenario").click();
  await page.locator(`[data-scenario="${id}"]`).click();
  await expect(page.locator(".applied-policy-pin")).toHaveCount(0);
  await expect(page.locator("#applied-shared")).toBeHidden();
}
async function apply(page: Page, ids: string[], site?: string) {
  await page.getByRole("button", { name: "정책 만들기", exact: true }).click();
  if (site) await page.locator("#facility-site").selectOption(site);
  for (const id of ids) await page.locator(`[data-policy="${id}"]`).check();
  await page.locator("#apply").click();
  await page.waitForFunction(
    () =>
      ["trial", "done"].includes((window as any).__mayor.mode) &&
      !(window as any).__mayor.busy,
  );
  if (await page.locator("#results-dialog").isVisible())
    await page.locator("#close-results").click();
  else
    await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await page.locator("#camera-reset").click();
}
async function checkLayout(page: Page) {
  await expect(async () => {
    const data = await page.evaluate(() => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      };
      const selectors =
        ".applied-policy-pin, #applied-shared, .resident-pin, #resident-bubble, #panel-residents";
      return {
        boxes: [...document.querySelectorAll(selectors)]
          .filter((e) => e.getClientRects().length)
          .map(box),
        map: box(document.querySelector("#city-canvas")!),
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      };
    });
    expect(data.scroll).toBe(data.width);
    for (const [i, a] of data.boxes.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.right).toBeLessThanOrEqual(data.width);
      expect(a.bottom).toBeLessThanOrEqual(data.map.bottom);
      for (const b of data.boxes.slice(i + 1))
        expect(
          Math.min(a.right, b.right) > Math.max(a.x, b.x) + 1 &&
            Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y) + 1,
          JSON.stringify({ a, b }),
        ).toBe(false);
    }
  }).toPass({ timeout: 5000 });
}
for (const width of [1440, 390])
  test(`applied local and shared policies stay truthful and readable (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?mode=lab");
    await page
      .getByRole("button", { name: "정책 만들기", exact: true })
      .click();
    await page.locator('[data-policy="signal"]').check();
    await expect(page.locator(".applied-policy-pin")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await apply(page, ["signal", "bypass", "oneWay"]);
    await expect(page.locator(".applied-policy-pin:visible")).toHaveCount(3);
    await expect(page.locator("#applied-shared")).toBeHidden();
    const signal = page.locator('[data-policy-place="signal"]');
    await expect(signal).toHaveAttribute("data-world-x", "48");
    await signal.click();
    await expect(page.locator("#selection-detail")).toContainText(
      "초록불 26초",
    );
    await page.keyboard.press("Escape");
    await expect(signal).toBeFocused();
    await page
      .getByRole("button", { name: "정책 만들기", exact: true })
      .click();
    await page.locator('[data-policy="signal"]').uncheck();
    await page.keyboard.press("Escape");
    await expect(signal).toBeVisible();
    await checkLayout(page);
    await page.screenshot({
      path: `output/playwright/policies-traffic-${width}.png`,
    });
    await page.locator("#reset").click();
    await expect(page.locator(".applied-policy-pin")).toHaveCount(0);

    await choose(page, "waste");
    await apply(page, ["extraTruck", "route", "reduce"]);
    await expect(page.locator("[data-shared-policy]")).toHaveCount(3);
    await expect(page.locator("#applied-shared")).toContainText("동네 전체");
    await expect(page.locator(".applied-policy-pin")).toHaveCount(0);
    await checkLayout(page);
    await page.screenshot({
      path: `output/playwright/policies-waste-${width}.png`,
    });
    await page.locator('[data-shared-policy="reduce"]').click();
    await expect(page.locator("#selection-detail")).toContainText(
      "수거 지역 6곳",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "주민 의견", exact: true }).click();
    await expect(page.locator(".resident-pin:visible")).toHaveCount(6);
    await checkLayout(page);
    await page.screenshot({
      path: `output/playwright/policies-waste-residents-${width}.png`,
    });
    await page.keyboard.press("Escape");

    await choose(page, "facilities");
    await apply(page, ["library", "expand"], "south");
    await expect(page.locator(".applied-policy-pin:visible")).toHaveCount(2);
    const library = page
      .locator(".applied-policy-pin")
      .filter({ hasText: "작은도서관 신설" });
    await expect(library).toHaveAttribute("data-world-x", "24");
    await expect(library).toHaveAttribute("data-world-z", "264");
    await page
      .getByRole("button", { name: "정책 만들기", exact: true })
      .click();
    await page.locator("#facility-site").selectOption("north");
    await page.keyboard.press("Escape");
    await expect(library).toHaveAttribute("data-world-z", "264");
    await page.getByRole("button", { name: "주민 의견", exact: true }).click();
    await checkLayout(page);
    await page.screenshot({
      path: `output/playwright/policies-facilities-residents-${width}.png`,
    });
    await page.keyboard.press("Escape");

    await choose(page, "environment");
    await apply(page, ["industry", "conserve", "buffer", "small"]);
    await expect(page.locator(".applied-policy-pin:visible")).toHaveCount(3);
    await expect(page.locator('[data-policy-place="industry"]')).toContainText(
      "녹지 보전",
    );
    await expect(
      page.locator('[data-policy-place="housing"]'),
    ).not.toContainText("주거지 확장");
    await expect(page.locator("#applied-shared")).toContainText(
      "개발 부지 공통",
    );
    await checkLayout(page);
    await page.screenshot({
      path: `output/playwright/policies-environment-${width}.png`,
    });
    await page.getByRole("button", { name: "주민 의견", exact: true }).click();
    await checkLayout(page);
    await page.screenshot({
      path: `output/playwright/policies-environment-residents-${width}.png`,
    });
    await page.locator('[data-policy-place="industry"]').click();
    await expect(page.locator("#selection-detail")).toContainText("96㎡");
    await expect(page.locator("#selection-detail")).toContainText("192㎡");
    await page.keyboard.press("Escape");
    await page.locator("#reset").click();
    await apply(page, ["small"]);
    await expect(page.locator(".applied-policy-pin")).toHaveCount(0);
    await expect(page.locator("#applied-shared")).toContainText(
      "개발 선택 없음 · 변화 없음",
    );
    expect(errors).toEqual([]);
  });
