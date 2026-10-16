import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
for (const width of [1440, 390])
  test(`investigate water, choose map policies and compare flow and delayed treatment (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?mode=lab");
    await page.getByRole("button", { name: "동네 소식", exact: true }).click();
    await page.locator("#choose-scenario").click();
    await page.locator('[data-scenario="water"]').click();
    await page.locator("#pause").click();
    await expect(page.locator(".water-label:visible")).toHaveCount(3);
    await expect(page.locator('[data-layer-legend="water"]')).toBeVisible();
    await page.locator("#layer-water").click();
    await expect(page.locator("#map-layer")).toHaveValue("normal");
    await page.locator("#layer-water").click();
    await page.locator('[data-water-label="middle"]').click();
    await expect(page.locator("#selection-title")).toHaveText(
      "배출구 아래 관찰소",
    );
    await page.screenshot({
      path: `output/playwright/water-site-${width}.png`,
      animations: "disabled",
    });
    await page.locator('[data-water-inquiry="middle"]').click();
    await page.locator('[data-inquiry-action="fact"]').click();
    const saved = await page.locator(".inquiry-fact p").innerText();
    await page
      .locator('[data-inquiry-field="hypothesis"]')
      .fill("작업장과 생활하수에서 들어온 오염이 하류로 흘러가요.");
    await page.locator('[data-inquiry-step="2"]').last().click();
    await page.locator('[data-inquiry-action="opinion"]').click();
    await page.locator("#inquiry-place").selectOption("downstream");
    await page.locator('[data-inquiry-action="opinion"]').click();
    await page.locator('[data-inquiry-action="voices"]').click();
    await expect(page.locator(".resident-pin:visible")).toHaveCount(3);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "우리 동네 조사", exact: true })
      .click();
    await page.locator('[data-inquiry-step="3"]').last().click();
    await page.locator('[data-evidence="1"]').check();
    await page
      .locator('[data-inquiry-field="reason"]')
      .fill("유입구 자료를 보고 작업장과 생활하수를 함께 처리해요.");
    await page
      .locator('[data-inquiry-field="alternative"]')
      .fill("쓰레기만 치우면 물에 섞인 오염은 남을 수 있어요.");
    await page.locator('[data-inquiry-action="policy"]').click();
    await page.locator('[data-policy="outlet"]').check();
    await expect(page.locator(".placement-pin:visible")).toHaveCount(2);
    await page.locator('[data-placement-target="factoryNorth"]').click();
    await page.locator('[data-pick-water="outlet"]').click();
    await page.locator("#cancel-placement").click();
    await expect(page.locator("#water-locations")).toContainText(
      "북쪽 작업장 배출구",
    );
    await expect(page.locator("#budget")).toHaveText("55");
    await page.locator('[data-policy="sewer"]').check();
    await page.screenshot({
      path: `output/playwright/water-placement-${width}.png`,
      animations: "disabled",
    });
    await page.locator('[data-placement-target="riverside"]').click();
    await expect(page.locator("#budget")).toHaveText("0");
    await expect(page.locator('[data-policy="riverCleanup"]')).toBeDisabled();
    await page.locator("#apply").click();
    await expect(page.locator("[data-panel]:visible")).toHaveCount(0, {
      timeout: 60000,
    });
    await page.locator("#pause").click();
    await page.getByRole("button", { name: "수질 현황", exact: true }).click();
    await page.locator("#next-water-round").click();
    await expect(page.locator("#next-water-round")).toBeEnabled({
      timeout: 60000,
    });
    expect(
      await page.evaluate(() => (window as any).__mayor.simulation.time),
    ).toBe(300);
    await expect(page.locator("#pause")).toHaveAttribute("aria-label", "재생");
    await page.locator("#next-water-round").click();
    await expect(page.locator("#next-water-round")).toBeEnabled({
      timeout: 60000,
    });
    expect(
      await page.evaluate(() => (window as any).__mayor.simulation.time),
    ).toBe(600);
    await page.locator("#next-water-round").click();
    await expect(page.locator("#results-dialog")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.locator("#result-table")).toContainText("상류 관찰소");
    await expect(page.locator("#result-table")).toContainText("하류 관찰소");
    await page.locator("#water-round-results summary").click();
    await page.screenshot({
      path: `output/playwright/water-results-${width}.png`,
      animations: "disabled",
    });
    await page.locator("#review-inquiry").click();
    await page.locator('[data-inquiry-step="5"]').last().click();
    await page
      .locator('[data-inquiry-field="proposal"]')
      .fill("하류에 변화가 도착하는 시간과 남은 쓰레기도 조사해요.");
    await page.keyboard.press("Escape");
    await page.locator("#show-results").click();
    const download = page.waitForEvent("download");
    await page.locator("#export").click();
    const raw = await fs.readFile((await (await download).path())!, "utf8"),
      data = JSON.parse(raw);
    expect(data.schemaVersion).toBe(7);
    expect(data.waterPlan.sewer).toBe("riverside");
    expect(data.inquiry.evidence[0].text).toBe(saved);
    expect(data.waterAfter.treated).toBeGreaterThan(0);
    expect(data.waterAfter.outflow).toBeGreaterThan(0);
    expect(data.waterAfter.sites[2].level).toBeLessThan(
      data.waterBefore.sites[2].level,
    );
    expect(data.waterRoundsAfter[0].levels[2]).toBe(
      data.waterRoundsBefore[0].levels[2],
    );
    expect(data.policyIds).toEqual(["outlet", "sewer"]);
    expect(data.budget).toBe(0);
    expect(data.waterRoundsAfter).toHaveLength(3);
    await page.evaluate(() => {
      window.print = () => {};
    });
    await page.locator("#print-current").click();
    await expect(page.locator("#print-sheet")).toContainText(saved);
    await expect(page.locator("#print-sheet")).toContainText(
      "하류에 변화가 도착하는 시간",
    );
    await page.locator("#close-results").click();
    await page.locator("#record-file").setInputFiles({
      name: "water.json",
      mimeType: "application/json",
      buffer: Buffer.from(raw),
    });
    await expect(page.locator("#record-dialog")).toBeVisible();
    await expect(page.locator("#saved-record-content")).toContainText(
      "관찰 3차",
    );
    await page.locator("#close-record").click();
    await page.keyboard.press("Escape");
    await page.locator("#camera-reset").click();
    await expect(page.locator(".water-label:visible")).toHaveCount(3);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const labels = [
            ...document.querySelectorAll<HTMLElement>(
              ".water-label:not([hidden])",
            ),
          ];
          const pins = [
            ...document.querySelectorAll<HTMLElement>(".applied-policy-pin"),
          ];
          return labels.every((label, i) => {
            const a = label.getBoundingClientRect();
            return (
              a.left >= 0 &&
              a.right <= innerWidth &&
              [...labels.slice(i + 1), ...pins].every((other) => {
                const b = other.getBoundingClientRect();
                return (
                  Math.min(a.right, b.right) <= Math.max(a.left, b.left) ||
                  Math.min(a.bottom, b.bottom) <= Math.max(a.top, b.top)
                );
              })
            );
          });
        }),
      )
      .toBe(true);

    await page.screenshot({
      path: `output/playwright/water-city-${width}.png`,
      animations: "disabled",
    });
    await page.locator("#reset").click();
    expect(
      await page.evaluate(
        () => (window as any).__mayor.simulation.rounds.length,
      ),
    ).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
