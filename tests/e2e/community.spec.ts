import { test, expect } from "@playwright/test";

for (const width of [1440, 390])
  test(`residents deliberate, act and revisit results (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.locator("#live-state")).toContainText("도시가");
    await page.locator('[data-panel-open="news"]').click();
    await page
      .getByRole("button", { name: "주민 회의 열기", exact: true })
      .click();
    await page.locator('[data-community-project="waterCare"]').click();
    const before = await page.evaluate(() => (window as any).__liveCity.time);
    await expect(page.locator(".placement-pin:visible")).toHaveCount(2);
    await page.locator('[data-placement-target="homes"]').click();
    await expect(page.locator(".community-voice")).toContainText(
      "하천을 걷는 주민",
    );
    await expect(page.locator("#start-community")).toHaveCount(0);
    await page.screenshot({
      path: `output/playwright/community-listening-${width}.png`,
    });
    await page.locator("#community-next").click();
    await expect(page.locator(".community-voice")).toContainText("음식점 주인");
    await page.locator("#community-next").click();
    await expect(page.locator(".community-voice")).toContainText(
      "시간이 다른 주민",
    );
    await page.locator("#community-next").click();
    await expect(page.locator(".community-proposal")).toHaveCount(3);
    await expect(page.locator("#start-community")).toHaveCount(0);
    await page.locator('#community-vote').click();
    await expect(page.locator('#live-panel-body')).toContainText('가상 주민 11명');
    await page.locator('#community-count').click();
    if (await page.locator('#community-runoff').count()) await page.locator('#community-runoff').click();
    await page
      .locator("#community-reason")
      .fill("일하는 이웃도 편한 시간에 함께 실천해요.");
    await page
      .locator("#community-concern")
      .fill("작업장 배출도 시청과 함께 살펴요.");
    await page.screenshot({
      path: `output/playwright/community-plan-${width}.png`,
    });
    expect(await page.evaluate(() => (window as any).__liveCity.time)).toBe(
      before,
    );
    await page.locator("#start-community").click();
    await expect(page.locator("#live-budget")).toHaveText("92");
    await expect(
      page.locator('[data-policy-place="community-waterCare-homes"]'),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as any).__liveCity.paused))
      .toBe(false);
    await page.locator("#pause").click();
    await page.locator("#save-city").click();
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => (window as any).__liveCity?.busy))
      .toBe(false);
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__liveCity?.council?.length),
      )
      .toBe(1);
    const record = await page.evaluate(
      () => (window as any).__liveCity.council[0],
    );
    expect(record.heard).toEqual(["walker", "merchant", "worker"]);
    expect(record.method).toBe('relay');
    expect(record.vote.winner).toBe(record.method);
    expect(record.vote.rounds[0].ballots).toHaveLength(11);
    expect(record.concern).toContain("작업장");
    // Replay the user's actual saved decisions at a later simulated time (no wall-clock wait).
    await page.evaluate(() => {
      const key = "mayor-living-city-v1",
        saved = JSON.parse(localStorage.getItem(key)!);
      saved.time = Math.round((saved.council[0].time + 661) * 10) / 10;
      localStorage.setItem(key, JSON.stringify(saved));
    });
    // Avoid pagehide autosave replacing the time-advanced fixture on navigation.
    const saved = await page.evaluate(() =>
      localStorage.getItem("mayor-living-city-v1")!,
    );
    await page.addInitScript(
      (value) => localStorage.setItem("mayor-living-city-v1", value),
      saved,
    );
    await page.reload();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as any).__liveCity?.council?.[0]?.result !== undefined,
          ),
        { timeout: 60000 },
      )
      .toBe(true);
    await page.locator('[data-panel-open="news"]').click();
    await page
      .getByRole("button", { name: "주민 회의 열기", exact: true })
      .click();
    await page.locator('[data-community-record="0"]').click();
    await expect(page.locator(".community-comparison")).toBeVisible();
    await expect(page.locator(".community-contribution")).toContainText(
      "줄였어요",
    );
    await expect(page.locator("#live-panel-body")).toContainText(
      "작업장 오염과 물 위 쓰레기",
    );
    await page
      .locator('[data-community-reflection="0"]')
      .fill("남은 오염원도 조사하고 처리 시설을 의논해요.");
    await page.locator("#save-city").click();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("mayor-living-city-v1")!).council[0]
            .reflection,
      ),
    ).toContain("처리 시설");
    await page.locator("#live-panel-title").focus();
    await page.screenshot({
      path: `output/playwright/community-result-${width}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
