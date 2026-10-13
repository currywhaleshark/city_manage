import { formatSeconds } from "../metrics";
import type { ExperimentComparison } from "../metrics/comparison";
import { icon } from "./icons";

export function comparisonMarkup(comparison: ExperimentComparison) {
  const table = (groups: ExperimentComparison["byPurpose"]) =>
    `<table class="group-table"><thead><tr><th>차량 묶음</th><th>도착한 차<br><small>시행 전 → 후</small></th><th>1대당 누적 대기<br><small>시행 전 → 후</small></th></tr></thead><tbody>${groups.map((group) => `<tr><th>${group.label}<small>출발 예정 시간이 된 ${group.released}대</small></th><td>${group.before.arrived} → ${group.after.arrived}대</td><td>${formatSeconds(group.before.averageWait)} → ${formatSeconds(group.after.averageWait)}</td></tr>`).join("")}</tbody></table>`;
  const matched = comparison.matched;
  const walkers = comparison.pedestrians;
  const pedestrianMarkup = walkers
    ? `<details id="pedestrian-details" class="result-details"><summary>걸어가는 사람들은 어땠을까요? ${icon("plus", 16)}</summary><p class="matched-note">같은 ${walkers.total}명이 같은 시간·경로·걷는 속도로 출발해요.</p><table><thead><tr><th>보행자</th><th>시행 전</th><th>시행 후</th></tr></thead><tbody><tr><th>도착한 사람</th><td>${walkers.before.arrived}명</td><td>${walkers.after.arrived}명</td></tr><tr><th>아직 도착하지 못한 사람</th><td>${walkers.total - walkers.before.arrived}명</td><td>${walkers.total - walkers.after.arrived}명</td></tr><tr><th>1인당 누적 대기</th><td>${formatSeconds(walkers.before.averageWaitingTime)}</td><td>${formatSeconds(walkers.after.averageWaitingTime)}</td></tr></tbody></table><p class="metric-note">출발 시간이 된 모든 사람의 대기예요. 신호·대기 줄·출발지에서 늦어진 시간을 포함해요. 차량 초록불을 늘리면 보행 신호를 더 오래 기다릴 수도 있어요.</p></details>`
    : "";
  return `<details id="impact-details" class="result-details"><summary>누가 더 편해졌을까요? ${icon("plus", 16)}</summary><div class="analysis-controls" role="group" aria-label="차량 묶음 기준"><button data-analysis-group="purpose" aria-pressed="true">가는 곳별</button><button data-analysis-group="direction" aria-pressed="false">가는 방향별</button></div><div id="purpose-comparison">${table(comparison.byPurpose)}</div><div id="direction-comparison" hidden>${table(comparison.byDirection)}<p class="metric-note">방향은 출발지에서 목적지로 향하는 주된 방향이에요. 도중에 달리는 길의 방향과는 다를 수 있어요.</p></div><p class="metric-note">아직 도착하지 못한 차와 출발지에서 기다린 시간도 포함해요. 출발 시간이 되지 않은 차는 평균에서 빼요.</p></details>
  <details id="matched-details" class="result-details"><summary>같은 자동차끼리 비교하기 ${icon("plus", 16)}</summary><p class="matched-note">${matched.count ? `두 실험에서 모두 도착한 같은 자동차 ${matched.count}대를 비교해요.` : "두 실험에서 모두 도착한 자동차가 아직 없어요."}</p>${matched.count ? `<table id="matched-table"><thead><tr><th>같은 ${matched.count}대의 평균</th><th>시행 전</th><th>시행 후</th></tr></thead><tbody><tr><th>이동시간</th><td>${formatSeconds(matched.beforeTravel)}</td><td>${formatSeconds(matched.afterTravel)}</td></tr><tr><th>대기시간</th><td>${formatSeconds(matched.beforeWait)}</td><td>${formatSeconds(matched.afterWait)}</td></tr></tbody></table>` : ""}<p class="metric-note">전체 ${matched.total}대 중 두 번 모두 도착한 차만 비교해요. 다른 차의 변화는 위의 전체 결과와 함께 살펴보세요.</p></details>${pedestrianMarkup}`;
}

export function bindComparison(container: HTMLElement) {
  container.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-analysis-group]",
    );
    if (!button) return;
    const direction = button.dataset.analysisGroup === "direction";
    container.querySelector<HTMLElement>("#purpose-comparison")!.hidden =
      direction;
    container.querySelector<HTMLElement>("#direction-comparison")!.hidden =
      !direction;
    container
      .querySelectorAll<HTMLElement>("[data-analysis-group]")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
  });
  container.addEventListener(
    "toggle",
    (event) => {
      const opened = event.target as HTMLDetailsElement;
      if (!opened.open) return;
      container
        .querySelectorAll<HTMLDetailsElement>("details")
        .forEach((detail) => {
          if (detail !== opened) detail.open = false;
        });
    },
    true,
  );
}
