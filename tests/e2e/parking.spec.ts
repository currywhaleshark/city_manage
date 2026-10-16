import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

for (const width of [1440, 390])
  test(`investigate parking, compare, save and reopen the evidence (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?mode=lab");
    await page.getByRole("button", { name: "동네 소식", exact: true }).click();
    await page.locator("#choose-scenario").click();
    await page.locator('[data-scenario="parking"]').click();
    await page.locator('[data-parking-label="school"]').click();
    await expect(page.locator("#selection-title")).toHaveText("학교 앞");
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: `output/playwright/parking-closeup-${width}.png`,
    });
    await page
      .getByRole("button", { name: "우리 동네 조사", exact: true })
      .click();
    await expect(page.locator("[data-panel]:visible")).toHaveCount(1);
    await page.locator('[data-inquiry-action="focus"]').click();
    await page.locator('[data-inquiry-step="1"]').last().click();
    await page.locator('[data-inquiry-action="fact"]').click();
    const savedFact = await page.locator(".inquiry-fact p").innerText();
    await page
      .locator('[data-inquiry-field="hypothesis"]')
      .fill("학교 앞에 잠깐 세우는 차가 겹쳐요.");
    await page.locator("#inquiry-place").selectOption("homes");
    await page.locator('[data-inquiry-action="fact"]').click();
    await page.locator('[data-inquiry-step="2"]').last().click();
    await page.locator('[data-inquiry-action="opinion"]').click();
    await page.locator("#inquiry-place").selectOption("school");
    await page.locator('[data-inquiry-action="opinion"]').click();
    await page.locator('[data-inquiry-step="3"]').last().click();
    await expect(page.locator(".evidence-list li")).toHaveCount(4);
    await expect(page.locator(".evidence-list")).toContainText(savedFact);
    await page.locator('[data-evidence="1"]').check();
    await page.locator('[data-evidence="3"]').check();
    await page
      .locator('[data-inquiry-field="alternative"]')
      .fill("공동주차장은 공터를 쓰지만 오래 세울 곳을 만들어요.");
    await page
      .locator('[data-inquiry-field="reason"]')
      .fill("학교 앞 길을 열고 이웃의 주차 자리도 마련해요.");
    await page.screenshot({
      path: `output/playwright/parking-inquiry-${width}.png`,
    });
    await page.locator('[data-inquiry-action="policy"]').click();
    await page.locator('[data-policy="patrol"]').check();
    await page.locator('[data-placement-target="school"]').click();
    await page.locator('[data-policy="parkingLot"]').check();
    await page.locator('[data-placement-target="north"]').click();
    await expect(page.locator('[data-policy="loadingBay"]')).toBeDisabled();
    await expect(page.locator("#budget")).toHaveText("15");
    await page.locator("#apply").click();
    await expect(page.locator("[data-panel]:visible")).toHaveCount(0, {
      timeout: 60000,
    });
    await page.locator("#pause").click();
    await expect(page.locator(".applied-policy-pin")).toHaveCount(2);
    await page.locator("#camera-reset").click();
    await expect(async () => {
      const boxes = await page
        .locator(".parking-label,.applied-policy-pin")
        .evaluateAll((els) =>
          els
            .filter((e) => !(e as HTMLElement).hidden)
            .map((e) => {
              const r = e.getBoundingClientRect();
              return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
            }),
        );
      for (let i = 0; i < boxes.length; i++)
        for (const b of boxes.slice(i + 1)) {
          const a = boxes[i];
          expect(
            Math.min(a.right, b.right) > Math.max(a.x, b.x) + 1 &&
              Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y) + 1,
          ).toBe(false);
        }
    }).toPass({ timeout: 3000 });
    await page.screenshot({
      path: `output/playwright/parking-city-${width}.png`,
    });
    await page.getByRole("button", { name: "주민 의견", exact: true }).click();
    await expect(page.locator(".resident-pin:visible")).toHaveCount(3);
    await page.keyboard.press("Escape");
    await page.locator("#finish").click();
    await expect(page.locator("#results-dialog")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.locator("#result-table")).toContainText(
      "차를 피해 돌아간 보행자",
    );
    await page.locator("#review-inquiry").click();
    await page.locator('[data-inquiry-step="5"]').last().click();
    await page
      .locator('[data-inquiry-field="proposal"]')
      .fill("다음에는 시장 상인과 하역 시간을 정해요.");
    await page.keyboard.press("Escape");
    await page.locator("#show-results").click();
    await page
      .locator("#reflection")
      .fill("다른 골목에는 여전히 불편이 남았어요.");
    await page.screenshot({
      path: `output/playwright/parking-results-${width}.png`,
    });
    const download = page.waitForEvent("download");
    await page.locator("#export").click();
    const raw = await fs.readFile((await (await download).path())!, "utf8"),
      data = JSON.parse(raw);
    expect(data.schemaVersion).toBe(5);
    expect(data.inquiry.evidence[0].text).toBe(savedFact);
    expect(data.inquiry.decisions[0].evidenceIds).toEqual([1, 3]);
    expect(data.parkingPlan.siteId).toBe("north");
    expect(data.parkingAfter.illegalSeconds).toBeLessThan(
      data.parkingBefore.illegalSeconds,
    );
    await page.evaluate(() => {
      window.print = () => {};
    });
    await page.locator("#print-current").click();
    await expect(page.locator("#print-sheet")).toContainText(
      "다음에는 시장 상인",
    );
    await expect(page.locator("#print-sheet")).toContainText(savedFact);
    await page.locator("#close-results").click();
    await page.locator("#record-file").setInputFiles({
      name: "parking.json",
      mimeType: "application/json",
      buffer: Buffer.from(raw),
    });
    await expect(page.locator("#record-dialog")).toBeVisible();
    await expect(page.locator("#saved-record-content")).toContainText(
      "정책 시행 1회의 선택 근거",
    );
    await page.locator("#close-record").click();
    await page.locator("#reset").click();
    await page
      .getByRole("button", { name: "우리 동네 조사", exact: true })
      .click();
    await expect(page.locator(".inquiry-count")).toContainText("담은 자료 0개");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
