import {
  WaterSimulation,
  WATER_SITES,
  WATER_MODEL_VERSION,
  DEFAULT_WATER_PLAN,
  waterTargets,
  type WaterPlan,
  type WaterPolicyId,
} from "./simulation/water";
import {
  waterFact,
  waterSelection,
  waterObservation,
  waterSummary,
  waterSources,
  waterResults,
} from "./ui/water";
import { installRecordTools } from "./ui/records";
import type { PlacementTarget } from "./renderer/placement";
import {
  DumpingSimulation,
  DUMPING_SITES,
  DUMPING_MODEL_VERSION,
  DEFAULT_DUMPING_PLAN,
  OBSERVATION_ROUND_SECONDS,
  type DumpingPlan,
  type DumpingPolicyId,
  dumpingBinPosition,
} from "./simulation/services/dumping";
import {
  dumpingFact,
  dumpingSelection,
  dumpingObservation,
  dumpingSummary,
  dumpingCollection,
  dumpingResults,
} from "./ui/dumping";
import {
  ParkingSimulation,
  PARKING_SITES,
  DEFAULT_PARKING_PLAN,
  PARKING_MODEL_VERSION,
  type ParkingPlan,
} from "./simulation/parking";
import {
  parkingControls,
  parkingObservation,
  parkingSelection,
  parkingResults,
  parkingFact,
} from "./ui/parking";
import { Inquiry } from "./inquiry";
import { inquiryPanel, inquiryMarkup, type InquiryContext } from "./ui/inquiry";
import {
  LogisticsSimulation,
  LOGISTICS_MODEL_VERSION,
} from "./simulation/economy";
import {
  logisticsObservation,
  logisticsResults,
  logisticsSelection,
} from "./ui/logistics";
import { getScenario, type MapLayer } from "./scenarios";
import {
  WasteSimulation,
  WASTE_MODEL_VERSION,
} from "./simulation/services/waste";
import { CITY_FACILITIES, districtName } from "./city/data";
import {
  scenarioDialogs,
  wasteObservation,
  wasteResults,
  truckPhase,
  escapeHtml,
} from "./ui/scenarios";
import { residentVoices } from "./simulation/residents";
import {
  EnvironmentSimulation,
  ENVIRONMENT_MODEL_VERSION,
} from "./simulation/environment";
import {
  environmentControls,
  environmentObservation,
  environmentSelection,
  environmentResults,
} from "./ui/environment";
import {
  FacilitySimulation,
  FACILITY_MODEL_VERSION,
  DEFAULT_FACILITY_PLAN,
  FACILITY_SITES,
  type ServiceKind,
  type FacilityPlan,
  facilityPlanCost,
  FACILITY_FOOTPRINT,
} from "./simulation/facilities";
import {
  accessControls,
  facilityPlanningControls,
  facilityObservation,
  facilitySelection,
  facilityResults,
  facilityPlanMarkup,
} from "./ui/facilities";
import { TrafficSimulation, MODEL_VERSION } from "./simulation";
import { CityRenderer, type Selection } from "./renderer/city";
import { CONFIG, createDemand, DEFAULT_POLICY, SCHOOL_NODE } from "./scenario";
import { POLICIES, policyCost } from "./policies";
import { formatSeconds } from "./metrics";
import { compareExperiments } from "./metrics/comparison";
import { compareScenario } from "./metrics/scenarios";
import { comparisonMarkup, bindComparison } from "./ui/comparison";
import { signalPhase } from "./simulation/network";
import { createPedestrianDemand } from "./simulation/pedestrians";
import { icon } from "./ui/icons";
import { layout } from "./ui/layout";
import { layerNames } from "./ui/map-layers";
import { createPanels } from "./ui/panels";
import type { PolicySelection } from "./types";
import { CITY_LAYOUT_VERSION, WASTE_DEPOT } from "./city/world";
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
let scenario = getScenario("traffic");
let facilityPlan: FacilityPlan = { ...DEFAULT_FACILITY_PLAN, buildings: [] };
let parkingPlan: ParkingPlan = { ...DEFAULT_PARKING_PLAN };
let waterPlan: WaterPlan = { ...DEFAULT_WATER_PLAN };
let dumpingPlan: DumpingPlan = { ...DEFAULT_DUMPING_PLAN };
type PlacementKind = "patrol" | "parkingLot" | "loadingBay" | "facilityPlot";
let placement:
  | {
      kind: PlacementKind | DumpingPolicyId | WaterPolicyId;
      wasPaused: boolean;
    }
  | undefined;
let inquiry = new Inquiry();
let accessService: ServiceKind = "library";
let facilityObservationRun: FacilitySimulation | undefined;
let facilityObservationKind: ServiceKind | undefined;
let chosenIds: string[] = [];
let mapLayer: MapLayer = "normal";
const investigations: { kind: string; time: number; facts: unknown }[] = [];
let demand = createDemand(experiment.seed);
let pedestrianDemand = createPedestrianDemand(experiment.seed);
function createRun(ids: readonly string[] = [], green = 26) {
  return scenario.create(
    {
      ...experiment,
      demand,
      pedestrians: pedestrianDemand,
      parkingPlan,
      dumpingPlan,
      waterPlan,
      facilityPlan: {
        ...facilityPlan,
        buildings: facilityPlan.buildings?.filter((b) => ids.includes(b.kind)),
      },
    },
    ids,
    green,
  );
}
let sim = createRun(),
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
  scenarioDialogs +
  `
  <dialog id="results-dialog"><div class="dialog-top"><span class="eyebrow">우리의 정책 실험</span><button id="close-results" class="square" aria-label="결과 닫기">${icon("close")}</button></div><h2>우리 동네는 어떻게 달라졌을까요?</h2><p class="dialog-intro">자동차 140대와 보행자 60명이 같은 출발 조건으로 <span data-observation-minutes>7</span>분 동안 이동한 결과예요.</p><div id="result-summary"></div><div id="result-table"></div><p class="result-caution">도착한 차가 다르면 평균도 달라질 수 있어요. 미도착 차량과 전체 차량의 대기도 함께 살펴보세요. 출발지에서 길에 들어가지 못한 시간도 대기에 포함해요.</p><div id="result-analysis"></div><label class="reflection-label" for="reflection">시장님의 생각 <span>어떤 점이 좋아졌고, 누구에게 불편해졌나요?</span></label><textarea id="reflection" rows="3" maxlength="600" placeholder="관찰한 변화와 다음에 시도할 방법을 적어 보세요."></textarea><div class="dialog-actions"><button id="print-current" class="secondary">관찰지 인쇄</button><button id="export" class="secondary">실험 기록 저장</button><button id="try-again" class="primary">다른 정책으로 실험하기 ${icon("arrow", 17)}</button></div></dialog>
  <dialog id="help-dialog"><div class="dialog-top"><h2>시장님, 이렇게 해 보세요</h2><button id="close-help" class="square" aria-label="도움말 닫기">${icon("close")}</button></div><ol><li>길 위의 자동차와 학교 앞 대기 행렬을 관찰해요.</li><li>정책을 고르고 <b>선택한 정책 시행하기</b>를 눌러요.</li><li>같은 출발 조건으로 다시 움직이는 도시를 살펴봐요.</li><li>정한 관찰 시간이 지나면 결과를 비교하고 생각을 기록해요.</li></ol><p>왼쪽 드래그: 회전 · 오른쪽 드래그: 이동<br>휠: 확대·축소 · 스페이스: 일시정지<br>건물·도로·교차로 클릭: 정보 확인</p><p>혼잡도 색은 실제 차량의 수와 속도로 계산해요.<br>보행자는 초록불에 건너고, 차는 건너던 사람이 길을 비울 때까지 기다려요.</p><details class="experiment-settings display-settings"><summary>화면이 느릴 때</summary><p id="display-quality-note">가볍게 바꾸면 그림자를 줄이고 화면을 조금 덜 자주 그려요. 자동차의 움직임과 실험 결과는 똑같아요.</p><div class="quality-row"><label for="display-quality">화면 품질</label><select id="display-quality" aria-describedby="display-quality-note"><option value="normal">보통</option><option value="light">가볍게</option></select></div></details></dialog>
`;
$(".workspace").insertAdjacentHTML("beforeend", inquiryPanel);
$("#panel-mission .steps").insertAdjacentHTML(
  "beforebegin",
  '<button class="primary wide inquiry-start" data-open-panel="inquiry" aria-controls="panel-inquiry" aria-expanded="false">우리 동네 조사 시작 →</button>',
);
$(".tools").insertAdjacentHTML(
  "afterbegin",
  `<button class="tool" data-open-panel="inquiry" aria-controls="panel-inquiry" aria-expanded="false"><span class="tool-icon">${icon("eye", 25)}</span><span>우리 동네 조사</span></button>`,
);
const panels = createPanels((name) => {
  if (placement) cancelPlacement(false);
  if (name === "inquiry") {
    paused = true;
    renderInquiry();
    updateHud();
  }
  if (name === "residents")
    city.setResidentVoices(
      residentVoices(sim, mode === "done" ? baseline : undefined),
    );
  city.setResidentMode(name === "residents");
});
$(".policy-list").insertAdjacentHTML("beforebegin", facilityPlanningControls);
$(".policy-list").insertAdjacentHTML("afterend", parkingControls);
$(".policy-list").insertAdjacentHTML(
  "afterend",
  '<div id="dumping-plan" hidden><p class="metric-note">정책을 고르고 지도에서 적용할 현장을 선택해요.</p><div id="dumping-locations"></div></div>',
);
$("#waste-observation").insertAdjacentHTML(
  "afterend",
  `<div id="dumping-observation" hidden>${dumpingObservation}</div>`,
);
$("#facility-plan").insertAdjacentHTML(
  "afterbegin",
  '<button id="pick-facility-plot" class="primary wide">지도에서 공터 선택</button>',
);
$("#waste-observation").insertAdjacentHTML(
  "afterend",
  `<div id="parking-observation" hidden>${parkingObservation}</div>`,
);
$("#waste-observation").insertAdjacentHTML("afterend", accessControls);
$("#waste-observation").insertAdjacentHTML("afterend", environmentControls);
$("#waste-observation").insertAdjacentHTML(
  "afterend",
  '<div id="logistics-observation" hidden></div>',
);
bindComparison($("#result-analysis"));
let refreshingCity = false;
let inspectedPolicy = "signal";

let city: CityRenderer;
try {
  city = new CityRenderer($("#city-canvas"), $("#map-labels"), displayQuality);
} catch (error) {
  $(".city-view").innerHTML =
    '<div class="webgl-error"><h2>3D 화면을 열 수 없어요</h2><p>WebGL을 지원하는 최신 브라우저에서 하드웨어 가속을 켜고 다시 실행해 주세요.</p></div>';
  throw error;
}
city.onSelect = (value) => {
  if (placement && !refreshingCity) return;
  selected = value;
  updateSelection();
  if (!refreshingCity) {
    panels.open(
      "selection",
      value.kind === "policy"
        ? (document.activeElement as HTMLElement)
        : undefined,
    );
    investigate(
      (value.kind === "policy" ? "적용 정책: " : "장소: ") + value.title,
    );
  }
};
city.onResidentSelect = (voice, index, count) => {
  $("#resident-count").textContent = `${index + 1} / ${count}`;
  if (!$("#panel-residents").hidden) investigate("주민 의견: " + voice.group);
};
$("#resident-previous").addEventListener("click", () => city.nextResident(-1));
$("#resident-next").addEventListener("click", () => city.nextResident(1));
function refreshCity() {
  refreshingCity = true;
  try {
    city.setSimulation(sim);
    city.setAccessService(accessService);
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
$("#panel-policy .panel-body").insertAdjacentHTML(
  "afterbegin",
  '<div id="water-plan" hidden><p class="metric-note">정책을 고르고 지도에서 적용할 곳을 선택해요.</p><div id="water-locations"></div></div>',
);
$("#panel-traffic .panel-body").insertAdjacentHTML(
  "beforeend",
  `<div id="water-observation" hidden>${waterObservation}</div>`,
);
const audio = new Audio(`${import.meta.env.BASE_URL}audio/policy-confirm.wav`);
audio.volume = 0.28;
function toast(message: string) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  window.setTimeout(() => $("#toast").classList.remove("visible"), 3500);
}
function updateSelection() {
  if (sim instanceof WaterSimulation && selected.kind === "water") {
    $("#selection-title").textContent = selected.title;
    $("#selection-description").textContent = selected.description;
    const root = $("#selection-detail"),
      open = root.querySelector("details")?.open;
    const focused = root.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    root.innerHTML = waterSelection(sim, selected.id);
    if (open) root.querySelector("details")!.open = true;
    if (focused?.tagName === "SUMMARY")
      root.querySelector("summary")?.focus({ preventScroll: true });
    else if (focused?.dataset.waterInquiry)
      root
        .querySelector<HTMLElement>("[data-water-inquiry]")
        ?.focus({ preventScroll: true });
    return;
  }
  $("#selection-title").textContent = selected.title;
  $("#selection-description").textContent = selected.description;
  if (sim instanceof ParkingSimulation && selected.kind === "parking") {
    $("#selection-detail").innerHTML = parkingSelection(sim, selected.id);
    return;
  }
  if (sim instanceof DumpingSimulation && selected.kind === "dumping") {
    const detail = $("#selection-detail"),
      open = detail.querySelector("details")?.open;
    const focused = (document.activeElement as HTMLElement | null)?.closest(
      "#selection-detail",
    )
      ? (document.activeElement as HTMLElement)
      : null;
    detail.innerHTML = dumpingSelection(sim, selected.id);
    if (open) detail.querySelector("details")!.open = true;
    if (focused?.tagName === "SUMMARY")
      detail.querySelector("summary")?.focus({ preventScroll: true });
    else if (focused?.dataset.dumpingInquiry)
      detail
        .querySelector<HTMLElement>("[data-dumping-inquiry]")
        ?.focus({ preventScroll: true });
    return;
  }
  if (sim instanceof ParkingSimulation && selected.kind === "plot") {
    $("#selection-detail").innerHTML =
      `<p>공동주차장 · 예산 55 · 최소 400㎡. 가까운 차량만 이용해요. 이 실험에서 같은 공터를 다른 시설에 쓸 수 없어요.</p><button class="secondary wide" data-parking-plot="${selected.id}">이 공터로 주차장 계획</button>`;
    return;
  }
  if (selected.kind === "river" && sim instanceof WaterSimulation) {
    $("#selection-detail").innerHTML =
      `<p>상류 → 하류로 흘러요. 색은 가상 오염도, 봉투는 물 위 쓰레기예요.</p>${WATER_SITES.map((s) => `<button class="secondary wide" data-water-site="${s.id}">${s.name} 조사하기</button>`).join("")}`;
    return;
  }
  if (selected.kind === "river") {
    $("#selection-detail").innerHTML =
      '<p>북쪽 상류 → 남쪽 하류로 흘러요. 세 곳의 다리를 건너 주거·상업지구와 산업지구를 오갈 수 있어요.</p><p>공장·쓰레기처리장의 위치와 하류 지역을 함께 살펴봐요. 하천 부지는 건설할 수 없어요.</p><p class="metric-note">현재 물 색은 하천을 구분하는 표시예요. 수질이나 오염 확산 수치는 아직 계산하지 않아요.</p>';
    return;
  }
  if (
    selected.kind === "plot" &&
    sim instanceof WaterSimulation &&
    sim.configuration.sewer &&
    sim.plan.sewer === selected.id
  ) {
    $("#selection-detail").innerHTML =
      `<p>생활하수 처리 시설 · 사용 면적 144㎡ · 예산 55</p><p>${sim.time <= 300 ? "공사 중이에요. 2차 관찰부터 연결된 하수를 처리해요." : "연결된 생활하수를 처리하고 있어요."} 이 실험에서는 이 공터를 다른 시설과 함께 사용할 수 없어요.</p><p class="metric-note">기존 자원순환센터와 별개의 시설이에요. 공장 배출과 다른 하수관은 처리하지 않아요.</p>`;
    return;
  }
  if (selected.kind === "plot" && !(sim instanceof FacilitySimulation)) {
    $("#selection-detail").innerHTML =
      `<p>도서관 400㎡ · 예산 55<br>공원 900㎡ · 예산 35</p><button class="secondary" data-plan-plot="${selected.id}">이 공터로 시설 계획 시작</button><p class="metric-note">시설 시나리오의 새 계획으로 이동해요.</p>`;
    return;
  }
  if (selected.kind === "policy") {
    const place = city.appliedPolicy(selected.id);
    if (place) {
      $("#selection-title").textContent = place.name;
      $("#selection-description").textContent =
        `${place.scope} · 시행한 정책 ${place.policies.length}개`;
    }
    const html = place
      ? place.policies
          .map(
            (p) =>
              `<article class="applied-policy-detail"><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.detail)}</p><small>함께 생각해요</small><p>${escapeHtml(p.tradeoff)}</p></article>`,
          )
          .join("")
      : "이 관찰에는 적용하지 않은 정책이에요.";
    if ($("#selection-detail").innerHTML !== html)
      $("#selection-detail").innerHTML = html;
    return;
  }
  if (
    sim instanceof LogisticsSimulation &&
    ["building", "supply", "service"].includes(selected.kind)
  ) {
    const html = logisticsSelection(sim, selected.kind, selected.id);
    if (html) {
      const detail = $("#selection-detail"),
        open = detail.querySelector<HTMLDetailsElement>("details")?.open;
      const focused = document.activeElement?.matches("#cargo-route summary");
      if (detail.innerHTML !== html) {
        detail.innerHTML = html;
        const details = detail.querySelector<HTMLDetailsElement>("details");
        if (details && open) details.open = true;
        if (focused)
          detail
            .querySelector<HTMLElement>("summary")
            ?.focus({ preventScroll: true });
      }
      return;
    }
  }
  if (
    sim instanceof EnvironmentSimulation &&
    ["building", "development"].includes(selected.kind)
  ) {
    const html = environmentSelection(sim, selected.id);
    if (html) {
      $("#selection-description").textContent =
        selected.kind === "development"
          ? "개발 면적과 남은 녹지를 비교해요."
          : "이 장소의 환경 부담을 비교해요.";
      if ($("#selection-detail").innerHTML !== html)
        $("#selection-detail").innerHTML = html;
      return;
    }
  }
  if (
    sim instanceof FacilitySimulation &&
    ["building", "civic", "plot"].includes(selected.kind)
  ) {
    const html = facilitySelection(sim, selected.id, accessService);
    if ($("#selection-detail").innerHTML !== html)
      $("#selection-detail").innerHTML = html;
    return;
  }
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
  } else if (selected.kind === "service" && sim instanceof WasteSimulation) {
    const wasOpen =
      $("#selection-detail").querySelector<HTMLDetailsElement>("details")?.open;
    const truck = sim.trucks.find((t) => String(t.id) === selected.id);
    if (!truck) {
      $("#selection-detail").textContent =
        "이 관찰에는 배정되지 않은 수거차예요.";
      return;
    }
    const vehicle = sim.vehicles.get(truck.id);
    const roads =
      vehicle?.route
        .slice(vehicle.routeIndex)
        .map((id) => sim.network.roads.get(id)!.name) ?? [];
    $("#selection-detail").innerHTML =
      `<p>${truckPhase[truck.phase]} · 적재 ${truck.load.toFixed(1)} / ${truck.capacity}봉투</p><p>다음 목적지: ${truck.target === "depot" ? "처리시설" : sim.sites.find((s) => s.id === truck.target)?.name}</p><details class="traffic-details"><summary>수거 순서와 현재 경로</summary><p>${truck.itinerary.map((id) => (sim instanceof WasteSimulation ? sim.sites.find((s) => s.id === id)!.name : "")).join(" → ")}</p><p>${roads.length ? roads.join(" → ") : "출발을 준비하거나 수거를 마쳤어요."}</p></details>`;
    if (wasOpen)
      $("#selection-detail").querySelector<HTMLDetailsElement>(
        "details",
      )!.open = true;
  } else {
    const facility = CITY_FACILITIES.find((f) => f.id === selected.id);
    const site =
      sim instanceof WasteSimulation
        ? sim.sites.find((s) => s.facilityId === selected.id)
        : undefined;
    $("#selection-detail").innerHTML = facility
      ? `<p>${districtName(facility.districtId)} · ${facility.purpose}<br>가상 거주 ${facility.population}명 · 이용 ${facility.users}명</p>${site ? `<p>남은 쓰레기 ${site.remaining.toFixed(1)}봉투<br>수거 ${site.collected.toFixed(1)}봉투 · 새 발생 ${site.generated.toFixed(1)}봉투</p>` : sim instanceof WasteSimulation && selected.id === WASTE_DEPOT.id ? `<p>처리시설에 내려놓은 양 ${sim.disposed.toFixed(1)}봉투</p>` : ""}`
      : "";
  }
}
function chosenCost() {
  if (scenario.id === "facilities")
    return facilityPlanCost(chosenIds, facilityPlan);
  return scenario.policies.reduce(
    (n, p) => n + (chosenIds.includes(p.id) ? p.cost : 0),
    0,
  );
}
function syncBuildingPolicies() {
  chosenIds = [
    ...chosenIds.filter((id) => id !== "library" && id !== "park"),
    ...new Set((facilityPlan.buildings ?? []).map((b) => b.kind)),
  ];
}
function updatePolicy() {
  $("#water-plan").hidden = scenario.id !== "water";
  if (scenario.id === "water")
    $("#water-locations").innerHTML = scenario.policies
      .filter((p) => chosenIds.includes(p.id))
      .map(
        (p) =>
          `<div class="policy-location"><div><small>${p.title} · 적용 예정</small><strong>${waterTargets(p.id as WaterPolicyId).find((t) => t.id === waterPlan[p.id as WaterPolicyId])!.name}</strong></div><button class="secondary" data-pick-water="${p.id}" ${busy ? "disabled" : ""}>위치 변경</button></div>`,
      )
      .join("");
  $("#dumping-plan").hidden = scenario.id !== "dumping";
  if (scenario.id === "dumping")
    $("#dumping-locations").innerHTML = scenario.policies
      .filter((p) => chosenIds.includes(p.id))
      .map(
        (p) =>
          `<div class="policy-location"><div><small>${p.title} · 적용 예정</small><strong>${DUMPING_SITES.find((s) => s.id === dumpingPlan[p.id as DumpingPolicyId])!.name}</strong></div><button class="secondary" data-pick-dumping="${p.id}" ${busy ? "disabled" : ""}>위치 변경</button></div>`,
      )
      .join("");
  $("#parking-plan").hidden = scenario.id !== "parking";
  if (scenario.id === "parking") {
    $("#parking-locations").innerHTML = scenario.policies
      .filter((p) => chosenIds.includes(p.id))
      .map((p) => {
        const name =
          p.id === "parkingLot"
            ? FACILITY_SITES.find((s) => s.id === parkingPlan.siteId)!.name
            : PARKING_SITES.find(
                (s) =>
                  s.id ===
                  (p.id === "patrol"
                    ? parkingPlan.patrolSite
                    : parkingPlan.loadingSite),
              )!.name;
        return `<div class="policy-location"><div><small>${p.title} · 적용 예정</small><strong>${name}</strong></div><button class="secondary" data-pick-location="${p.id}" ${busy ? "disabled" : ""}>위치 변경</button></div>`;
      })
      .join("");
  }
  $<HTMLButtonElement>("#pick-facility-plot").disabled = busy;
  $("#facility-plan").hidden = scenario.id !== "facilities";
  const plot = FACILITY_SITES.find((s) => s.id === facilityPlan.siteId)!;
  const assigned = facilityPlan.buildings?.find((b) => b.siteId === plot.id);
  if (scenario.id === "facilities") {
    $("#plot-area").textContent =
      `${plot.district} · ${plot.width * plot.depth}㎡`;
    $("#plot-current").textContent = assigned
      ? `예정: ${assigned.kind === "library" ? "도서관" : "공원"}`
      : "비어 있는 공터";
    $("#planned-buildings-list").innerHTML = facilityPlanMarkup(facilityPlan);
  }
  for (const p of scenario.policies) {
    const input = $<HTMLInputElement>(`[data-policy="${p.id}"]`);
    input.checked = chosenIds.includes(p.id);
    input.disabled =
      busy || (!input.checked && chosenCost() + p.cost > scenario.budget);
    if (
      scenario.id === "facilities" &&
      (p.id === "library" || p.id === "park")
    ) {
      input.checked = assigned?.kind === p.id;
      const replacedCost = assigned
        ? assigned.kind === "library"
          ? 55
          : 35
        : 0;
      input.disabled =
        busy ||
        (!input.checked &&
          (chosenCost() - replacedCost + p.cost > 100 ||
            plot.width * plot.depth < FACILITY_FOOTPRINT[p.id]));
      input.closest<HTMLElement>("[data-policy-card]")!.title =
        plot.width * plot.depth < FACILITY_FOOTPRINT[p.id]
          ? `면적 부족: ${FACILITY_FOOTPRINT[p.id]}㎡가 필요해요.`
          : `${plot.name}에 짓기`;
    }
    $(`[data-policy-card="${p.id}"]`).classList.toggle(
      "checked",
      input.checked,
    );
  }
  $("#budget").textContent = $("#hud-budget").textContent = String(
    scenario.budget - chosenCost(),
  );
  const detail =
    scenario.policies.find((p) => p.id === inspectedPolicy) ??
    scenario.policies[0];
  $("#policy-target").textContent = detail.target;
  $("#policy-description").textContent = detail.description;
  $("#policy-tradeoff").textContent = detail.tradeoff;
  $("#signal-setting").hidden =
    scenario.id !== "traffic" || !chosenIds.includes("signal");
  $<HTMLInputElement>("#green").value = String(selectedPolicy.ewGreen);
  $<HTMLButtonElement>("#apply").disabled = busy || chosenIds.length === 0;
  $("#green-value").textContent = selectedPolicy.ewGreen + "초";
}
$(".policy-list").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const id = input.dataset.policy;
  if (!id || !scenario.policies.some((p) => p.id === id)) return;
  if (scenario.id === "water" && input.checked) {
    inspectedPolicy = id;
    beginWaterPlacement(id as WaterPolicyId);
    return;
  }
  if (scenario.id === "dumping" && input.checked) {
    inspectedPolicy = id;
    beginDumpingPlacement(id as DumpingPolicyId);
    return;
  }
  if (scenario.id === "parking" && input.checked) {
    inspectedPolicy = id;
    beginPlacement(id as PlacementKind);
    return;
  }
  if (scenario.id === "facilities" && (id === "library" || id === "park")) {
    facilityPlan = {
      ...facilityPlan,
      buildings: [
        ...(facilityPlan.buildings ?? []).filter(
          (b) => b.siteId !== facilityPlan.siteId,
        ),
        ...(input.checked
          ? [{ siteId: facilityPlan.siteId, kind: id as ServiceKind }]
          : []),
      ],
    };
    syncBuildingPolicies();
    inspectedPolicy = id;
    updatePolicy();
    return;
  }
  chosenIds = input.checked
    ? [...chosenIds, id]
    : chosenIds.filter((p) => p !== id);
  inspectedPolicy = id;
  if (scenario.id === "traffic")
    selectedPolicy[id as "signal" | "bypass" | "oneWay"] = input.checked;
  updatePolicy();
});
$("#green").addEventListener("input", () => {
  selectedPolicy.ewGreen = Number($<HTMLInputElement>("#green").value);
  updatePolicy();
});
function setBusy(value: boolean) {
  if (value && placement) cancelPlacement(false);
  busy = value;
  for (const selector of [
    "#facility-site",
    "#choose-scenario",
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
async function runToEnd(
  target: TrafficSimulation,
  visible: boolean,
  end = experiment.duration,
) {
  while (target.time < end - 0.01) {
    target.runUntil(Math.min(end, target.time + 15));
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
  if (busy || chosenIds.length === 0) return;
  const chosen = [...chosenIds];
  const green = selectedPolicy.ewGreen;
  const decision = {
    reason: $<HTMLTextAreaElement>("#decision-reason").value,
    alternative: inquiry.alternative,
    evidenceIds: inquiry.evidence.filter((e) => e.used).map((e) => e.id),
    policies: chosen,
  };
  setBusy(true);
  paused = true;
  try {
    if (!baseline) {
      $("#footer-status").textContent =
        "동일한 조건의 정책 시행 전 결과를 계산하고 있어요.";
      baseline = createRun();
      await runToEnd(baseline, false);
    }
    sim = createRun(chosen, green);
    inquiry.decisions.push(decision);
    inquiry.step = 4;
    metrics = sim.stats;
    mode = "trial";
    refreshCity();
    panels.close(true);
    paused = false;
    if (sim instanceof FacilitySimulation) {
      paused = true;
      mode = "done";
      showResults();
    }
    if (!muted) {
      audio.currentTime = 0;
      void audio.play().catch(() => toast("효과음을 재생할 수 없어요."));
    }
    toast(
      sim instanceof FacilitySimulation
        ? "같은 주민 수요로 시설 계획을 비교했어요."
        : sim instanceof EnvironmentSimulation
          ? "기존 수요를 유지하고 개발로 생긴 차량을 추가했어요."
          : "같은 출발 조건으로 정책 실험을 시작했어요.",
    );
  } finally {
    setBusy(false);
    updateHud();
  }
});
function togglePause() {
  if (busy || placement || sim.time >= experiment.duration) return;
  paused = !paused;
  updateHud();
}
$("#pause").addEventListener("click", togglePause);
$("#speed").addEventListener("change", () => {
  speed = Number($<HTMLSelectElement>("#speed").value);
});
$(".map-tools").addEventListener("click", (event) => {
  $("#toast").classList.remove("visible");
  const target = event.target as HTMLElement;
  const service = target.closest<HTMLElement>("[data-access-service]")?.dataset
    .accessService;
  if (service === "library" || service === "park") {
    changeAccessService(service);
    return;
  }
  const layer = target.closest<HTMLElement>("[data-map-layer]")?.dataset
    .mapLayer as MapLayer | undefined;
  if (!layer || !scenario.layers.includes(layer)) return;
  mapLayer = mapLayer === layer ? "normal" : layer;
  applyMapLayer();
  investigate("지도: " + mapLayer);
});
$("#focus-school").addEventListener("click", () =>
  scenario.id === "water"
    ? city.focusWater("middle")
    : scenario.id === "dumping"
      ? city.focusDumping("river")
      : scenario.id === "parking"
        ? city.focusParking("school")
        : scenario.id === "traffic"
          ? city.focusSchool()
          : scenario.id === "facilities"
            ? city.focusCivic("library-existing")
            : scenario.id === "logistics"
              ? city.focusSupply("factory")
              : scenario.id === "environment"
                ? city.focusDevelopment("industry")
                : city.focusFacility("b4"),
);
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
  cancelPlacement(false);
  parkingPlan = { ...DEFAULT_PARKING_PLAN };
  dumpingPlan = { ...DEFAULT_DUMPING_PLAN };
  waterPlan = { ...DEFAULT_WATER_PLAN };
  inquiry = new Inquiry();
  facilityPlan = { ...DEFAULT_FACILITY_PLAN, buildings: [] };
  $<HTMLSelectElement>("#facility-site").value = facilityPlan.siteId;
  baseline = undefined;
  $<HTMLTextAreaElement>("#reflection").value = "";
  updateExperimentLabels();
  sim = createRun();
  metrics = sim.stats;
  mode = "observe";
  selectedPolicy = { ...DEFAULT_POLICY };
  chosenIds = [];
  investigations.length = 0;
  $("#decision-reason").textContent = "";
  $<HTMLTextAreaElement>("#decision-reason").value = "";
  inspectedPolicy = scenario.policies[0].id;
  paused = scenario.clock === "planning";
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
  if (
    ![2404, 2405, 2406].includes(seed) ||
    !scenario.durations.includes(duration)
  )
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
  if (baseline instanceof WaterSimulation && sim instanceof WaterSimulation) {
    panels.close();
    const r = waterResults(baseline, sim);
    $("#result-summary").innerHTML = r.summary;
    $("#result-table").innerHTML = r.table;
    $("#result-analysis").innerHTML = r.details;
    if (!$<HTMLDialogElement>("#results-dialog").open)
      $<HTMLDialogElement>("#results-dialog").showModal();
    return;
  }
  if (
    baseline instanceof DumpingSimulation &&
    sim instanceof DumpingSimulation
  ) {
    panels.close();
    const r = dumpingResults(baseline, sim);
    $("#result-summary").innerHTML = r.summary;
    $("#result-table").innerHTML = r.table;
    $("#result-analysis").innerHTML = r.details;
    if (!$<HTMLDialogElement>("#results-dialog").open)
      $<HTMLDialogElement>("#results-dialog").showModal();
    return;
  }
  if (
    baseline instanceof ParkingSimulation &&
    sim instanceof ParkingSimulation
  ) {
    panels.close();
    const result = parkingResults(baseline, sim);
    $("#result-summary").innerHTML = result.summary;
    $("#result-table").innerHTML = result.table;
    $("#result-analysis").innerHTML = result.details;
    if (!$<HTMLDialogElement>("#results-dialog").open)
      $<HTMLDialogElement>("#results-dialog").showModal();
    return;
  }
  if (
    baseline instanceof LogisticsSimulation &&
    sim instanceof LogisticsSimulation
  ) {
    panels.close();
    const result = logisticsResults(baseline, sim);
    $("#result-summary").innerHTML = result.summary;
    $("#result-table").innerHTML = result.table;
    $("#result-analysis").innerHTML = result.details;
    if (!$<HTMLDialogElement>("#results-dialog").open)
      $<HTMLDialogElement>("#results-dialog").showModal();
    return;
  }
  if (
    baseline instanceof EnvironmentSimulation &&
    sim instanceof EnvironmentSimulation
  ) {
    panels.close();
    const result = environmentResults(baseline, sim);
    $("#result-summary").innerHTML = result.summary;
    $("#result-table").innerHTML = result.table;
    $("#result-analysis").innerHTML = result.details;
    if (!$<HTMLDialogElement>("#results-dialog").open)
      $<HTMLDialogElement>("#results-dialog").showModal();
    return;
  }
  if (
    baseline instanceof FacilitySimulation &&
    sim instanceof FacilitySimulation
  ) {
    panels.close();
    const result = facilityResults(baseline, sim);
    $("#result-summary").innerHTML = result.summary;
    $("#result-table").innerHTML = result.table;
    $("#result-analysis").innerHTML = result.details;
    if (!$<HTMLDialogElement>("#results-dialog").open)
      $<HTMLDialogElement>("#results-dialog").showModal();
    return;
  }
  if (baseline instanceof WasteSimulation && sim instanceof WasteSimulation) {
    showWasteResults(baseline, sim);
    return;
  }
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
function buildRecord() {
  const data = {
    schemaVersion:
      sim instanceof WaterSimulation
        ? 7
        : sim instanceof DumpingSimulation
          ? 6
          : 5,
    waterModelVersion:
      sim instanceof WaterSimulation ? WATER_MODEL_VERSION : undefined,
    waterPlan: sim instanceof WaterSimulation ? sim.plan : undefined,
    waterSchedule: sim instanceof WaterSimulation ? sim.schedule : undefined,
    waterBefore:
      baseline instanceof WaterSimulation ? baseline.waterStats : undefined,
    waterAfter: sim instanceof WaterSimulation ? sim.waterStats : undefined,
    waterRoundsBefore:
      baseline instanceof WaterSimulation ? baseline.rounds : undefined,
    waterRoundsAfter: sim instanceof WaterSimulation ? sim.rounds : undefined,
    dumpingModelVersion:
      sim instanceof DumpingSimulation ? DUMPING_MODEL_VERSION : undefined,
    dumpingBefore:
      baseline instanceof DumpingSimulation ? baseline.dumpingStats : undefined,
    dumpingAfter:
      sim instanceof DumpingSimulation ? sim.dumpingStats : undefined,
    dumpingPlan: sim instanceof DumpingSimulation ? sim.plan : undefined,
    disposalDemand:
      sim instanceof DumpingSimulation ? sim.disposalDemand : undefined,
    disposalEvents:
      sim instanceof DumpingSimulation ? sim.disposalEvents : undefined,
    dumpingRoundsBefore:
      baseline instanceof DumpingSimulation ? baseline.rounds : undefined,
    dumpingRoundsAfter:
      sim instanceof DumpingSimulation ? sim.rounds : undefined,
    inquiry: inquiry.snapshot(),
    parkingModelVersion:
      sim instanceof ParkingSimulation ? PARKING_MODEL_VERSION : undefined,
    parkingBefore:
      baseline instanceof ParkingSimulation ? baseline.parkingStats : undefined,
    parkingAfter:
      sim instanceof ParkingSimulation ? sim.parkingStats : undefined,
    parkingPlan: sim instanceof ParkingSimulation ? sim.plan : undefined,
    parkingDemand:
      sim instanceof ParkingSimulation ? sim.parkingDemand : undefined,
    cityLayoutVersion: CITY_LAYOUT_VERSION,
    logisticsModelVersion:
      sim instanceof LogisticsSimulation ? LOGISTICS_MODEL_VERSION : undefined,
    logisticsBefore:
      baseline instanceof LogisticsSimulation
        ? baseline.logisticsStats
        : undefined,
    logisticsAfter:
      sim instanceof LogisticsSimulation ? sim.logisticsStats : undefined,
    cargoTrucks: sim instanceof LogisticsSimulation ? sim.trucks : undefined,
    goodsEvents:
      sim instanceof LogisticsSimulation ? sim.goodsEvents : undefined,
    environmentModelVersion:
      sim instanceof EnvironmentSimulation
        ? ENVIRONMENT_MODEL_VERSION
        : undefined,
    environmentBefore:
      baseline instanceof EnvironmentSimulation
        ? baseline.environmentStats
        : undefined,
    environmentAfter:
      sim instanceof EnvironmentSimulation ? sim.environmentStats : undefined,
    backgroundDemand:
      sim instanceof EnvironmentSimulation ? sim.backgroundDemand : undefined,
    addedDemandBefore:
      baseline instanceof EnvironmentSimulation
        ? baseline.addedDemand
        : undefined,
    addedDemandAfter:
      sim instanceof EnvironmentSimulation ? sim.addedDemand : undefined,
    demandBefore:
      baseline instanceof EnvironmentSimulation ? baseline.demand : undefined,
    timeUnit: sim instanceof FacilitySimulation ? "planning-round" : "seconds",
    round: sim instanceof FacilitySimulation ? 1 : undefined,
    facilityModelVersion:
      sim instanceof FacilitySimulation ? FACILITY_MODEL_VERSION : undefined,
    facilityPlan: sim instanceof FacilitySimulation ? sim.plan : undefined,
    facilitiesBefore:
      baseline instanceof FacilitySimulation
        ? baseline.facilityStats
        : undefined,
    facilitiesAfter:
      sim instanceof FacilitySimulation ? sim.facilityStats : undefined,
    summary: compareScenario(baseline!, sim),
    scenarioId: scenario.id,
    serviceModelVersion:
      sim instanceof WasteSimulation ? WASTE_MODEL_VERSION : undefined,
    investigations: [...investigations],
    residents: residentVoices(sim, baseline),
    decisionReason:
      inquiry.decisions[inquiry.decisions.length - 1]?.reason ??
      $<HTMLTextAreaElement>("#decision-reason").value,
    wasteBefore:
      baseline instanceof WasteSimulation ? baseline.wasteStats : undefined,
    wasteAfter: sim instanceof WasteSimulation ? sim.wasteStats : undefined,
    serviceTrucks: sim instanceof WasteSimulation ? sim.trucks : undefined,
    serviceEvents:
      sim instanceof WasteSimulation ? sim.serviceEvents : undefined,
    policyIds:
      sim instanceof WaterSimulation
        ? sim.policyIds
        : sim instanceof ParkingSimulation
          ? sim.policyIds
          : sim instanceof LogisticsSimulation
            ? sim.policyIds
            : sim instanceof FacilitySimulation ||
                sim instanceof EnvironmentSimulation
              ? sim.policyIds
              : sim instanceof WasteSimulation
                ? sim.policyIds
                : POLICIES.filter((p) => sim.policy[p.id]).map((p) => p.id),
    modelVersion: MODEL_VERSION,
    laneChangesBefore: baseline?.laneChangeEvents,
    laneChangesAfter: sim.laneChangeEvents,
    analysis:
      sim instanceof WaterSimulation ||
      sim instanceof ParkingSimulation ||
      sim instanceof LogisticsSimulation
        ? undefined
        : sim instanceof FacilitySimulation ||
            sim instanceof EnvironmentSimulation
          ? undefined
          : compareExperiments(baseline!, sim),
    scenario: scenario.title,
    seed: experiment.seed,
    duration: experiment.duration,
    demand: sim.demand,
    policy: sim.policy,
    budget:
      scenario.budget -
      (sim instanceof WaterSimulation ||
      sim instanceof ParkingSimulation ||
      sim instanceof LogisticsSimulation ||
      sim instanceof WasteSimulation ||
      sim instanceof FacilitySimulation ||
      sim instanceof EnvironmentSimulation
        ? sim.cost
        : policyCost(sim.policy)),
    before: baseline?.stats,
    after: sim.stats,
    completedBefore: baseline?.completed,
    completedAfter: sim.completed,
    pedestrianDemand: sim.pedestrians.demand,
    pedestriansBefore: baseline?.pedestrians.stats,
    pedestriansAfter: sim.pedestrians.stats,
    completedPedestriansBefore: baseline?.pedestrians.completed,
    completedPedestriansAfter: sim.pedestrians.completed,
    reflection: $<HTMLTextAreaElement>("#reflection").value,
  };
  return data;
}
$("#export").addEventListener("click", () => {
  const data = buildRecord();
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
  $("#progress").style.width =
    `${experiment.duration ? (sim.time / experiment.duration) * 100 : mode === "done" ? 100 : 0}%`;
  $("#pause").innerHTML = icon(paused ? "play" : "pause");
  $("#pause").setAttribute("aria-label", paused ? "재생" : "일시정지");
  $<HTMLButtonElement>("#pause").disabled =
    busy || !!placement || sim.time >= experiment.duration;
  $("#pause").title =
    sim.time >= experiment.duration
      ? String(experiment.duration / 60) + "분 관찰을 마쳤어요"
      : paused
        ? "재생 (스페이스)"
        : "일시정지 (스페이스)";
  $("#arrived").textContent = String(metrics.arrived);
  const waste = sim instanceof WasteSimulation;
  $("#hud-arrived").textContent =
    sim instanceof WasteSimulation
      ? sim.wasteStats.collectionRate.toFixed(1)
      : String(metrics.arrived);
  $("#hud-arrived").closest("span")!.querySelector("small")!.textContent = waste
    ? "수거율"
    : "도착한 차";
  $("#hud-arrived").nextElementSibling!.textContent = waste
    ? "%"
    : ` / ${sim.demand.length}`;
  $("#hud-arrived").closest("span")!.parentElement!.title = waste
    ? "처음 쌓인 양과 새로 나온 양 중 수거한 비율"
    : "목적지에 도착한 차량 수";
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
  updateScenarioObservation();
  if (sim instanceof ParkingSimulation) {
    $("#hud-arrived").textContent = String(sim.parkingStats.illegal);
    $("#hud-arrived").closest("span")!.querySelector("small")!.textContent =
      "길을 막은 차";
    $("#hud-arrived").nextElementSibling!.textContent = "대";
    $("#hud-arrived").closest("span")!.parentElement!.title =
      "지금 차도·보행로에 남은 불법주차";
  }
  if (sim instanceof WaterSimulation) {
    $("#hud-arrived").textContent = sim.waterStats.sites[2].level.toFixed(1);
    $("#hud-arrived").closest("span")!.querySelector("small")!.textContent =
      "하류 오염도";
    $("#hud-arrived").nextElementSibling!.textContent = "가상";
    $("#hud-arrived").closest("span")!.parentElement!.title =
      "물에 섞인 오염 · 실제 수질 등급이 아니에요";
  }
  if (sim instanceof DumpingSimulation) {
    $("#hud-arrived").textContent =
      sim.dumpingStats.illegalRemaining.toFixed(0);
    $("#hud-arrived").closest("span")!.querySelector("small")!.textContent =
      "남은 무단투기";
    $("#hud-arrived").nextElementSibling!.textContent = "봉투";
    $("#hud-arrived").closest("span")!.parentElement!.title =
      "지정 장소의 정상 배출과 별도 집계";
    if (!busy)
      $("#footer-status").textContent =
        `관찰 ${sim.round}/3차 · ${paused ? "자료를 담고 재생하면 이어져요" : "무단투기·정상 배출·넘침을 구분해 살펴봐요"}`;
  }
  if (sim instanceof LogisticsSimulation) {
    $("#hud-arrived").textContent = sim.logisticsStats.delivered.toFixed(1);
    $("#hud-arrived").closest("span")!.querySelector("small")!.textContent =
      "물자 배송";
    $("#hud-arrived").nextElementSibling!.textContent = "상자";
    $("#hud-arrived").closest("span")!.parentElement!.title =
      "상점에 도착해 실제로 내려놓은 물자";
  }
  if (sim instanceof FacilitySimulation) {
    $("#clock").textContent = "시설 계획";
    $("#elapsed").textContent = "계획 1회 비교";
    $("#hud-arrived").textContent = String(sim.facilityStats.served);
    $("#hud-arrived").closest("span")!.querySelector("small")!.textContent =
      "이용 가능";
    $("#hud-arrived").nextElementSibling!.textContent = "명";
    $("#hud-arrived").closest("span")!.parentElement!.title =
      "예상 거리와 이용 정원을 함께 적용한 인원";
  }
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
        ? "관찰 완료! 주민 의견을 듣고 정책을 골라 보세요."
        : paused
          ? "잠시 멈췄어요. 도시를 자유롭게 살펴보세요."
          : mode === "trial"
            ? "선택한 정책을 적용해 같은 이동 수요로 다시 달리고 있어요."
            : sim.time >= experiment.duration
              ? "관찰 완료! 정책을 골라 등굣길을 바꿔 보세요."
              : scenario.id === "traffic"
                ? "학교 앞 교차로를 눌러 살펴보세요."
                : "수거차와 수거장을 눌러 살펴보세요.";
  if (scenario.clock === "planning") {
    $("#mode-label").textContent =
      mode === "done" ? "시설 계획 · 비교 완료" : "시설 계획 · 주민 의견 듣기";
    $("#next-policy").hidden = true;
    $("#footer-status").textContent =
      "보행 거리와 이용 정원을 계산하는 계획이에요.";
  }
  if (scenario.id === "environment" && !busy) {
    $("#footer-status").textContent =
      mode === "done"
        ? "개발 편익과 장소별 부담을 함께 비교해 보세요."
        : "기존 차량과 개발로 추가된 차량이 함께 움직여요. 환경 점수는 가상 비교 자료예요.";
  }
  if (sim instanceof WaterSimulation && !busy)
    $("#footer-status").textContent =
      mode === "done"
        ? "상류·하류 결과를 비교하고 다음 해결책을 제안해요."
        : `관찰 ${sim.round}/3차 · ${paused ? "자료를 담고 재생하면 이어져요" : "상류에서 하류로 이동하는 변화를 살펴봐요"}`;
  if (scenario.id === "parking" && !busy)
    $("#footer-status").textContent =
      mode === "done"
        ? "어느 현장이 나아졌는지 보고 다음 방법을 제안해요."
        : paused
          ? "조사하는 동안 잠시 멈췄어요. 재생하면 계속 관찰할 수 있어요."
          : "학교 앞·시장 옆·주거지의 차와 보행자를 살펴봐요.";
}
updateScenarioUI();
updateExperimentLabels();
updatePolicy();
updateHud();
let lastTime = performance.now(),
  lastHud = 0;
function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;
  if (!paused && !busy && scenario.clock !== "planning") {
    const boundary =
      sim instanceof DumpingSimulation || sim instanceof WaterSimulation
        ? Math.min(
            experiment.duration,
            (Math.floor((sim.time + 1e-7) / OBSERVATION_ROUND_SECONDS) + 1) *
              OBSERVATION_ROUND_SECONDS,
          )
        : experiment.duration;
    sim.advance(Math.min(dt * speed, boundary - sim.time));
    if (
      (sim instanceof DumpingSimulation || sim instanceof WaterSimulation) &&
      sim.time >= boundary - 1e-8 &&
      boundary < experiment.duration
    ) {
      paused = true;
      toast(
        `${boundary / OBSERVATION_ROUND_SECONDS}차 관찰을 마쳤어요. 자료를 담고 재생하면 다음 관찰로 이어져요.`,
      );
    }
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
      get scenarioId() {
        return scenario.id;
      },
      get mapLayer() {
        return mapLayer;
      },
      get mapVisualization() {
        return city.mapVisualization;
      },
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

function investigate(kind: string) {
  if (investigations.length >= 60) return;
  investigations.push({
    kind,
    time: sim.time,
    facts:
      sim instanceof WaterSimulation
        ? sim.waterStats
        : sim instanceof ParkingSimulation
          ? sim.parkingStats
          : sim instanceof LogisticsSimulation
            ? sim.logisticsStats
            : sim instanceof EnvironmentSimulation
              ? sim.environmentStats
              : sim instanceof FacilitySimulation
                ? sim.facilityStats
                : sim instanceof WasteSimulation
                  ? sim.wasteStats
                  : { vehicles: sim.stats, pedestrians: sim.pedestrians.stats },
  });
}
function inquiryContext(): InquiryContext {
  const voices = residentVoices(sim, mode === "done" ? baseline : undefined);
  return {
    phase: mode === "observe" ? "before" : "after",
    time: sim.time,
    done: mode === "done",
    reason: $<HTMLTextAreaElement>("#decision-reason").value,
    places:
      sim instanceof WaterSimulation
        ? WATER_SITES.map((s) => ({
            id: s.id,
            name: s.name,
            fact: waterFact(sim as WaterSimulation, s.id),
            group: s.group,
            opinion: s.opinion,
          }))
        : sim instanceof DumpingSimulation
          ? DUMPING_SITES.map((s) => ({
              id: s.id,
              name: s.name,
              fact: dumpingFact(sim as DumpingSimulation, s.id),
              group: s.group,
              opinion: s.opinion,
            }))
          : sim instanceof ParkingSimulation
            ? PARKING_SITES.map((s) => ({
                id: s.id,
                name: s.name,
                fact: parkingFact(sim as ParkingSimulation, s.id),
                group: s.group,
                opinion: s.opinion,
              }))
            : voices.map((v) => ({
                id: v.facilityId,
                name: v.place,
                fact: v.fact,
                group: v.group,
                opinion: v.opinion,
              })),
  };
}
function renderInquiry() {
  $("#inquiry-content").innerHTML = inquiryMarkup(inquiry, inquiryContext());
}
$("#inquiry-content").addEventListener("input", (event) => {
  const input = event.target as HTMLTextAreaElement,
    key = input.dataset.inquiryField;
  if (key === "reason")
    $<HTMLTextAreaElement>("#decision-reason").value = input.value;
  else if (key === "hypothesis" || key === "alternative" || key === "proposal")
    inquiry[key] = input.value;
});
$("#inquiry-content").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === "inquiry-place") {
    inquiry.placeId = input.value;
    renderInquiry();
  }
  if (input.dataset.evidence) inquiry.toggle(Number(input.dataset.evidence));
});
$("#inquiry-content").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button",
  );
  if (!button) return;
  if (button.dataset.inquiryStep !== undefined) {
    inquiry.step = Math.max(0, Math.min(5, Number(button.dataset.inquiryStep)));
    renderInquiry();
    return;
  }
  const action = button.dataset.inquiryAction,
    context = inquiryContext(),
    place = context.places.find((p) => p.id === inquiry.placeId)!;
  if (action === "fact" || action === "opinion") {
    const added = inquiry.collect({
      kind: action,
      time: sim.time,
      phase: context.phase,
      trial: mode === "observe" ? 0 : inquiry.decisions.length,
      place: place.name,
      text: action === "fact" ? place.fact : `${place.group}: ${place.opinion}`,
    });
    renderInquiry();
    toast(
      added
        ? "조사 수첩에 담았어요."
        : "이미 담은 내용이거나 수첩이 가득 찼어요.",
    );
  } else if (action === "focus") {
    refreshingCity = true;
    try {
      if (sim instanceof WaterSimulation) city.focusWater(place.id);
      else if (sim instanceof DumpingSimulation) city.focusDumping(place.id);
      else if (sim instanceof ParkingSimulation) city.focusParking(place.id);
      else city.focusFacility(place.id);
    } finally {
      refreshingCity = false;
    }
    investigate("현장 찾기: " + place.name);
  } else if (action === "policy") panels.open("policy");
  else if (action === "voices") panels.open("residents");
  else if (action === "results") showResults();
  else if (action === "observe") panels.open("traffic");
});
function cancelPlacement(returnToPolicy = true) {
  if (!placement) return;
  const previous = placement;
  placement = undefined;
  city.clearPlacement();
  paused = previous.wasPaused;
  $<HTMLSelectElement>("#speed").disabled = busy;
  $<HTMLButtonElement>("#finish").disabled = busy;
  updatePolicy();
  updateHud();
  if (returnToPolicy) panels.open("policy");
}
function beginWaterPlacement(kind: WaterPolicyId) {
  if (busy || scenario.id !== "water") return;
  if (
    !chosenIds.includes(kind) &&
    chosenCost() + scenario.policies.find((p) => p.id === kind)!.cost >
      scenario.budget
  ) {
    updatePolicy();
    return;
  }
  panels.close();
  placement = { kind, wasPaused: paused };
  paused = true;
  $<HTMLSelectElement>("#speed").disabled = true;
  $<HTMLButtonElement>("#finish").disabled = true;
  city.showPlacement(
    {
      outlet: "개선할 작업장 배출구를 고르세요",
      sewer: "시설을 지을 공터를 고르세요",
      riverCleanup: "청소할 둔치를 고르세요",
    }[kind],
    waterTargets(kind),
    chosenIds.includes(kind) ? waterPlan[kind] : undefined,
    (id) => {
      if (!placement || busy) return;
      waterPlan = { ...waterPlan, [kind]: id };
      if (!chosenIds.includes(kind)) chosenIds.push(kind);
      inspectedPolicy = kind;
      cancelPlacement(false);
      panels.open("policy");
      investigate(
        "수질 대책 위치 선택: " +
          waterTargets(kind).find((t) => t.id === id)!.name,
      );
    },
    () => cancelPlacement(),
  );
  updateHud();
}
$("#water-locations").addEventListener("click", (event) => {
  const kind = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-pick-water]",
  )?.dataset.pickWater;
  if (kind) beginWaterPlacement(kind as WaterPolicyId);
});
$("#next-water-round").addEventListener("click", async () => {
  if (
    !(sim instanceof WaterSimulation) ||
    busy ||
    sim.time >= experiment.duration
  )
    return;
  paused = true;
  setBusy(true);
  try {
    await runToEnd(
      sim,
      true,
      Math.min(
        experiment.duration,
        (Math.floor((sim.time + 1e-7) / 300) + 1) * 300,
      ),
    );
    if (sim.time >= experiment.duration) finishRun();
  } finally {
    setBusy(false);
    updateHud();
  }
});
document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-water-site],[data-water-inquiry]",
  );
  if (!target || busy) return;
  if (target.dataset.waterSite) city.focusWater(target.dataset.waterSite);
  if (target.dataset.waterInquiry) {
    inquiry.placeId = target.dataset.waterInquiry;
    inquiry.step = 1;
    panels.open("inquiry");
  }
});
function beginDumpingPlacement(kind: DumpingPolicyId) {
  if (busy || scenario.id !== "dumping") return;
  if (
    !chosenIds.includes(kind) &&
    chosenCost() + scenario.policies.find((p) => p.id === kind)!.cost >
      scenario.budget
  ) {
    updatePolicy();
    return;
  }
  panels.close();
  placement = { kind, wasPaused: paused };
  paused = true;
  $<HTMLSelectElement>("#speed").disabled = true;
  $<HTMLButtonElement>("#finish").disabled = true;
  const targets: PlacementTarget[] = DUMPING_SITES.map((s) => ({
    id: s.id,
    name: s.name,
    position: kind === "dropoff" ? dumpingBinPosition(s.id) : s.position,
    width: kind === "dropoff" ? 3 : 12,
    depth: kind === "dropoff" ? 4 : 12,
    detail:
      kind === "cleanup"
        ? "수거차가 먼저 방문"
        : kind === "dropoff"
          ? "12㎡ · 16봉투 보관"
          : "2차 관찰부터 일부 참여",
  }));
  city.showPlacement(
    {
      cleanup: "먼저 청소할 현장을 고르세요",
      dropoff: "배출함을 놓을 곳을 고르세요",
      outreach: "함께 안내 활동을 할 곳을 고르세요",
    }[kind],
    targets,
    chosenIds.includes(kind) ? dumpingPlan[kind] : undefined,
    (id) => {
      if (!placement || busy) return;
      dumpingPlan = { ...dumpingPlan, [kind]: id };
      if (!chosenIds.includes(kind)) chosenIds.push(kind);
      inspectedPolicy = kind;
      cancelPlacement(false);
      refreshingCity = true;
      try {
        city.focusDumping(id);
      } finally {
        refreshingCity = false;
      }
      panels.open("policy");
      investigate(
        "정책 위치 선택: " + DUMPING_SITES.find((s) => s.id === id)!.name,
      );
    },
    () => cancelPlacement(),
  );
  updateHud();
}
$("#dumping-locations").addEventListener("click", (event) => {
  const kind = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-pick-dumping]",
  )?.dataset.pickDumping;
  if (kind) beginDumpingPlacement(kind as DumpingPolicyId);
});
$("#next-dumping-round").addEventListener("click", async () => {
  if (
    sim instanceof DumpingSimulation &&
    !busy &&
    sim.time < experiment.duration
  ) {
    paused = true;
    setBusy(true);
    try {
      const end = Math.min(
        experiment.duration,
        (Math.floor((sim.time + 1e-7) / 300) + 1) * 300,
      );
      await runToEnd(sim, true, end);
      if (sim.time >= experiment.duration) finishRun();
    } finally {
      setBusy(false);
      updateHud();
    }
  }
});
document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-dumping-site],[data-dumping-inquiry]",
  );
  if (!target) return;
  if (target.dataset.dumpingSite) city.focusDumping(target.dataset.dumpingSite);
  if (target.dataset.dumpingInquiry) {
    inquiry.placeId = target.dataset.dumpingInquiry;
    inquiry.step = 1;
    panels.open("inquiry");
  }
});
function beginPlacement(kind: PlacementKind) {
  if (
    busy ||
    (kind === "facilityPlot"
      ? scenario.id !== "facilities"
      : scenario.id !== "parking")
  )
    return;
  if (
    kind !== "facilityPlot" &&
    !chosenIds.includes(kind) &&
    chosenCost() + scenario.policies.find((p) => p.id === kind)!.cost >
      scenario.budget
  ) {
    updatePolicy();
    return;
  }
  panels.close();
  placement = { kind, wasPaused: paused };
  paused = true;
  $<HTMLSelectElement>("#speed").disabled = true;
  $<HTMLButtonElement>("#finish").disabled = true;
  const plots = kind === "parkingLot" || kind === "facilityPlot";
  const targets: PlacementTarget[] = plots
    ? FACILITY_SITES.filter(
        (p) =>
          kind !== "parkingLot" ||
          !(parkingPlan.reservedPlots ?? []).some((r) => r.siteId === p.id),
      ).map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        width: p.width,
        depth: p.depth,
        detail:
          kind === "parkingLot"
            ? `${p.width * p.depth}㎡ · ${Math.floor((p.width * p.depth) / 240)}대`
            : `${p.width * p.depth}㎡ · ${facilityPlan.buildings?.find((b) => b.siteId === p.id)?.kind === "library" ? "도서관 예정" : facilityPlan.buildings?.find((b) => b.siteId === p.id)?.kind === "park" ? "공원 예정" : "공터"}`,
      }))
    : PARKING_SITES.filter(
        (s) => kind !== "loadingBay" || s.id !== "homes",
      ).map((s) => ({
        id: s.id,
        name: s.name,
        position:
          kind === "loadingBay" && sim instanceof ParkingSimulation
            ? sim.bayPose(s.id)
            : s.position,
        width: kind === "loadingBay" ? 7 : 20,
        depth: kind === "loadingBay" ? 4 : 20,
        detail: kind === "patrol" ? "이 현장만 순찰" : "짧은 정차 1대",
      }));
  const title = {
    patrol: "순찰할 현장을 고르세요",
    parkingLot: "주차장을 지을 공터를 고르세요",
    loadingBay: "잠깐 정차할 곳을 고르세요",
    facilityPlot: "시설을 지을 공터를 고르세요",
  }[kind];
  const current =
    kind === "facilityPlot"
      ? facilityPlan.siteId
      : !chosenIds.includes(kind)
        ? undefined
        : kind === "parkingLot"
          ? parkingPlan.siteId
          : kind === "patrol"
            ? parkingPlan.patrolSite
            : parkingPlan.loadingSite;
  if (!targets.length) {
    cancelPlacement();
    toast("선택할 수 있는 빈 공터가 없어요.");
    return;
  }
  city.showPlacement(
    title,
    targets,
    current,
    (id) => {
      if (!placement || busy || !targets.some((t) => t.id === id)) return;
      if (kind === "facilityPlot") {
        facilityPlan = { ...facilityPlan, siteId: id };
        $<HTMLSelectElement>("#facility-site").value = id;
      } else {
        parkingPlan = {
          ...parkingPlan,
          [kind === "parkingLot"
            ? "siteId"
            : kind === "patrol"
              ? "patrolSite"
              : "loadingSite"]: id,
        };
        if (!chosenIds.includes(kind)) chosenIds.push(kind);
        inspectedPolicy = kind;
      }
      cancelPlacement(false);
      refreshingCity = true;
      try {
        if (plots) city.focusCivic(id, true);
        else city.focusParking(id);
      } finally {
        refreshingCity = false;
      }
      panels.open("policy");
      investigate("정책 위치 선택: " + targets.find((t) => t.id === id)!.name);
      toast("계획에 담았어요. 정책 시행 버튼을 누르면 적용돼요.");
    },
    () => cancelPlacement(),
  );
  updateHud();
}
$("#pick-facility-plot").addEventListener("click", () =>
  beginPlacement("facilityPlot"),
);
$("#parking-locations").addEventListener("click", (event) => {
  const kind = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-pick-location]",
  )?.dataset.pickLocation;
  if (kind) beginPlacement(kind as PlacementKind);
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    placement &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    cancelPlacement();
  }
});
document.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-parking-site],[data-inquiry-site],[data-parking-plot],#review-inquiry",
  );
  if (!button) return;
  if (button.dataset.parkingSite) city.focusParking(button.dataset.parkingSite);
  if (button.dataset.inquirySite) {
    inquiry.placeId = button.dataset.inquirySite;
    inquiry.step = 1;
    panels.open("inquiry");
  }
  if (button.dataset.parkingPlot && !busy) {
    if (
      !chosenIds.includes("parkingLot") &&
      chosenCost() + 55 > scenario.budget
    ) {
      toast("공동주차장에 쓸 예산 55가 필요해요.");
      return;
    }
    parkingPlan = { ...parkingPlan, siteId: button.dataset.parkingPlot };
    if (!chosenIds.includes("parkingLot")) chosenIds.push("parkingLot");
    updatePolicy();
    panels.open("policy");
  }
  if (button.id === "review-inquiry") {
    $<HTMLDialogElement>("#results-dialog").close();
    inquiry.step = 4;
    panels.open("inquiry");
  }
});
function updateScenarioUI() {
  document.body.dataset.currentScenario = scenario.id;
  const helpSteps = [
    scenario.id === "traffic"
      ? "길 위의 자동차와 학교 앞 대기 행렬을 관찰하고 주민 의견을 들어요."
      : "수거차를 눌러 경로와 적재량을 보고, 수거 지도와 주민 의견을 살펴봐요.",
    "정책을 고르고 ‘선택한 정책 시행하기’를 눌러요.",
    "같은 출발 조건으로 다시 움직이는 도시를 살펴봐요.",
    "정한 관찰 시간이 지나면 결과를 비교하고 생각을 기록해요.",
  ];
  $("#mission-title").textContent = $(".mission-peek strong").textContent =
    scenario.title;
  $(".mission-number").textContent = scenario.number;
  $("#panel-mission .eyebrow").textContent = "동네 소식 · " + scenario.number;
  $("#panel-mission .intro").textContent = scenario.introduction;
  $("#panel-mission .resident p").textContent = "“" + scenario.request + "”";
  $("#focus-school").innerHTML =
    icon("eye", 18) +
    (scenario.id === "traffic"
      ? " 학교 앞 교차로 살펴보기 "
      : " 쓰레기가 쌓인 곳 살펴보기 ") +
    icon("arrow", 17);
  $("#policy-title").textContent =
    scenario.id === "traffic"
      ? "등굣길을 바꾸는 방법"
      : "쓰레기 문제를 푸는 방법";
  $(".policy-list").innerHTML = scenario.policies
    .map(
      (p) =>
        `<label class="policy-card" data-policy-card="${p.id}"><input type="checkbox" data-policy="${p.id}" aria-label="${p.title}"><span class="policy-icon">${icon(p.id === "extraTruck" ? "car" : p.id === "route" ? "bypass" : p.id === "reduce" ? "home" : p.id, 30)}</span><strong>${p.title}</strong><span class="policy-cost">${icon("coin", 14)} ${p.cost}</span><span class="checkmark" aria-hidden="true">✓</span></label>`,
    )
    .join("");
  $("#experiment-duration").innerHTML = scenario.durations
    .map((d) => `<option value="${d}">${d / 60}분</option>`)
    .join("");
  $("#map-layer").innerHTML = scenario.layers
    .map((l) => `<option value="${l}">${layerNames[l]}</option>`)
    .join("");
  $("#traffic-title").textContent =
    scenario.id === "traffic" ? "우리 동네 교통" : "우리 동네 수거 상황";
  $(".tools [data-open-panel=traffic] > span:last-child").textContent =
    scenario.id === "traffic" ? "교통 현황" : "수거 현황";
  $("#traffic-observation").hidden = scenario.id !== "traffic";
  $("#waste-observation").hidden = scenario.id !== "waste";
  $("#environment-observation").hidden = scenario.id !== "environment";
  $("#logistics-observation").hidden = scenario.id !== "logistics";
  $("#parking-observation").hidden = scenario.id !== "parking";
  $("#dumping-observation").hidden = scenario.id !== "dumping";
  $("#water-observation").hidden = scenario.id !== "water";
  $("#results-dialog .dialog-intro").innerHTML =
    scenario.id === "traffic"
      ? "자동차 140대와 보행자 60명이 같은 출발 조건으로 <span data-observation-minutes>7</span>분 동안 이동한 결과예요."
      : "같은 아침과 초기 쓰레기 양에서 <span data-observation-minutes>10</span>분 동안 수거한 결과예요.";
  $("#results-dialog .result-caution").textContent =
    scenario.id === "traffic"
      ? "도착한 차가 다르면 평균도 달라질 수 있어요. 미도착 차량과 전체 차량의 대기도 함께 살펴보세요."
      : "수거율이 높아져도 어떤 지역에는 쓰레기가 더 남을 수 있어요. 수거량과 새로 발생한 양, 이동 중인 수거차를 함께 살펴보세요.";
  $(".reflection-label span").textContent = scenario.reflection;
  $(".fair-note").innerHTML =
    scenario.id === "traffic"
      ? "자동차 140대 · 보행자 60명 · 같은 출발 조건 · <span data-observation-minutes>7</span>분 동안 비교해요."
      : "같은 교통·쓰레기 발생 조건으로 <span data-observation-minutes>10</span>분 동안 비교해요.";
  const planning = scenario.clock === "planning";
  $("#panel-traffic .eyebrow").textContent = planning
    ? "시설 자료"
    : "실시간 관찰";
  $(".tools [data-open-panel=traffic] .tool-icon").innerHTML = icon(
    planning ? "library" : "car",
    25,
  );
  $(".compact-metrics > div:last-child > svg").outerHTML = icon(
    planning ? "residents" : "car",
    20,
  );
  $("#facility-access-controls").hidden = $("#facility-observation").hidden =
    !planning;
  $("#pause").hidden = $("#speed").hidden = planning;
  document
    .querySelectorAll<HTMLElement>("[data-map-layer]")
    .forEach((button) => {
      button.hidden = !scenario.layers.includes(
        button.dataset.mapLayer as MapLayer,
      );
    });
  $("label[for=experiment-duration]").hidden = planning;
  $("label[for=experiment-seed]").firstChild!.textContent = planning
    ? "주민 수요 설정"
    : "차량 출발 조건";
  $("#apply").innerHTML =
    (planning ? "선택한 계획 시행하기 " : "선택한 정책 시행하기 ") +
    icon("arrow", 17);
  if (planning) {
    helpSteps.splice(
      0,
      4,
      "주민 의견과 시설 지도에서 동네별 거리와 이용 자리를 살펴봐요.",
      "공터를 먼저 고른 뒤 면적과 예산에 맞는 시설을 배치해요.",
      "‘선택한 계획 시행하기’를 누르면 같은 주민 수요로 계획을 바로 비교해요.",
      "동네별 혜택과 남은 불편을 확인하고 선택 이유와 생각을 기록해요.",
    );
    $("#focus-school").innerHTML =
      icon("eye", 18) + " 기존 도서관 살펴보기 " + icon("arrow", 17);
    $("#policy-title").textContent = "필요한 시설과 위치 고르기";
    $("#traffic-title").textContent = "우리 동네 시설 접근성";
    $(".tools [data-open-panel=traffic] > span:last-child").textContent =
      "시설 지도";
    $("#results-dialog .dialog-intro").textContent =
      "같은 주민 수요에서 시설의 위치·종류·이용 자리를 바꾸어 비교한 계획이에요.";
    $("#results-dialog .result-caution").textContent =
      "도보 시간은 보행 연결망으로 계산한 예상치예요. 가까워졌는지와 이용 자리가 있는지는 서로 다른 문제예요.";
    $(".fair-note").textContent =
      "같은 주민 수요 · 예상 보행 거리와 이용 정원 · 계획 1회 비교";
  }
  if (scenario.id === "environment") {
    helpSteps[0] =
      "개발 부지와 주민 의견을 살펴보고 환경 지도·교통 지도를 비교해요.";
    helpSteps[2] =
      "기존 수요는 유지하고, 개발 규모에 따라 추가된 차량이 실제 길에서 움직여요.";
    $("#policy-title").textContent = "개발과 보전을 함께 생각하기";
    $("#traffic-title").textContent = "우리 동네 개발과 환경";
    $(".tools [data-open-panel=traffic] > span:last-child").textContent =
      "환경 자료";
    $(".tools [data-open-panel=traffic] .tool-icon").innerHTML = icon(
      "park",
      25,
    );
    $("#focus-school").innerHTML =
      icon("eye", 18) + " 산업 확장 부지 살펴보기 " + icon("arrow", 17);
    $("#results-dialog .dialog-intro").innerHTML =
      "같은 기존 차량 140대·보행자 60명에 개발로 추가된 차량을 반영해 <span data-observation-minutes>7</span>분 관찰했어요.";
    $("#results-dialog .result-caution").textContent =
      "환경 부담은 거리와 도로 위 차량으로 계산한 가상 지표예요. 실제 오염·소음·건강 위험 수치가 아니며, 개발 편익과 동네별 차이를 함께 봐요.";
    $(".fair-note").innerHTML =
      "기존 수요 동일 · 추가 수요는 개발 규모에 따라 변화 · <span data-observation-minutes>7</span>분 비교";
  }
  if (scenario.id === "logistics") {
    helpSteps[0] =
      "공장과 이웃 마을의 물자, 화물차와 상점 재고를 살펴보고 주민 의견을 들어요.";
    $("#focus-school").innerHTML =
      icon("eye", 18) + " 생산 공장 살펴보기 " + icon("arrow", 17);
    $("#policy-title").textContent = "물건이 제때 도착하는 방법";
    $("#traffic-title").textContent = "우리 동네 물자의 흐름";
    $(".tools [data-open-panel=traffic] > span:last-child").textContent =
      "물류 현황";
    $(".tools [data-open-panel=traffic] .tool-icon").innerHTML = icon(
      "goods",
      25,
    );
    $("#results-dialog .dialog-intro").innerHTML =
      "같은 초기 물자·생산·소비·교통 조건에서 <span data-observation-minutes>10</span>분 동안 배송한 결과예요. 새 공급처는 선택한 정책에 따라 추가해요.";
    $("#results-dialog .result-caution").textContent =
      "상점 재고가 적은 까닭은 배송 지연일 수도, 많이 팔렸기 때문일 수도 있어요. 배송량·못 산 물량·상점별 차이를 함께 살펴봐요.";
    $(".fair-note").innerHTML =
      "같은 초기 재고·생산·소비·교통 조건 · <span data-observation-minutes>10</span>분 비교";
  }
  if (scenario.id === "parking") {
    $("#focus-school").textContent = "학교 앞 불법주차 살펴보기";
    $("#policy-title").textContent = "길을 함께 쓰는 방법";
    $("#traffic-title").textContent = "불법주차 현황";
    $(".tools [data-open-panel=traffic] > span:last-child").textContent =
      "주차 현황";
    $("#results-dialog .dialog-intro").textContent =
      "같은 주차 차량 6대·일반 차량 140대·보행자 60명으로 비교한 결과예요.";
    $("#results-dialog .result-caution").textContent =
      "한곳이 나아져도 다른 골목에는 불편이 남을 수 있어요. 사용한 예산과 공터, 주차 뒤 걸어가는 거리도 함께 봐요.";
    $(".fair-note").textContent =
      "같은 주차 수요 6대 · 자동차 140대 · 보행자 60명";
    helpSteps[0] =
      "우리 동네 조사에서 현장을 찾고, 자료와 서로 다른 주민 의견을 모아요.";
    helpSteps[1] =
      "정책을 고른 뒤 지도에서 적용할 곳을 눌러요. 위치와 예산을 확인하고 ‘선택한 정책 시행하기’를 눌러요.";
  }
  if (scenario.id === "dumping") {
    $("#focus-school").textContent = "무단투기 현장 살펴보기";
    $("#policy-title").textContent = "치우고, 다시 버리지 않도록";
    $("#traffic-title").textContent = "무단투기와 수거 현황";
    $(".tools [data-open-panel=traffic] > span:last-child").textContent =
      "쓰레기 현황";
    $("#results-dialog .dialog-intro").textContent =
      "같은 배출 수요와 두 대의 수거차로 세 번의 관찰을 비교했어요.";
    $("#results-dialog .result-caution").textContent =
      "투기가 줄어도 지정 장소가 넘치거나 다른 수거장이 늦어질 수 있어요. 도시 전체에 남은 양도 봐요.";
    $(".fair-note").textContent =
      "같은 배출 수요 · 수거차 2대 · 5분씩 3차 관찰";
    helpSteps[0] =
      "갈색 봉투는 무단투기, 건물의 갈색은 정상 배출 장소에 남은 양이에요. 현장에서 자료와 주민 의견을 모아요.";
    helpSteps[1] = "정책과 적용할 현장을 지도에서 고르고 예산 안에서 시행해요.";
    helpSteps[2] =
      "5분씩 세 번 관찰해요. 회차가 끝나면 자료를 담고 재생으로 이어 봐요. ‘끝까지’는 세 회차를 모두 계산해요.";
  }
  if (scenario.id === "water") {
    $("#focus-school").textContent = "하천 관찰소 살펴보기";
    $("#policy-title").textContent = "오염이 들어오는 곳부터";
    $("#traffic-title").textContent = "상류와 하류 관찰";
    $(".tools [data-open-panel=traffic] > span:last-child").textContent =
      "수질 현황";
    $(".tools [data-open-panel=traffic] .tool-icon").innerHTML = icon(
      "water",
      25,
    );
    $("#results-dialog .dialog-intro").textContent =
      "같은 유량과 유입 일정으로 5분씩 세 번 관찰했어요.";
    $("#results-dialog .result-caution").textContent =
      "색은 교육용 가상 오염도예요. 실제 수질 등급이나 마실 수 있는지를 나타내지 않아요. 지도 밖으로 흘러간 오염도 함께 봐요.";
    $(".fair-note").textContent = "같은 유량·유입 일정 · 5분씩 3차 관찰";
    helpSteps[0] =
      "세 관찰소의 자료와 주민 의견을 모아요. 물에 섞인 오염과 떠 있는 쓰레기는 달라요.";
    helpSteps[1] =
      "지도에서 처리할 유입구·시설을 지을 공터·청소할 둔치를 골라 예산 안에서 시행해요.";
    helpSteps[2] =
      "각 회차의 자료를 담고 재생으로 이어 봐요. 상류의 변화가 하류에 도달하는 데 시간이 걸려요.";
  }
  document.querySelectorAll("#help-dialog ol li").forEach((li, i) => {
    li.textContent = helpSteps[i];
  });
  const helpNotes = document.querySelectorAll("#help-dialog > p");
  helpNotes[0].innerHTML = `왼쪽 드래그: 회전 · 오른쪽 드래그: 이동<br>휠: 확대·축소${planning ? "" : " · 스페이스: 일시정지"}<br>건물·도로·교차로 클릭: 정보 확인`;
  helpNotes[1].textContent = planning
    ? "보행 경로로 계산한 예상 시간과 시설 정원을 비교해요. 가상 주민이 실제로 도착한 수는 아니에요."
    : scenario.id === "water"
      ? "물의 흐름과 유입·처리를 단순화한 학습용 모형이에요. 색만으로 실제 수질을 판단할 수는 없어요."
      : scenario.id === "logistics"
        ? "화물차는 도착한 뒤 정차해서 싣고 내려요. 도시 밖의 생산과 이동은 입구의 공급률로 단순화한 가상 모형이에요."
        : scenario.id === "environment"
          ? "환경 부담은 시설과의 거리, 실제 도로 위 차량, 완충 녹지로 계산한 가상 비교 지표예요. 실제 환경 측정값은 아니에요."
          : "혼잡도 색은 실제 차량의 수와 속도로 계산해요. 보행자는 초록불에 건너고, 차는 건너던 사람이 길을 비울 때까지 기다려요.";
  applyMapLayer();
}
function applyMapLayer() {
  overlay = mapLayer === "traffic";
  city.setMapLayer(mapLayer);
  $<HTMLSelectElement>("#map-layer").value = mapLayer;
  document
    .querySelectorAll<HTMLElement>("[data-map-layer]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.mapLayer === mapLayer),
      ),
    );
  $("#overlay-legend").hidden = mapLayer === "normal";
  document
    .querySelectorAll<HTMLElement>("[data-layer-legend]")
    .forEach(
      (legend) => (legend.hidden = legend.dataset.layerLegend !== mapLayer),
    );
  document
    .querySelectorAll<HTMLElement>("[data-access-service]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.accessService === accessService),
      ),
    );
  $("#map-layer-note").textContent = {
    water:
      "물에 섞인 오염의 가상 오염도: 낮음 5 미만 · 보통 5~12 미만 · 높음 12 이상. 실제 수질 등급이 아니에요. 봉투 모형은 떠 있는 쓰레기의 축약 표시예요.",
    land: "지도 면적을 네 배로 넓힌 도시예요. 주거·상업·산업지구, 새봄천, 처리장과 A~F 공터를 살펴봐요.",
    normal:
      scenario.clock === "planning"
        ? "주택·공공시설·공터를 눌러 자세히 볼 수 있어요."
        : "건물·도로·차량을 눌러 자세히 볼 수 있어요.",
    traffic: "차량 수와 속도에 따른 원활·느림·막힘 표시예요.",
    waste:
      "수거하는 6곳의 건물 색이에요. 0봉투는 흰색, 60봉투 이상은 진한 갈색이에요. 같은 기준으로 비교하고 수거되면 색이 옅어져요. 다른 건물은 원래 색이에요.",
    stock:
      "상점 4곳의 현재 재고예요. 빨강 품절 · 주황 5상자 미만 · 노랑 5~15상자 미만 · 녹색 15상자 이상. 아직 차에 실린 물자는 재고에 넣지 않아요. 판매로 재고가 줄어드는 점도 함께 살펴봐요.",
    population: "실제 인구가 아닌 이 도시의 가상 거주·이용 인구예요.",
    access:
      "주택별 예상 도보 시간: 녹색 2분 이내 · 노랑 2~4분 · 주황 4~5분 · 빨강 5분 초과 또는 길 없음. 테두리 길은 시설에서 5분 안에 닿는 보행 범위예요. 인원은 이용 가능 / 필요한 주민이에요. 가까워도 자리가 부족할 수 있어요.",
    environment:
      "현재 가상 부담: 낮음 10점 미만 · 중간 10~20점 미만 · 높음 20점 이상. 색과 숫자로 함께 표시해요. 실측 기준이 아니에요.",
  }[mapLayer];
}
function updateScenarioObservation() {
  if (!$("#panel-inquiry").hidden && inquiry.step === 1) {
    const context = inquiryContext(),
      place = context.places.find((p) => p.id === inquiry.placeId);
    if (place) {
      $(".inquiry-fact small").textContent =
        `지금 관찰한 사실 · ${Math.floor(sim.time)}초`;
      $(".inquiry-fact p").textContent = place.fact;
    }
  }
  if (sim instanceof ParkingSimulation) {
    $("#parking-count").textContent = String(sim.parkingStats.illegal);
    $("#parking-walkers").textContent =
      `차를 피해 돌아간 사람 ${sim.parkingStats.detouredPeople}명 · 더 걸은 거리 합계 ${sim.parkingStats.extraWalkingDistance.toFixed(1)}m`;
    for (const s of PARKING_SITES)
      $(`[data-parking-fact="${s.id}"]`).textContent = parkingFact(sim, s.id);
  }
  if (!$("#panel-residents").hidden)
    city.setResidentVoices(
      residentVoices(sim, mode === "done" ? baseline : undefined),
    );
  if (sim instanceof LogisticsSimulation) {
    if (!$("#panel-traffic").hidden) {
      const root = $("#logistics-observation");
      const open = [
        ...root.querySelectorAll<HTMLDetailsElement>("details[open]"),
      ].map((d) => d.id);
      const focused = document.activeElement as HTMLElement | null;
      const key = ["truck", "facility", "cargoSource"].find(
        (k) => focused?.dataset[k],
      );
      const focusId =
        focused?.matches("summary") && root.contains(focused)
          ? focused.parentElement!.id
          : undefined;
      const focusValue = key ? focused!.dataset[key] : undefined;
      const scroll = $("#panel-traffic .panel-body").scrollTop;
      root.innerHTML = logisticsObservation(sim);
      open.forEach((id) => ($<HTMLDetailsElement>(`#${id}`).open = true));
      if (key)
        [...root.querySelectorAll<HTMLElement>("button")]
          .find((b) => b.dataset[key] === focusValue)
          ?.focus({ preventScroll: true });
      if (focusId)
        root
          .querySelector<HTMLElement>(`#${focusId} summary`)
          ?.focus({ preventScroll: true });
      $("#panel-traffic .panel-body").scrollTop = scroll;
    }
    return;
  }
  if (sim instanceof FacilitySimulation) {
    if (
      facilityObservationRun !== sim ||
      facilityObservationKind !== accessService
    ) {
      $("#facility-observation").innerHTML = facilityObservation(
        sim,
        accessService,
      );
      facilityObservationRun = sim;
      facilityObservationKind = accessService;
    }
    return;
  }
  if (sim instanceof EnvironmentSimulation) {
    if (!$("#panel-traffic").hidden) {
      const root = $("#environment-observation");
      const open = [
        ...root.querySelectorAll<HTMLDetailsElement>("details[open]"),
      ].map((d) => d.id);
      const focused = document.activeElement as HTMLElement | null;
      const focusSelector = focused?.dataset.environmentPlace
        ? `[data-environment-place="${focused.dataset.environmentPlace}"]`
        : focused?.dataset.development
          ? `[data-development="${focused.dataset.development}"]`
          : focused?.matches("summary") && root.contains(focused)
            ? `#${focused.parentElement!.id} summary`
            : undefined;
      const scroll = $("#panel-traffic .panel-body").scrollTop;
      root.innerHTML = environmentObservation(sim);
      open.forEach((id) => {
        $<HTMLDetailsElement>(`#${id}`).open = true;
      });
      if (focusSelector) $(focusSelector).focus({ preventScroll: true });
      $("#panel-traffic .panel-body").scrollTop = scroll;
    }
    return;
  }
  if (sim instanceof WaterSimulation) {
    $("#water-summary").innerHTML = waterSummary(sim);
    for (const s of sim.waterStats.sites)
      $(`[data-water-amount="${s.id}"]`).textContent =
        `가상 오염도 ${s.level.toFixed(1)} · 물 위 ${s.litter.toFixed(1)}봉투`;
    $("#water-sources").innerHTML = waterSources(sim);
    $<HTMLButtonElement>("#next-water-round").disabled =
      busy || sim.time >= experiment.duration;
    $("#next-water-round").textContent =
      sim.time >= experiment.duration
        ? "세 번의 관찰 완료"
        : `${Math.min(3, Math.floor((sim.time + 1e-7) / 300) + 1)}차 관찰 지점까지 빠르게 보기`;
    return;
  }
  if (sim instanceof DumpingSimulation) {
    $("#dumping-summary").innerHTML = dumpingSummary(sim);
    for (const s of sim.dumpingStats.sites)
      $(`[data-dumping-amount="${s.id}"]`).textContent =
        `투기 ${s.remaining.toFixed(1)}봉투 · 청소 뒤 재발 ${s.repeatDumped}봉투`;
    const focused = document.activeElement as HTMLElement | null;
    if (!focused?.closest("#dumping-collection"))
      $("#dumping-collection").innerHTML = dumpingCollection(sim);
    $<HTMLButtonElement>("#next-dumping-round").disabled =
      busy || sim.time >= experiment.duration;
    $("#next-dumping-round").textContent =
      sim.time >= experiment.duration
        ? "세 번의 관찰 완료"
        : `${Math.min(3, Math.floor((sim.time + 1e-7) / 300) + 1)}차 관찰 지점까지 빠르게 보기`;
    return;
  }
  if (!(sim instanceof WasteSimulation)) return;
  if (!$("#panel-traffic").hidden) {
    const detailsOpen = document.querySelector<HTMLDetailsElement>(
      "#waste-sites-details",
    )?.open;
    const focused = document.activeElement as HTMLElement | null;
    const focusSelector = focused?.dataset.truck
      ? `[data-truck="${focused.dataset.truck}"]`
      : focused?.dataset.facility
        ? `[data-facility="${focused.dataset.facility}"]`
        : focused?.matches("#waste-sites-details summary")
          ? "#waste-sites-details summary"
          : undefined;
    $("#waste-observation").innerHTML = wasteObservation(sim);
    if (detailsOpen) $<HTMLDetailsElement>("#waste-sites-details").open = true;
    if (focusSelector) $(focusSelector).focus({ preventScroll: true });
  }
}
function showWasteResults(before: WasteSimulation, after: WasteSimulation) {
  panels.close();
  const result = wasteResults(before, after);
  $("#result-table").innerHTML = result.table;
  $("#result-analysis").innerHTML = result.details;
  const delta = after.wasteStats.remaining - before.wasteStats.remaining;
  $("#result-summary").innerHTML =
    `<div class="result-highlight" data-outcome="${delta < -0.05 ? "better" : delta > 0.05 ? "worse" : "same"}"><span>${icon("city", 29)}</span><div><strong>${Math.abs(delta) < 0.05 ? "남은 쓰레기 양은 비슷해요" : `남은 쓰레기가 ${Math.abs(delta).toFixed(1)}봉투 ${delta < 0 ? "줄었어요" : "늘었어요"}`}</strong><p>사용 예산 ${after.cost} · 동네별 차이도 살펴보세요.</p></div></div>`;
  if (!$<HTMLDialogElement>("#results-dialog").open)
    $<HTMLDialogElement>("#results-dialog").showModal();
}
$("#choose-scenario").addEventListener("click", () =>
  $<HTMLDialogElement>("#scenario-dialog").showModal(),
);
$("#close-scenarios").addEventListener("click", () =>
  $<HTMLDialogElement>("#scenario-dialog").close(),
);
function chooseScenario(id: string) {
  scenario = getScenario(id);
  experiment.duration = scenario.duration;
  chosenIds = [];
  mapLayer = scenario.id === "water" ? "water" : "normal";
  accessService = "library";
  $<HTMLSelectElement>("#access-service").value = accessService;
  $<HTMLDialogElement>("#scenario-dialog").close();
  updateScenarioUI();
  resetExperiment();
  city.resetCamera();
  toast(scenario.title + " 관찰을 시작했어요.");
}
$("#scenario-dialog").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-scenario]",
  );
  if (!button || busy) return;
  chooseScenario(button.dataset.scenario!);
});
$("#map-layer").addEventListener("change", () => {
  const next = $<HTMLSelectElement>("#map-layer").value as MapLayer;
  if (!scenario.layers.includes(next)) return;
  mapLayer = next;
  applyMapLayer();
  investigate("지도: " + next);
});
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const planPlot = target.closest<HTMLElement>("[data-plan-plot]");
  if (planPlot && !busy) {
    chooseScenario("facilities");
    facilityPlan = { ...facilityPlan, siteId: planPlot.dataset.planPlot! };
    $<HTMLSelectElement>("#facility-site").value = facilityPlan.siteId;
    updatePolicy();
    panels.open("policy");
    return;
  }
  const clear = target.closest<HTMLElement>("[data-clear-plot]");
  if (clear && !busy) {
    facilityPlan = {
      ...facilityPlan,
      buildings: facilityPlan.buildings?.filter(
        (b) => b.siteId !== clear.dataset.clearPlot,
      ),
    };
    syncBuildingPolicies();
    updatePolicy();
    return;
  }
  const panel =
    target.closest<HTMLElement>("[data-open-panel]")?.dataset.openPanel;
  if (panel === "residents" || panel === "traffic") {
    investigate(panel === "residents" ? "주민 의견" : "도시 통계");
    updateScenarioObservation();
  }
  const truck = target.closest<HTMLElement>("[data-truck]");
  if (
    truck &&
    (sim instanceof WasteSimulation || sim instanceof LogisticsSimulation)
  )
    city.select({
      kind: "service",
      id: truck.dataset.truck!,
      title: sim.trucks.find((t) => String(t.id) === truck.dataset.truck)!.name,
      description: "실제 이동 경로와 남은 적재량을 확인해요.",
    });
  const facility = target.closest<HTMLElement>("[data-facility]");
  const source = target.closest<HTMLElement>("[data-cargo-source]");
  if (source) city.focusSupply(source.dataset.cargoSource!);
  if (facility) city.focusFacility(facility.dataset.facility!);
  const environmentPlace = target.closest<HTMLElement>(
    "[data-environment-place]",
  );
  if (environmentPlace && sim instanceof EnvironmentSimulation) {
    mapLayer = "environment";
    applyMapLayer();
    if (environmentPlace.dataset.environmentPlace === "housing")
      city.focusDevelopment("housing");
    else city.focusFacility(environmentPlace.dataset.environmentPlace!);
  }
  const development = target.closest<HTMLElement>("[data-development]");
  if (development) city.focusDevelopment(development.dataset.development!);
  const neighborhood = target.closest<HTMLElement>("[data-neighborhood]");
  if (neighborhood && sim instanceof FacilitySimulation) {
    mapLayer = "access";
    applyMapLayer();
    city.focusFacility(neighborhood.dataset.neighborhood!);
  }
  const civic = target.closest<HTMLElement>("[data-civic]");
  if (civic) city.focusCivic(civic.dataset.civic!);
  const site = target.closest<HTMLElement>("[data-select-site]");
  if (site && FACILITY_SITES.some((s) => s.id === site.dataset.selectSite)) {
    facilityPlan = { ...facilityPlan, siteId: site.dataset.selectSite! };
    $<HTMLSelectElement>("#facility-site").value = facilityPlan.siteId;
    panels.open("policy");
    updatePolicy();
    toast("이 부지를 골랐어요. 지을 시설을 선택해 주세요.");
  }
});

$("#facility-site").addEventListener("change", () => {
  const siteId = $<HTMLSelectElement>("#facility-site").value;
  if (FACILITY_SITES.some((s) => s.id === siteId)) {
    facilityPlan = { ...facilityPlan, siteId };
    investigate("건설 부지: " + siteId);
    updatePolicy();
  }
});
$("#preview-facility-site").addEventListener("click", () =>
  city.focusCivic(facilityPlan.siteId, true),
);
function changeAccessService(kind: ServiceKind) {
  accessService = kind;
  $<HTMLSelectElement>("#access-service").value = kind;
  city.setAccessService(accessService);
  applyMapLayer();
  updateScenarioObservation();
  updateSelection();
  investigate("접근성: " + accessService);
}
$("#access-service").addEventListener("change", () =>
  changeAccessService(
    $<HTMLSelectElement>("#access-service").value as ServiceKind,
  ),
);

installRecordTools(buildRecord, toast);
