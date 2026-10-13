import { TrafficSimulation, MODEL_VERSION } from "./simulation";
import { CityRenderer, type Selection } from "./renderer/city";
import { CONFIG, createDemand, DEFAULT_POLICY, SCHOOL_NODE } from "./scenario";
import { POLICIES, policyCost } from "./policies";
import { formatSeconds } from "./metrics";
import { compareExperiments } from "./metrics/comparison";
import { comparisonMarkup, bindComparison } from "./ui/comparison";
import { signalPhase } from "./simulation/network";
import { createPedestrianDemand } from "./simulation/pedestrians";
import { icon } from "./ui/icons";
import { layout } from "./ui/layout";
import { createPanels } from "./ui/panels";
import type { PolicySelection } from "./types";
import {
  readDisplayQuality,
  saveDisplayQuality,
  RenderClock,
  type DisplayQuality,
} from "./renderer/quality";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const experiment = {
  seed: CONFIG.seed as number,
  duration: CONFIG.duration as number,
};
let demand = createDemand(experiment.seed);
let pedestrianDemand = createPedestrianDemand(experiment.seed);
let sim = new TrafficSimulation(
    DEFAULT_POLICY,
    demand,
    undefined,
    pedestrianDemand,
  ),
  baseline: TrafficSimulation | undefined;
let selectedPolicy: PolicySelection = { ...DEFAULT_POLICY },
  paused = false,
  speed = 2,
  overlay = false,
  mode: "observe" | "trial" | "done" = "observe",
  busy = false,
  muted = true;
let displayQuality = readDisplayQuality();
const renderClock = new RenderClock();
let selected: Selection = {
  kind: "node",
  id: SCHOOL_NODE,
  title: "학교 앞 교차로",
  description: "동서 방향의 짧은 초록불 때문에 등굣길이 막히고 있어요.",
};
let metrics = sim.stats;
document.querySelector("#app")!.innerHTML =
  layout +
  `
  <dialog id="results-dialog"><div class="dialog-top"><span class="eyebrow">우리의 정책 실험</span><button id="close-results" class="square" aria-label="결과 닫기">${icon("close")}</button></div><h2>우리 동네는 어떻게 달라졌을까요?</h2><p class="dialog-intro">자동차 140대와 보행자 60명이 같은 출발 조건으로 <span data-observation-minutes>7</span>분 동안 이동한 결과예요.</p><div id="result-summary"></div><div id="result-table"></div><p class="result-caution">도착한 차가 다르면 평균도 달라질 수 있어요. 미도착 차량과 전체 차량의 대기도 함께 살펴보세요. 출발지에서 길에 들어가지 못한 시간도 대기에 포함해요.</p><div id="result-analysis"></div><label class="reflection-label" for="reflection">시장님의 생각 <span>어떤 점이 좋아졌고, 누구에게 불편해졌나요?</span></label><textarea id="reflection" rows="3" placeholder="관찰한 변화와 다음에 시도할 방법을 적어 보세요."></textarea><div class="dialog-actions"><button id="export" class="secondary">실험 기록 저장</button><button id="try-again" class="primary">다른 정책으로 실험하기 ${icon("arrow", 17)}</button></div></dialog>
  <dialog id="help-dialog"><div class="dialog-top"><h2>시장님, 이렇게 해 보세요</h2><button id="close-help" class="square" aria-label="도움말 닫기">${icon("close")}</button></div><ol><li>길 위의 자동차와 학교 앞 대기 행렬을 관찰해요.</li><li>정책을 고르고 <b>선택한 정책 시행하기</b>를 눌러요.</li><li>같은 출발 조건으로 다시 움직이는 도시를 살펴봐요.</li><li>정한 관찰 시간이 지나면 결과를 비교하고 생각을 기록해요.</li></ol><p>왼쪽 드래그: 회전 · 오른쪽 드래그: 이동<br>휠: 확대·축소 · 스페이스: 일시정지<br>건물·도로·교차로 클릭: 정보 확인</p><p>혼잡도 색은 실제 차량의 수와 속도로 계산해요.<br>보행자는 초록불에 건너고, 차는 건너던 사람이 길을 비울 때까지 기다려요.</p><details class="experiment-settings display-settings"><summary>화면이 느릴 때</summary><p id="display-quality-note">가볍게 바꾸면 그림자를 줄이고 화면을 조금 덜 자주 그려요. 자동차의 움직임과 실험 결과는 똑같아요.</p><div class="quality-row"><label for="display-quality">화면 품질</label><select id="display-quality" aria-describedby="display-quality-note"><option value="normal">보통</option><option value="light">가볍게</option></select></div></details></dialog>
`;
const panels = createPanels();
bindComparison($("#result-analysis"));
let refreshingCity = false;
let inspectedPolicy: (typeof POLICIES)[number]["id"] = "signal";

let city: CityRenderer;
try {
  city = new CityRenderer($("#city-canvas"), $("#map-labels"), displayQuality);
} catch (error) {
  $(".city-view").innerHTML =
    '<div class="webgl-error"><h2>3D 화면을 열 수 없어요</h2><p>WebGL을 지원하는 최신 브라우저에서 하드웨어 가속을 켜고 다시 실행해 주세요.</p></div>';
  throw error;
}
city.onSelect = (value) => {
  selected = value;
  updateSelection();
  if (!refreshingCity) panels.open("selection");
};
function refreshCity() {
  refreshingCity = true;
  try {
    city.setSimulation(sim);
  } finally {
    refreshingCity = false;
  }
}
refreshCity();
const qualitySelect = $<HTMLSelectElement>("#display-quality");
qualitySelect.value = displayQuality;
qualitySelect.addEventListener("change", () => {
  if (!["normal", "light"].includes(qualitySelect.value)) return;
  displayQuality = qualitySelect.value as DisplayQuality;
  city.setQuality(displayQuality);
  saveDisplayQuality(displayQuality);
});
const audio = new Audio(`${import.meta.env.BASE_URL}audio/policy-confirm.wav`);
audio.volume = 0.28;
function toast(message: string) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  window.setTimeout(() => $("#toast").classList.remove("visible"), 3500);
}
function updateSelection() {
  $("#selection-title").textContent = selected.title;
  $("#selection-description").textContent = selected.description;
  if (selected.kind === "node") {
    const signal = sim.network.nodes.get(selected.id)?.signal;
    if (signal) {
      const phase = signalPhase(signal, sim.time);
      $("#selection-detail").innerHTML =
        `<span class="signal-pill ${phase === "ew-green" ? "go" : ""}"><i></i>동서 ${signal.ew}초</span><span class="signal-pill ${phase === "ns-green" ? "go" : ""}"><i></i>남북 ${signal.ns}초</span><small>${phase === "pedestrian-green" ? "보행 신호 · 차가 기다려요" : phase === "pedestrian-clearance" ? "건너던 사람이 길을 비우는 중" : phase === "all-red" ? "안전하게 비우는 중" : phase.endsWith("yellow") ? "노란불 · 진입 대기" : "초록불 방향만 출발"}</small>`;
      if (signal.walk) {
        const people = [...sim.pedestrians.active.values()].filter(
          (p) =>
            sim.pedestrians.routes.get(p.trip.routeId)?.nodeId === selected.id,
        );
        $("#selection-detail").innerHTML +=
          `<small>보행 대기 ${people.filter((p) => p.distance - p.previousDistance < 0.001).length}명 · 건너는 중 ${people.filter((p) => p.crossing).length}명</small>`;
      }
    } else $("#selection-detail").textContent = "";
  } else if (selected.kind === "road") {
    const road = metrics.roads.find((r) => r.id === selected.id);
    $("#selection-detail").textContent = road
      ? `통행 중 ${road.count}대 · 정차 ${road.stopped}대 · 평균 ${(road.meanSpeed * 3.6).toFixed(1)}km/h`
      : "";
  } else $("#selection-detail").textContent = "";
}
function updatePolicy() {
  for (const p of POLICIES) {
    $<HTMLInputElement>(`[data-policy="${p.id}"]`).checked =
      selectedPolicy[p.id];
    $(`[data-policy-card="${p.id}"]`).classList.toggle(
      "checked",
      selectedPolicy[p.id],
    );
  }
  $("#budget").textContent = String(CONFIG.budget - policyCost(selectedPolicy));
  $("#hud-budget").textContent = String(
    CONFIG.budget - policyCost(selectedPolicy),
  );
  const detail = POLICIES.find((p) => p.id === inspectedPolicy)!;
  $("#policy-target").textContent = detail.target;
  $("#policy-description").textContent = detail.description;
  $("#policy-tradeoff").textContent = detail.tradeoff;
  $("#signal-setting").hidden = !selectedPolicy.signal;
  $<HTMLInputElement>("#green").value = String(selectedPolicy.ewGreen);
  $<HTMLButtonElement>("#apply").disabled =
    busy || policyCost(selectedPolicy) === 0;
  $("#green-value").textContent = `${selectedPolicy.ewGreen}초`;
}
document.querySelectorAll<HTMLInputElement>("[data-policy]").forEach((input) =>
  input.addEventListener("change", () => {
    selectedPolicy[input.dataset.policy as "signal" | "bypass" | "oneWay"] =
      input.checked;
    inspectedPolicy = input.dataset.policy as typeof inspectedPolicy;
    updatePolicy();
  }),
);
$("#green").addEventListener("input", () => {
  selectedPolicy.ewGreen = Number($<HTMLInputElement>("#green").value);
  updatePolicy();
});
function setBusy(value: boolean) {
  busy = value;
  for (const selector of [
    "#reset",
    "#pause",
    "#finish",
    "#speed",
    "#new-experiment",
    "#experiment-seed",
    "#experiment-duration",
  ])
    $(selector).toggleAttribute("disabled", value);
  document
    .querySelectorAll<HTMLInputElement>("[data-policy],#green")
    .forEach((e) => (e.disabled = value));
  updatePolicy();
}
async function runToEnd(target: TrafficSimulation, visible: boolean) {
  while (target.time < experiment.duration - 0.01) {
    target.runUntil(Math.min(experiment.duration, target.time + 15));
    if (visible) {
      metrics = sim.stats;
      updateHud();
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  }
}
$("#apply").addEventListener("click", async () => {
  if (busy || policyCost(selectedPolicy) === 0) return;
  const chosen = { ...selectedPolicy };
  setBusy(true);
  paused = true;
  try {
    if (!baseline) {
      $("#footer-status").textContent =
        "동일한 조건의 정책 시행 전 결과를 계산하고 있어요.";
      baseline = new TrafficSimulation(
        DEFAULT_POLICY,
        demand,
        undefined,
        pedestrianDemand,
      );
      await runToEnd(baseline, false);
    }
    sim = new TrafficSimulation(chosen, demand, undefined, pedestrianDemand);
    metrics = sim.stats;
    mode = "trial";
    refreshCity();
    panels.close(true);
    paused = false;
    if (!muted) {
      audio.currentTime = 0;
      void audio.play().catch(() => toast("효과음을 재생할 수 없어요."));
    }
    toast("같은 출발 조건으로 정책 실험을 시작했어요.");
  } finally {
    setBusy(false);
    updateHud();
  }
});
function togglePause() {
  if (busy || sim.time >= experiment.duration) return;
  paused = !paused;
  updateHud();
}
$("#pause").addEventListener("click", togglePause);
$("#speed").addEventListener("change", () => {
  speed = Number($<HTMLSelectElement>("#speed").value);
});
$("#overlay").addEventListener("click", () => {
  overlay = !overlay;
  $("#overlay").setAttribute("aria-pressed", String(overlay));
  $("#overlay-legend").hidden = !overlay;
});
$("#focus-school").addEventListener("click", () => city.focusSchool());
$("#camera-reset").addEventListener("click", () => city.resetCamera());
$("#zoom-in").addEventListener("click", () => city.zoom(1.2));
$("#zoom-out").addEventListener("click", () => city.zoom(1 / 1.2));
$("#sound").addEventListener("click", () => {
  muted = !muted;
  $("#sound").setAttribute("aria-pressed", String(!muted));
  $("#sound").setAttribute("aria-label", muted ? "효과음 켜기" : "효과음 끄기");
  $("#sound").title = muted ? "효과음 켜기" : "효과음 끄기";
  toast(muted ? "효과음을 껐어요." : "정책을 시행할 때 효과음이 나와요.");
});
function resetExperiment() {
  if (busy) return;
  baseline = undefined;
  $<HTMLTextAreaElement>("#reflection").value = "";
  updateExperimentLabels();
  sim = new TrafficSimulation(
    DEFAULT_POLICY,
    demand,
    undefined,
    pedestrianDemand,
  );
  metrics = sim.stats;
  mode = "observe";
  selectedPolicy = { ...DEFAULT_POLICY };
  inspectedPolicy = "signal";
  paused = false;
  refreshCity();
  panels.close(true);
  updatePolicy();
  updateHud();
  toast("처음의 도시로 돌아왔어요.");
}
$("#reset").addEventListener("click", resetExperiment);
$("#new-experiment").addEventListener("click", () => {
  if (busy) return;
  const seed = Number($<HTMLSelectElement>("#experiment-seed").value);
  const duration = Number($<HTMLSelectElement>("#experiment-duration").value);
  if (![2404, 2405, 2406].includes(seed) || ![180, 420, 600].includes(duration))
    return;
  experiment.seed = seed;
  experiment.duration = duration;
  demand = createDemand(seed);
  pedestrianDemand = createPedestrianDemand(seed);
  resetExperiment();
  toast("새 관찰을 시작했어요. 정책 전후에는 같은 출발 조건을 써요.");
});
function updateExperimentLabels() {
  document
    .querySelectorAll<HTMLElement>("[data-observation-minutes]")
    .forEach((e) => (e.textContent = String(experiment.duration / 60)));
  document
    .querySelectorAll<HTMLElement>("[data-observation-end]")
    .forEach(
      (e) =>
        (e.textContent =
          "08:" + String(experiment.duration / 60).padStart(2, "0")),
    );
  $("#finish").title =
    String(experiment.duration / 60) + "분 관찰을 끝까지 빠르게 보기";
  $<HTMLSelectElement>("#experiment-seed").value = String(experiment.seed);
  $<HTMLSelectElement>("#experiment-duration").value = String(
    experiment.duration,
  );
}
$("#finish").addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  paused = true;
  try {
    await runToEnd(sim, true);
    finishRun();
  } finally {
    setBusy(false);
    updateHud();
  }
});
$("#show-results").addEventListener("click", showResults);
$("#close-results").addEventListener("click", () =>
  $<HTMLDialogElement>("#results-dialog").close(),
);
$("#try-again").addEventListener("click", () => {
  $<HTMLDialogElement>("#results-dialog").close();
  toast("정책을 바꾼 뒤 다시 시행해 보세요. 예산은 실험마다 새로 계산해요.");
  panels.open("policy");
});
$("#help").addEventListener("click", () =>
  $<HTMLDialogElement>("#help-dialog").showModal(),
);
$("#close-help").addEventListener("click", () =>
  $<HTMLDialogElement>("#help-dialog").close(),
);
document.addEventListener("keydown", (event) => {
  if (
    event.code === "Space" &&
    !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(
      (event.target as HTMLElement).tagName,
    ) &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    togglePause();
  }
});
function finishRun() {
  paused = true;
  if (mode === "trial") {
    mode = "done";
    showResults();
  } else if (mode === "observe") {
    baseline = sim;
    toast("관찰을 마쳤어요. 이제 정책을 선택해 보세요.");
  }
}
function resultRows() {
  const before = baseline!.stats,
    after = sim.stats;
  return [
    [
      "목적지에 도착한 차",
      `${before.arrived}대`,
      `${after.arrived}대`,
      after.arrived - before.arrived,
      false,
    ],
    [
      "평균 이동시간 · 도착 차량",
      formatSeconds(before.averageTravelTime),
      formatSeconds(after.averageTravelTime),
      before.averageTravelTime === null || after.averageTravelTime === null
        ? null
        : after.averageTravelTime - before.averageTravelTime,
      true,
    ],
    [
      "평균 대기시간 · 도착 차량",
      formatSeconds(before.averageWaitingTime),
      formatSeconds(after.averageWaitingTime),
      before.averageWaitingTime === null || after.averageWaitingTime === null
        ? null
        : after.averageWaitingTime - before.averageWaitingTime,
      true,
    ],
    [
      "전체 차량 1대당 누적 대기",
      formatSeconds(before.averageDemandWait),
      formatSeconds(after.averageDemandWait),
      before.averageDemandWait === null || after.averageDemandWait === null
        ? null
        : after.averageDemandWait - before.averageDemandWait,
      true,
    ],
    [
      "아직 도착하지 못한 차",
      `${140 - before.arrived}대`,
      `${140 - after.arrived}대`,
      before.arrived - after.arrived,
      true,
    ],
    [
      "출발지에서 기다리는 차",
      `${before.queued}대`,
      `${after.queued}대`,
      after.queued - before.queued,
      true,
    ],
  ] as const;
}
function showResults() {
  if (!baseline || mode !== "done") return;
  panels.close();
  $("#result-analysis").innerHTML = comparisonMarkup(
    compareExperiments(baseline, sim),
  );
  const difference = sim.stats.arrived - baseline.stats.arrived;
  $("#result-summary").innerHTML =
    `<div class="result-highlight" data-outcome="${difference < 0 ? "worse" : difference > 0 ? "better" : "same"}"><span>${icon("car", 29)}</span><div><strong>${difference > 0 ? `도착한 차가 ${difference}대 늘었어요` : difference < 0 ? `도착한 차가 ${-difference}대 줄었어요` : "도착한 차의 수는 같아요"}</strong><p>${POLICIES.filter(
      (p) => sim.policy[p.id],
    )
      .map((p) => p.title)
      .join(" + ")} · 사용 예산 ${policyCost(sim.policy)}</p></div></div>`;
  $("#result-table").innerHTML =
    `<table><thead><tr><th>관찰한 것</th><th>시행 전</th><th>시행 후</th><th>변화</th></tr></thead><tbody>${resultRows()
      .map(
        ([label, before, after, delta, lower]) =>
          `<tr><th>${label}</th><td>${before}</td><td>${after}</td><td class="${delta === null || Math.abs(delta) < 0.05 ? "" : (lower ? delta < 0 : delta > 0) ? "better" : "worse"}">${delta === null ? "집계 중" : Math.abs(delta) < 0.05 ? "같음" : `${delta > 0 ? "+" : ""}${Number.isInteger(delta) ? delta : delta.toFixed(1)}${label.includes("차") && !label.includes("시간") && !label.includes("누적") ? "대" : "초"}`}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  if (!$<HTMLDialogElement>("#results-dialog").open)
    $<HTMLDialogElement>("#results-dialog").showModal();
}
$("#export").addEventListener("click", () => {
  const data = {
    schemaVersion: 3,
    modelVersion: MODEL_VERSION,
    laneChangesBefore: baseline?.laneChangeEvents,
    laneChangesAfter: sim.laneChangeEvents,
    analysis: compareExperiments(baseline!, sim),
    scenario: "막히는 등굣길",
    seed: experiment.seed,
    duration: experiment.duration,
    demand,
    policy: sim.policy,
    budget: CONFIG.budget - policyCost(sim.policy),
    before: baseline?.stats,
    after: sim.stats,
    completedBefore: baseline?.completed,
    completedAfter: sim.completed,
    pedestrianDemand,
    pedestriansBefore: baseline?.pedestrians.stats,
    pedestriansAfter: sim.pedestrians.stats,
    completedPedestriansBefore: baseline?.pedestrians.completed,
    completedPedestriansAfter: sim.pedestrians.completed,
    reflection: $<HTMLTextAreaElement>("#reflection").value,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "우리동네-정책실험.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("실험 기록을 저장했어요.");
});
function updateHud() {
  metrics = sim.stats;
  const walkers = sim.pedestrians.stats;
  $("#pedestrian-status").textContent =
    `도착 ${walkers.arrived} / ${pedestrianDemand.length}명 · 걷거나 기다리는 중 ${walkers.active}명`;
  $("#pedestrian-wait").textContent =
    `신호·줄 대기 ${walkers.waiting}명 · 건너는 중 ${walkers.crossing}명 · 출발 대기 ${walkers.queued}명 · 출발 예정 ${walkers.unreleased}명`;
  $("#pedestrian-average").textContent =
    `1인당 누적 대기 ${formatSeconds(walkers.averageWaitingTime)}`;
  const seconds = Math.min(experiment.duration, Math.floor(sim.time));
  $("#clock").textContent =
    `08:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  $("#elapsed").textContent =
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} / ${experiment.duration / 60}:00`;
  $("#progress").style.width = `${(sim.time / experiment.duration) * 100}%`;
  $("#pause").innerHTML = icon(paused ? "play" : "pause");
  $("#pause").setAttribute("aria-label", paused ? "재생" : "일시정지");
  $<HTMLButtonElement>("#pause").disabled =
    busy || sim.time >= experiment.duration;
  $("#pause").title =
    sim.time >= experiment.duration
      ? String(experiment.duration / 60) + "분 관찰을 마쳤어요"
      : paused
        ? "재생 (스페이스)"
        : "일시정지 (스페이스)";
  $("#arrived").textContent = String(metrics.arrived);
  $("#hud-arrived").textContent = String(metrics.arrived);
  $("#arrival-bar").style.width = `${(metrics.arrived / 140) * 100}%`;
  $("#travel").textContent = formatSeconds(metrics.averageTravelTime);
  $("#wait").textContent = formatSeconds(metrics.averageWaitingTime);
  $("#active").textContent = `${metrics.active}대`;
  $("#stopped").textContent = `${metrics.stopped}대`;
  $("#queue-note").textContent =
    `출발 대기 ${metrics.queued}대 · 출발 예정 ${metrics.unreleased}대`;
  const jam = metrics.stopped > 25;
  $("#traffic-status").classList.toggle("congested", jam);
  $("#traffic-status strong").textContent = jam
    ? "차들이 길게 기다리고 있어요"
    : metrics.active
      ? "차들이 동네를 지나고 있어요"
      : "차들이 출발하고 있어요";
  $("#traffic-status div > span").textContent = jam
    ? "학교 가는 길의 대기 행렬을 살펴보세요."
    : "자동차의 신호와 움직임을 살펴보세요.";
  if (
    !$("#panel-traffic").hidden &&
    $<HTMLDetailsElement>(".vehicle-history").open
  )
    updateTrafficDetails();
  for (const step of ["observe", "trial", "done"])
    $(`#step-${step}`).classList.toggle("active", mode === step);
  updateStatus();
  updateSelection();
}
function updateTrafficDetails() {
  const points = sim.history
    .map(
      (p) =>
        `${(p.time / experiment.duration) * 240},${80 - (Math.min(p.stopped, 120) / 120) * 70}`,
    )
    .join(" ");
  $("#chart-line").setAttribute("points", `0,80 ${points}`);
  const roads = [...metrics.roads]
    .sort((a, b) => b.congestion - a.congestion)
    .slice(0, 3);
  $("#road-list").innerHTML = roads
    .map(
      (r, i) =>
        `<button class="road-row" data-road="${r.id}" aria-label="${r.name} 정차 ${r.stopped}대"><span><i>${i + 1}</i>${r.name}</span><strong>${r.stopped}대 정차</strong><span class="road-meter"><i style="width:${r.congestion * 100}%;background:${r.congestion < 0.35 ? "#769c84" : r.congestion < 0.62 ? "#c3a865" : "#bd7863"}"></i></span></button>`,
    )
    .join("");
  document
    .querySelectorAll<HTMLButtonElement>("[data-road]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const road = sim.network.roads.get(button.dataset.road!)!;
        city.select({
          kind: "road",
          id: road.id,
          title: road.name,
          description: "실제 차량의 수와 속도로 막히는 정도를 계산해요.",
        });
      }),
    );
}
function updateStatus() {
  $("#mode-label").textContent =
    mode === "observe"
      ? sim.time >= experiment.duration
        ? "시행 전 · 관찰 완료"
        : "정책 시행 전 · 관찰 중"
      : mode === "trial"
        ? "정책 시행 후 · 실험 중"
        : "정책 시행 후 · 실험 완료";
  $<HTMLButtonElement>("#show-results").disabled = mode !== "done";
  $("#show-results .notification-dot").hidden = mode !== "done";
  $("#show-results").title =
    mode === "done"
      ? "정책 전후 결과 보기"
      : "정책 실험을 마치면 결과를 비교할 수 있어요.";
  $("#next-policy").hidden = !(
    mode === "observe" && sim.time >= experiment.duration
  );
  $("#finish").hidden = sim.time >= experiment.duration;
  if (!busy)
    $("#footer-status").textContent =
      mode === "observe" && sim.time >= experiment.duration
        ? "관찰 완료! 정책을 골라 등굣길을 바꿔 보세요."
        : paused
          ? "잠시 멈췄어요. 도시를 자유롭게 살펴보세요."
          : mode === "trial"
            ? "선택한 정책을 적용해 같은 이동 수요로 다시 달리고 있어요."
            : sim.time >= experiment.duration
              ? "관찰 완료! 정책을 골라 등굣길을 바꿔 보세요."
              : "학교 앞 교차로를 눌러 살펴보세요.";
}
updateExperimentLabels();
updatePolicy();
updateHud();
let lastTime = performance.now(),
  lastHud = 0;
function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  if (!paused && !busy) {
    sim.advance(Math.min(dt * speed, experiment.duration - sim.time));
    if (sim.time >= experiment.duration - 1e-8) finishRun();
  }
  if (now - lastHud > 250) {
    updateHud();
    lastHud = now;
  }
  if (renderClock.due(now, displayQuality)) {
    city.render(sim, overlay, metrics.roads, paused);
  }
  requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange", () => {
  lastTime = performance.now();
});
requestAnimationFrame(frame);
// Read-only inspection endpoint for reproducible browser QA, with no production controls.
if (import.meta.env.DEV)
  Object.defineProperty(window, "__mayor", {
    value: {
      get simulation() {
        return sim;
      },
      get baseline() {
        return baseline;
      },
      get mode() {
        return mode;
      },
      get busy() {
        return busy;
      },
      get drawCalls() {
        return city.drawCalls;
      },
      get displaySettings() {
        return city.displaySettings;
      },
    },
  });
