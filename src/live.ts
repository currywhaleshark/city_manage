import "./live.css";
import { CityRenderer } from "./renderer/city";
import {
  LiveCitySimulation,
  LIVE_POLICIES,
  TOPICS,
  type Topic,
  type LivePolicyId,
  type CityEvent,
} from "./simulation/live";
import {
  StoryReader,
  bindStoryReading,
  storyVoice,
  topicLayer,
  updateNewsList,
  newsEventFor,
} from "./ui/live-study";
import {
  ObservationComparison,
  policyComparisonMarkup,
} from "./ui/live-notebook";
import { mapTools } from "./ui/map-layers";
import { bindMapScrollHint } from "./ui/map-scroll-hint";
import { PlaceInspector } from "./ui/place-inspector";
import {
  policyAvailability,
  policyListMarkup,
  updatePolicyAvailability,
} from "./ui/live-policies";
import { icon } from "./ui/icons";
import type { MapLayer } from "./scenarios";
import {
  readDisplayQuality,
  saveDisplayQuality,
  RenderClock,
  type DisplayQuality,
} from "./renderer/quality";
import { captureLiveCheckpoint } from "./simulation/checkpoint";
import { writeCheckpoint, clearCheckpoint } from "./storage/live-checkpoint";
import { loadSavedCity } from "./storage/load-city";
import {
  communityProject,
  communityTargets,
  type CommunityProjectId,
  type CommunityMethodId,
} from "./simulation/community";
import {
  communityOverview,
  communityListening,
  communityPlan,
  communityRecord,
  communityHistory,
  communityStatus,
  type MeetingDraft,
} from "./ui/community";

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const stamp = (time: number) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
const tool = (id: string, label: string, glyph: string) =>
  `<button class="tool" data-panel-open="${id}"><span class="tool-icon">${icon(glyph, 24)}</span><span>${label}</span></button>`;
document.body.classList.add("living-city");
document.title = "우리 동네 시장님 · 살아가는 새봄동";
$("#app").innerHTML = `<main class="workspace">
  <section class="city-view" aria-label="계속 살아가는 새봄동"><canvas id="city-canvas" tabindex="0" aria-label="도시 지도. 드래그 회전, 오른쪽 드래그 이동, 휠 확대"></canvas><div id="map-labels" aria-hidden="true"></div></section>
  <header class="topbar"><div class="brand"><span class="brand-mark">${icon("city", 24)}</span><div><h1>우리 동네 시장님</h1><span>새봄동 · 함께 살아가는 도시</span></div></div><div class="header-end"><span class="mode-badge"><i class="live-dot"></i><span id="live-state">도시가 살아가고 있어요</span></span><span class="live-wallet">예산 <b id="mobile-budget">100</b></span><button id="help" class="square" aria-label="도움말">${icon("help", 20)}</button></div></header>
  <button class="mission-peek" id="news-peek" hidden><span class="mission-number" id="issue-count">0</span><span><small>지금 우리 동네</small><strong id="latest-news">이웃의 이야기를 들어 봐요</strong></span>${icon("arrow", 17)}</button>
  ${mapTools}
  <div class="compass"><span>북</span><svg width="25" height="35" viewBox="0 0 25 35"><path d="M12 2 5 24l7-5 7 5Z" fill="#384e48"/></svg></div>
  <div class="map-controls"><button id="zoom-in" aria-label="지도 확대">${icon("plus")}</button><button id="zoom-out" aria-label="지도 축소">${icon("minus")}</button><button id="camera-reset" aria-label="전체 도시 보기">${icon("home")}</button></div>
  <section id="live-panel" class="floating-panel" hidden aria-labelledby="live-panel-title"><div class="panel-heading"><div><span class="eyebrow" id="live-eyebrow">새봄동</span><h2 id="live-panel-title" tabindex="-1"></h2></div><button id="close-panel" class="square" aria-label="패널 닫기">${icon("close", 18)}</button></div><div class="panel-body" id="live-panel-body"></div></section>
  <div class="live-resident-nav" hidden><span id="voice-count">주민 이야기</span><button id="toggle-voices" aria-pressed="true">말풍선 접기</button></div>
</main>
<footer class="command-deck"><div class="toolbelt"><div class="town-badge"><span>${icon("city", 30)}</span><div><strong>새봄동</strong><small>문제도, 변화도 이어져요</small></div></div><nav class="tools" aria-label="도시 관리">${tool("news", "동네 소식", "residents")}${tool("policy", "정책 만들기", "bypass")}${tool("observe", "도시 살펴보기", "layers")}${tool("notebook", "조사 기록", "chart")}</nav><div class="compact-metrics"><div>${icon("coin", 20)}<span><small>남은 예산</small><strong id="live-budget">100</strong></span></div></div></div>
<div class="statusbar"><div class="time-controls"><button id="pause" class="square" aria-label="일시정지">${icon("pause", 18)}</button><span id="clock">0:00</span><select id="speed" aria-label="시뮬레이션 속도"><option value="1">1배속</option><option value="2">2배속</option><option value="4" selected>4배속</option><option value="8">8배속</option></select></div><p id="footer-status">정책을 바꿔도 도시의 시간은 이어져요.</p><span id="next-grant">운영 예산 +20까지 5:00</span><button id="save-city">도시 저장</button></div></footer>
<div id="toast" role="status" aria-live="polite"></div>`;
$('[data-map-layer="environment"]').remove();
for (const button of document.querySelectorAll<HTMLElement>("[data-map-layer]"))
  button.setAttribute("aria-label", button.textContent!.trim() + " 보기");
bindMapScrollHint($(".map-tools"));
let sim = new LiveCitySimulation(),
  paused = false,
  layer: MapLayer = "normal",
  panel = "",
  topic: Topic = "parking",
  revision = -1,
  voicesOpen = true,
  busy = false;
let pending:
  { id: LivePolicyId; target: string; wasPaused: boolean } | undefined;
let meeting: MeetingDraft | undefined;
let displayQuality = readDisplayQuality();
const renderClock = new RenderClock();
let loadAbort: AbortController | undefined,
  loadingText = "",
  loadGeneration = 0;
let checkpointFailed = false;
let resetDraft:
  { wasPaused: boolean; wasBusy: boolean; from: string } | undefined;
let resetting = false;
const city = new CityRenderer(
  $("#city-canvas"),
  $("#map-labels"),
  displayQuality,
);
const reader = new StoryReader();
const inspector = new PlaceInspector($(".city-view"), city, () => {
  paused = !paused;
  inspector.update(sim.time, paused);
});
let inspectionLayer: MapLayer | undefined;
inspector.onClose = () => {
  if (inspectionLayer !== undefined) setLayer(inspectionLayer);
  inspectionLayer = undefined;
};
let studyContext: CityEvent | undefined;
let comparison: ObservationComparison | undefined;
let panelReturnFocus: HTMLElement | undefined;
const storyActions = document.createElement("div");
storyActions.className = "live-story-actions";
storyActions.innerHTML =
  '<button id="inspect-story">이 장소 확대 보기</button><button id="investigate-story">이 문제 살펴보기</button><button id="finish-story">읽기 마치기</button>';
$("#resident-bubble").append(storyActions);
bindStoryReading($("#resident-map"), reader, () => {
  if (reader.current) {
    topic = reader.current.topic;
    studyContext = reader.current;
  }
  $("#voice-count").textContent = "읽는 중";
});
function renderStory() {
  const event = reader.sync(sim.currentStory);
  city.setResidentVoices(event ? [storyVoice(event)] : []);
  $(".live-resident-nav").hidden = !event;
  $("#voice-count").textContent = reader.reading ? "읽는 중" : "주민 이야기";
  $("#inspect-story").hidden = !event?.position;
}
function focusStory(event: CityEvent) {
  if (!event.position) return;
  city.focusPosition(event.position);
}
function inspectPlace(event: CityEvent) {
  if (!event.position || inspector.isOpen) return;
  reader.hold(event);
  inspectionLayer = layer;
  setLayer(topicLayer[event.topic]);
  inspector.open(event.title, event.position);
  inspector.update(sim.time, paused);
}
function readStory(event: CityEvent) {
  reader.hold(event);
  studyContext = reader.current;
  topic = event.topic;
  if (!voicesOpen) {
    voicesOpen = true;
    city.setResidentMode(true);
    $("#toggle-voices").textContent = "말풍선 접기";
    $("#toggle-voices").setAttribute("aria-pressed", "true");
  }
  renderStory();
  focusStory(event);
  $("#resident-evidence summary").focus({ preventScroll: true });
}
function studyMarkup() {
  return studyContext
    ? `<div class="study-context"><strong>살펴보는 문제 · ${escape(studyContext.title)}</strong><p>${escape(studyContext.text)}</p><small>도시 시간 ${stamp(studyContext.time)}의 소식 · 지도는 현재 상태예요.</small>${studyContext.position ? '<button id="return-to-story">이 장소 다시 보기</button>' : ""}</div>`
    : "";
}
const audio = new Audio(`${import.meta.env.BASE_URL}audio/policy-confirm.wav`);
audio.volume = 0.25;
let sound = false,
  lastSaveTime = -30,
  saveFailed = false;
const SAVE_KEY = "mayor-living-city-v1";
function toast(text: string) {
  $("#toast").textContent = text;
  $("#toast").classList.add("visible");
  setTimeout(() => $("#toast").classList.remove("visible"), 4500);
}
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(sim.save()));
    void writeCheckpoint(captureLiveCheckpoint(sim)).catch(() => {
      if (!checkpointFailed)
        toast(
          "도시 기록은 저장했어요. 빠른 이어하기 저장소는 사용할 수 없어 다음에는 기록을 계산해 불러와요.",
        );
      checkpointFailed = true;
    });
    lastSaveTime = sim.time;
    saveFailed = false;
    return true;
  } catch {
    if (!saveFailed)
      toast(
        "이 브라우저에 저장하지 못했어요. 조사 기록에서 파일로 저장할 수 있어요.",
      );
    saveFailed = true;
    return false;
  }
}
function close() {
  if (meeting) {
    paused = meeting.wasPaused;
    meeting = undefined;
    city.clearPlacement();
  }
  if (pending) {
    paused = pending.wasPaused;
    pending = undefined;
    city.clearPlacement();
  }
  panel = "";
  $("#live-panel").hidden = true;
  document.body.dataset.livePanel = "";
  document.body.dataset.activePanel = "";
  if (panelReturnFocus?.isConnected && panelReturnFocus.getClientRects().length)
    panelReturnFocus.focus({ preventScroll: true });
  else $("#city-canvas").focus({ preventScroll: true });
  panelReturnFocus = undefined;
}
function show(name: string, title: string, body: string) {
  if (!panel)
    panelReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
  panel = name;
  $("#live-panel-title").textContent = title;
  $("#live-panel-body").innerHTML = body;
  $("#live-panel").hidden = false;
  document.body.dataset.livePanel = name;
  document.body.dataset.activePanel = name;
  $("#live-panel-title").focus();
}
function news() {
  show(
    "news",
    "동네 소식",
    `<p class="intro">불편과 반가운 변화가 함께 쌓여요. 소식을 눌러 그곳을 살펴봐요.</p><button class="secondary wide" data-panel-open="community">주민 회의 열기</button><div id="news-list"></div>`,
  );
  renderNews();
}
function renderNews() {
  const box = document.querySelector<HTMLElement>("#news-list");
  if (!box) return;
  updateNewsList(box, sim.news);
}
function policies() {
  show(
    "policy",
    "우리 동네 바꾸기",
    `${studyMarkup()}<label class="layer-picker">살펴볼 분야<select id="policy-topic">${Object.entries(
      TOPICS,
    )
      .map(
        ([id, name]) =>
          `<option value="${id}" ${id === topic ? "selected" : ""}>${name}</option>`,
      )
      .join(
        "",
      )}</select></label><p class="metric-note">예산 <b id="policy-budget">${sim.budget}</b> · 현재 도시에서 바로 시작해요.<br>도시 시간 5분마다 운영 예산 20이 들어와요.</p><div class="live-policy-list policy-options">${policyListMarkup(sim, topic)}</div><button class="secondary wide" data-panel-open="community">남은 문제를 주민과 의논하기</button>`,
  );
}
function beginPolicy(id: LivePolicyId) {
  const p = LIVE_POLICIES.find((p) => p.id === id)!;
  const status = policyAvailability(sim, id);
  if (!status.available) {
    updatePolicyAvailability($("#live-panel-body"), sim);
    toast(status.label);
    return;
  }
  const { targets, global } = status;
  pending = { id, target: "", wasPaused: paused };
  paused = true;
  if (global) {
    reviewPolicy();
    return;
  }
  $("#live-panel").hidden = true;
  city.showPlacement(
    studyContext ? `${p.title} · 살펴보던 곳: ${studyContext.title}` : p.title,
    targets,
    undefined,
    (target) => {
      pending!.target = target;
      city.clearPlacement();
      reviewPolicy();
    },
    () => {
      close();
      policies();
    },
  );
}
function community() {
  show("community", "주민과 함께 정해요", communityOverview(sim));
}
function beginMeeting(project: CommunityProjectId) {
  if (sim.council.current) {
    toast("지금 약속한 활동을 마친 뒤 다음 활동을 의논해요.");
    return;
  }
  meeting = {
    project,
    target: "",
    wasPaused: paused,
    voice: 0,
    heard: [],
    reason: "",
    concern: "",
  };
  paused = true;
  $("#live-panel").hidden = true;
  city.showPlacement(
    communityProject(project).title,
    communityTargets(project),
    undefined,
    (target) => {
      if (!meeting) return;
      meeting.target = target;
      city.clearPlacement();
      listenMeeting();
    },
    () => {
      close();
      community();
    },
  );
}
function listenMeeting() {
  show(
    "meeting",
    communityProject(meeting!.project).title,
    communityListening(meeting!),
  );
}
function planMeeting() {
  show(
    "meeting",
    communityProject(meeting!.project).title,
    communityPlan(meeting!, sim.budget),
  );
}
function viewCommunityRecord(index: number) {
  if (!sim.council.records[index]) return;
  show(
    "community-record",
    communityProject(sim.council.records[index].project).title,
    communityRecord(sim, index),
  );
}
function reviewPolicy() {
  const p = LIVE_POLICIES.find((p) => p.id === pending!.id)!,
    target = sim.targets(p.id).find((t) => t.id === pending!.target);
  show(
    "review",
    p.title,
    `<span class="live-target">${escape(target?.name ?? "도시 전체에 적용")}</span><p class="intro">${p.description}</p><p class="tradeoff">${p.tradeoff}</p><label class="decision-reason">선택한 까닭 <small>적고 싶을 때만 적어요</small><textarea id="live-reason" maxlength="400" rows="3" placeholder="어떤 자료와 주민 이야기를 참고했나요?"></textarea></label><p class="metric-note">예산 ${sim.budget} → ${sim.budget - p.cost}<br>도시 시간 2분 뒤의 변화를 소식에 남겨요. 말풍선은 차례로 나타나요.</p><div class="live-actions"><button id="cancel-policy">다시 살펴보기</button><button class="primary" id="apply-live-policy">이 정책 시행</button></div>`,
  );
}
function observe() {
  show(
    "observe",
    "지금의 도시",
    `<p class="intro">한 가지 숫자만으로 판단하지 말고 장소와 주민 이야기도 함께 살펴봐요.</p><div id="live-readings"></div><button class="secondary wide" id="capture-observation">지금 관찰한 사실 기록</button><p class="metric-note">수질 수치는 학습용 가상 오염도예요.</p>`,
  );
  renderReadings();
}
function renderReadings() {
  const box = document.querySelector("#live-readings");
  if (!box) return;
  box.innerHTML =
    Object.entries(sim.values)
      .map(
        ([k, v]) =>
          `<div class="live-reading"><span>${sim.unit(k as Topic)}</span><strong>${v.toFixed(k === "water" || k === "waste" ? 1 : 0)}</strong></div>`,
      )
      .join("") +
    `<p class="metric-note">수거장에 남은 생활 쓰레기 ${sim.dumpingStats.normalRemaining.toFixed(1)}봉투<br>길가에서 하천으로 이동 ${sim.transferredToRiver.toFixed(1)}봉투<br>물 위 쓰레기 ${sim.water.waterStats.floating.toFixed(1)}봉투<br>도로 위 차량 ${sim.vehicles.size}대 · 수거차 ${sim.trucks.length}대 · 배송차 ${sim.logistics.trucks.length}대<br>비어 있는 공터 ${6 - sim.parcels.length}곳</p>`;
}
function notebook() {
  comparison = new ObservationComparison(sim);
  show(
    "notebook",
    "우리 동네 조사 기록",
    `<p class="intro">문제 발견 → 자료 모으기 → 원인 생각하기 → 방법 고르기 → 실천 → 다시 살펴보기</p><button class="secondary wide" id="capture-observation">지금 관찰한 사실 기록</button>${policyComparisonMarkup(sim)}${comparison.controls()}<div class="live-observations">${
      sim.observations
        .map(
          (o) =>
            `<details><summary>${stamp(o.time)}에 관찰한 사실</summary>${Object.entries(
              o.values,
            )
              .map(([k, v]) => `<p>${sim.unit(k as Topic)} ${v.toFixed(1)}</p>`)
              .join("")}</details>`,
        )
        .join("") ||
      '<p class="metric-note">관찰한 사실을 기록해 두면 다음 변화와 비교할 수 있어요.</p>'
    }</div>${communityHistory(sim.council.records)}<button class="secondary wide" data-panel-open="community">주민과 함께 의논하기</button><label class="decision-reason">생각한 원인과 다음에 할 일<textarea id="live-notes" rows="4" maxlength="4000" placeholder="관찰한 사실과 내 생각을 구분해 적어 봐요.">${escape(sim.notes)}</textarea></label><p class="metric-note">시간에 따른 실제 변화예요. 다른 원인도 함께 바뀌므로 정책 하나의 효과로 단정하지 않아요.</p><div class="live-actions"><button id="export-city">기록 파일 저장</button><button id="import-city">저장 파일 열기</button></div><input id="city-file" type="file" accept="application/json,.json" hidden><button id="new-city" class="secondary wide">저장 초기화</button>`,
  );
}
function help() {
  show(
    "help",
    "살아가는 도시 살펴보기",
    `<ol class="live-help"><li>도시를 보며 지도 위 주민 말풍선을 들어요. 직접 연 이야기는 읽기 마치기를 누를 때까지 남아요.</li><li>왼쪽 지도 자료에서 쓰레기, 수질, 시설 접근성을 살펴요.</li><li>말풍선의 이 문제 살펴보기에서 자료와 정책을 살펴요. 정책과 적용할 장소는 직접 골라요.</li><li>조사 기록에서 시행한 장소와 전후 수치를 비교해요. 도시가 달라지면 주민이 다시 이야기해요.</li><li>남은 문제는 동네 소식의 주민 회의에서 함께 의논해요. 서로 다른 의견을 듣고 실천 방법을 정한 뒤 결과를 돌아봐요.</li></ol><p class="intro">수거차와 배송차는 자동차와 같은 길을 달려요. 하천 옆 쓰레기는 아래로 흐르고, 생산을 늘리면 물자와 오염 배출이 함께 늘어요.</p><p class="metric-note">드래그: 회전 · 오른쪽 드래그: 이동 · 휠: 확대<br>스페이스: 일시정지 · Escape: 창/위치 선택 닫기<br>도시 시간 5분마다 운영 예산 +20<br>자동 저장되며, 자리를 비운 동안의 시간은 흐르지 않아요.</p><label class="layer-picker">화면 품질<select id="display-quality"><option value="normal" ${displayQuality === "normal" ? "selected" : ""}>보통</option><option value="light" ${displayQuality === "light" ? "selected" : ""}>가볍게</option></select></label><p class="metric-note">가볍게: 그림자를 줄이고 초당 30번 그려요. 도시의 계산 결과는 같아요.</p><button id="toggle-sound" aria-pressed="${sound}">정책 효과음 ${sound ? "끄기" : "켜기"}</button><button id="new-city" class="secondary wide">저장 초기화</button>`,
  );
}
function setLayer(next: MapLayer) {
  layer = next;
  document.body.dataset.liveLayer = layer;
  city.setMapLayer(layer);
  $("#overlay-legend").hidden = layer === "normal";
  document
    .querySelectorAll<HTMLElement>("[data-layer-legend]")
    .forEach((el) => (el.hidden = el.dataset.layerLegend !== layer));
  document
    .querySelectorAll<HTMLElement>("[data-map-layer]")
    .forEach((el) =>
      el.setAttribute("aria-pressed", String(el.dataset.mapLayer === layer)),
    );
}
function open(name: string) {
  if (pending || meeting) close();
  (
    ({ news, policy: policies, observe, notebook, community }) as Record<
      string,
      () => void
    >
  )[name]?.();
}
function confirmReset(error = "") {
  if (!resetDraft) {
    resetDraft = { wasPaused: paused, wasBusy: busy, from: panel };
    // A completed/queued restore must not replace this confirmation or the new city.
    loadGeneration++;
    loadAbort?.abort();
    paused = true;
  }
  show(
    "reset",
    "저장한 도시를 초기화할까요?",
    `<p class="intro">이 도시의 진행 시간, 시행한 정책, 주민 회의와 조사 기록을 지우고 새 도시를 시작해요.</p><p class="metric-note">필요한 기록은 먼저 파일로 보관해 주세요.</p>${error ? `<p role="alert">${escape(error)}</p>` : ""}<button id="${resetDraft.wasBusy ? "export-loading" : "export-city"}" class="secondary wide">초기화 전 기록 파일 저장</button><div class="live-actions"><button id="cancel-reset">취소</button><button id="confirm-new" class="primary">지우고 새로 시작</button></div>`,
  );
}
function cancelReset() {
  if (!resetDraft || resetting) return;
  const previous = resetDraft;
  resetDraft = undefined;
  busy = previous.wasBusy;
  paused = previous.wasPaused;
  if (busy) loadingStopped();
  else if (previous.from === "help") help();
  else notebook();
}
async function resetSavedCity() {
  if (!resetDraft || resetting) return;
  resetting = true;
  busy = true;
  show(
    "reset",
    "저장을 초기화하고 있어요",
    '<p class="intro" role="status">저장한 도시와 이어하기 상태를 정리하고 있어요.</p>',
  );
  try {
    await clearCheckpoint();
    localStorage.removeItem(SAVE_KEY);
    sim = new LiveCitySimulation();
    resetDraft = undefined;
    loadingText = "";
    checkpointFailed = false;
    revision = -1;
    lastUI = -1;
    reader.reset();
    studyContext = undefined;
    stats = sim.stats;
    close();
    city.resetCamera();
    setLayer("normal");
    busy = false;
    paused = false;
    lastFrame = performance.now();
    if (save()) toast("저장을 초기화하고 새 도시를 시작했어요.");
  } catch {
    confirmReset("저장소를 정리하지 못했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    resetting = false;
  }
}
document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!b) return;
  if (resetting) return;
  if (resetDraft) {
    if (["cancel-reset", "close-panel"].includes(b.id)) {
      cancelReset();
      return;
    }
    if (!["export-city", "export-loading", "confirm-new"].includes(b.id))
      return;
  }
  if (b.id === "cancel-load") {
    loadAbort?.abort();
    return;
  }
  if (b.id === "retry-load") {
    void load(loadingText);
    return;
  }
  if (
    busy &&
    !resetDraft &&
    !["export-loading", "new-city", "confirm-new"].includes(b.id)
  )
    return;
  if (b.dataset.panelOpen) {
    open(b.dataset.panelOpen);
    return;
  }
  if (b.dataset.livePolicy) {
    beginPolicy(b.dataset.livePolicy as LivePolicyId);
    return;
  }
  if (b.dataset.communityProject) {
    beginMeeting(b.dataset.communityProject as CommunityProjectId);
    return;
  }
  if (b.dataset.communityMethod && meeting) {
    meeting.method = b.dataset.communityMethod as CommunityMethodId;
    planMeeting();
    return;
  }
  if (b.dataset.communityRecord !== undefined) {
    viewCommunityRecord(Number(b.dataset.communityRecord));
    return;
  }
  if (b.dataset.mapLayer) {
    setLayer(
      layer === b.dataset.mapLayer
        ? "normal"
        : (b.dataset.mapLayer as MapLayer),
    );
    return;
  }
  if (b.dataset.accessService) {
    city.setAccessService(b.dataset.accessService as "park" | "library");
    document
      .querySelectorAll("[data-access-service]")
      .forEach((el) => el.setAttribute("aria-pressed", String(el === b)));
    return;
  }
  if (b.dataset.news) {
    const n =
      newsEventFor(b) ?? sim.news.find((n) => n.id === Number(b.dataset.news));
    if (!n) return;
    close();
    readStory(n);
    return;
  }
  if (b.dataset.reviewPolicy !== undefined) {
    const result = sim.policyComparisons[Number(b.dataset.reviewPolicy)];
    if (!result) return;
    if (!result.position) {
      close();
      reader.finish();
      studyContext = undefined;
      topic = result.topic;
      setLayer(topicLayer[topic]);
      renderStory();
      city.resetCamera();
      return;
    }
    const event: CityEvent = {
      id: -(Number(b.dataset.reviewPolicy) + 1),
      time: result.time,
      topic: result.topic,
      type: "reaction",
      title: `${result.place} · ${result.title}`,
      text: result.tradeoff,
      facilityId: "b7",
      position: result.position,
      evidence: `${result.scope} · ${result.measurement}: 시행 전 ${result.before.toFixed(1)} → 관찰 때 ${result.now.toFixed(1)}. 다른 정책과 생활 변화도 함께 반영돼요.`,
    };
    inspectPlace(event);
    return;
  }
  switch (b.id) {
    case "close-panel":
    case "cancel-policy":
    case "cancel-meeting":
      close();
      break;
    case "news-peek":
      news();
      break;
    case "help":
      help();
      break;
    case "zoom-in":
      city.zoom(1.2);
      break;
    case "zoom-out":
      city.zoom(1 / 1.2);
      break;
    case "camera-reset":
      city.resetCamera();
      break;
    case "pause":
      if (!pending && !meeting) paused = !paused;
      break;
    case "community-next":
      if (meeting) {
        const p = communityProject(meeting.project),
          v = p.voices[meeting.voice];
        if (!meeting.heard.includes(v.id)) meeting.heard.push(v.id);
        if (meeting.voice < p.voices.length - 1) {
          meeting.voice++;
          listenMeeting();
        } else planMeeting();
      }
      break;
    case "community-previous":
      if (meeting) {
        meeting.voice = Math.max(0, meeting.voice - 1);
        listenMeeting();
      }
      break;
    case "community-back":
      if (meeting) {
        meeting.voice = 0;
        listenMeeting();
      }
      break;
    case "start-community":
      if (meeting?.method) {
        try {
          const m = meeting;
          sim.council.start(
            m.project,
            m.target,
            m.method!,
            m.heard,
            m.reason,
            m.concern,
          );
          close();
          save();
          if (sound) void audio.play().catch(() => {});
          toast(
            "주민이 함께 정한 활동을 준비해요. 지도에서 실천 장소를 볼 수 있어요.",
          );
        } catch (err) {
          toast((err as Error).message);
        }
      }
      break;
    case "save-city":
      if (save()) toast("현재 도시와 조사 기록을 저장했어요.");
      break;
    case "investigate-story":
      if (reader.current) {
        reader.hold();
        studyContext = reader.current;
        topic = studyContext.topic;
        setLayer(topicLayer[topic]);
        focusStory(studyContext);
        policies();
      }
      break;
    case "return-to-story":
      if (studyContext) inspectPlace(studyContext);
      break;
    case "inspect-story":
      if (reader.current) inspectPlace(reader.current);
      break;
    case "finish-story":
      reader.finish();
      renderStory();
      $("#city-canvas").focus({ preventScroll: true });
      break;
    case "toggle-voices":
      voicesOpen = !voicesOpen;
      if (!voicesOpen) reader.finish();
      city.setResidentMode(voicesOpen);
      b.textContent = voicesOpen ? "말풍선 접기" : "말풍선 보기";
      b.setAttribute("aria-pressed", String(voicesOpen));
      break;
    case "toggle-sound":
      sound = !sound;
      help();
      break;
    case "apply-live-policy":
      if (pending) {
        try {
          const a = pending;
          sim.apply(
            a.id,
            a.target,
            $<HTMLTextAreaElement>("#live-reason").value,
          );
          reader.finish();
          close();
          renderStory();
          if (sound) void audio.play().catch(() => {});
          save();
          toast("정책을 시작했어요. 도시의 변화를 계속 살펴봐요.");
        } catch (err) {
          toast((err as Error).message);
        }
      }
      break;
    case "capture-observation":
      sim.observe();
      save();
      toast("현재 수치를 조사 기록에 담았어요.");
      if (panel === "notebook") notebook();
      break;
    case "export-loading":
    case "export-city": {
      const url = URL.createObjectURL(
        new Blob(
          [
            b.id === "export-loading"
              ? loadingText
              : JSON.stringify(sim.save(), null, 2),
          ],
          {
            type: "application/json",
          },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "새봄동-도시기록.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }
    case "import-city":
      $<HTMLInputElement>("#city-file").click();
      break;
    case "new-city":
      confirmReset();
      break;
    case "confirm-new":
      void resetSavedCity();
      break;
  }
});
document.addEventListener("input", (e) => {
  const input = e.target as HTMLTextAreaElement;
  if (meeting && input.id === "community-reason") meeting.reason = input.value;
  if (meeting && input.id === "community-concern")
    meeting.concern = input.value;
  if (input.dataset.communityReflection !== undefined) {
    const record =
      sim.council.records[Number(input.dataset.communityReflection)];
    if (record) record.reflection = input.value.slice(0, 400);
  }
  if ((e.target as HTMLElement).id === "live-notes")
    sim.notes = (e.target as HTMLTextAreaElement).value;
});
document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "display-quality" && ["normal", "light"].includes(el.value)) {
    displayQuality = el.value as DisplayQuality;
    city.setQuality(displayQuality);
    saveDisplayQuality(displayQuality);
  }
  if (el.id === "policy-topic") {
    topic = el.value as Topic;
    if (studyContext?.topic !== topic) studyContext = undefined;
    policies();
    $("#policy-topic").focus();
  }
  if (["compare-from", "compare-to"].includes(el.id) && comparison) {
    if (el.id === "compare-from") comparison.from = Number(el.value);
    else comparison.to = Number(el.value);
    $("#observation-comparison-result").innerHTML = comparison.result();
  }
  if (el.id === "city-file" && el.files?.[0]) {
    if (el.files[0].size > 1e6) {
      toast("도시 기록 파일이 너무 커요.");
      return;
    }
    void el.files[0].text().then((text) => load(text));
  }
});
document.addEventListener("keydown", (e) => {
  if (inspector.isOpen) return;
  if (resetDraft || resetting) {
    if (e.key === "Escape") cancelReset();
    return;
  }
  if (busy) return;
  if (e.key === "Escape") {
    close();
    return;
  }
  if (
    e.code === "Space" &&
    !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(
      (e.target as HTMLElement).tagName,
    )
  ) {
    e.preventDefault();
    if (!pending && !meeting && !busy) paused = !paused;
  }
});
city.onSelect = (s) => {
  if (busy || rebuilding || meeting || pending || resetDraft || inspector.isOpen) return;
  studyContext = undefined;
  const applied = s.kind === "policy" ? city.appliedPolicy(s.id) : undefined;
  show(
    "selection",
    s.title,
    `<p class="intro">${escape(s.description)}</p>${applied?.policies.map((p) => `<p class="metric-note"><b>${escape(p.title)}</b><br>${escape(p.detail)}</p>`).join("") ?? ""}<button class="primary wide" data-panel-open="policy">이곳의 문제 바꿔 보기</button><button class="secondary wide" data-panel-open="community">주민과 함께 의논하기</button>`,
  );
  if (s.kind === "parking") topic = "parking";
  else if (s.kind === "dumping") topic = "waste";
  else if (s.kind === "water" || s.kind === "river") topic = "water";
  else if (s.kind === "plot" || s.kind === "civic") topic = "access";
  else if (s.kind === "supply") topic = "supply";
};
city.onResidentSelect = () => {
  $("#voice-count").textContent = "주민 이야기";
};
let rebuilding = false,
  lastUI = -1,
  lastFrame = performance.now(),
  stats = sim.stats;
function refreshWorld() {
  rebuilding = true;
  city.setSimulation(sim);
  rebuilding = false;
  revision = sim.revision;
  renderStory();
}
refreshWorld();
city.setResidentMode(true);
setLayer("normal");
function loadingStopped(error?: Error) {
  const stopped = !error || error.name === "AbortError";
  $("#live-state").textContent = stopped
    ? "불러오기를 잠시 멈췄어요"
    : "저장 기록 확인이 필요해요";
  show(
    "loading",
    stopped ? "기존 기록은 그대로 있어요" : "도시를 불러오지 못했어요",
    `<p class="intro">${escape(stopped ? "준비가 되면 다시 불러올 수 있어요." : error!.message)}</p><p class="metric-note">원본을 덮어쓰지 않았어요. 먼저 기록을 파일로 보관할 수도 있어요.</p><div class="live-actions"><button id="retry-load" class="primary">다시 불러오기</button><button id="export-loading">원본 기록 파일 저장</button></div><button id="new-city" class="secondary wide">저장 초기화</button>`,
  );
}
async function load(text: string) {
  const generation = ++loadGeneration;
  loadAbort?.abort();
  loadAbort = new AbortController();
  loadingText = text;
  busy = true;
  const previousPaused = paused;
  paused = true;
  $("#live-state").textContent = "저장한 도시를 불러오는 중";
  show(
    "loading",
    "저장한 도시를 불러와요",
    `<p class="intro">이전 형식의 기록은 처음 한 번 계산해요. 다음부터는 저장한 상태에서 바로 이어 가요.</p><progress id="load-progress" max="100" value="0" aria-label="도시 불러오기 진행률"></progress><p id="load-detail" role="status">저장 상태 확인 중</p><div class="live-actions"><button id="cancel-load">잠시 중단</button><button id="export-loading">원본 기록 파일 저장</button></div><button id="new-city" class="secondary wide">저장 초기화</button>`,
  );
  try {
    const restored = await loadSavedCity(
      JSON.parse(text),
      (p) => {
        if (generation !== loadGeneration) return;
        $("#live-state").textContent =
          `저장한 도시 불러오는 중 ${Math.round(p * 100)}%`;
        $<HTMLProgressElement>("#load-progress").value = Math.round(p * 100);
        $("#load-detail").textContent =
          `${Math.round(p * 100)}% · 기록을 보존하며 불러오고 있어요.`;
      },
      loadAbort.signal,
    );
    if (generation !== loadGeneration) return;
    sim = restored;
    reader.reset();
    studyContext = undefined;
    revision = -1;
    lastUI = -1;
    close();
    busy = false;
    save();
    toast("이어 하던 도시를 불러왔어요.");
  } catch (err) {
    if (generation !== loadGeneration) return;
    loadingStopped(err as Error);
  } finally {
    if (generation !== loadGeneration) return;
    if (!busy) paused = previousPaused;
    lastFrame = performance.now();
  }
}
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!paused && !busy && !document.hidden)
    sim.advance(dt * Number($<HTMLSelectElement>("#speed").value));
  if (revision !== sim.revision) refreshWorld();
  if (!busy && Math.floor(now / 500) !== lastUI) {
    lastUI = Math.floor(now / 500);
    stats = sim.stats;
    $("#clock").textContent = stamp(sim.time);
    inspector.update(sim.time, paused);
    $("#live-budget").textContent = String(sim.budget);
    $("#mobile-budget").textContent = String(sim.budget);
    $("#issue-count").textContent = String(sim.activeIssues.length);
    $("#latest-news").textContent =
      sim.currentStory?.title ?? "동네를 천천히 둘러봐요";
    $("#news-peek").hidden = !sim.currentStory;
    $("#next-grant").textContent =
      `운영 예산 +20까지 ${stamp(300 - (sim.time % 300))}`;
    $("#pause").setAttribute("aria-label", paused ? "계속하기" : "일시정지");
    $("#pause").innerHTML = icon(paused ? "play" : "pause", 18);
    if (!busy)
      $("#live-state").textContent = paused
        ? pending || meeting
          ? meeting
            ? "주민 회의 중 · 도시가 잠시 멈췄어요"
            : "정책 위치를 살펴보는 중"
          : "잠시 멈춰 있어요"
        : "도시가 살아가고 있어요";
    renderStory();
    if (panel === "observe") renderReadings();
    if (panel === "news") renderNews();
    if (panel === "policy")
      updatePolicyAvailability($("#live-panel-body"), sim);
    const communityProgress = document.querySelector("#community-status");
    if (communityProgress) communityProgress.textContent = communityStatus(sim);
    if (panel === "community")
      document
        .querySelectorAll<HTMLButtonElement>("[data-community-project]")
        .forEach((button) => (button.disabled = Boolean(sim.council.current)));
    if (!busy && sim.time - lastSaveTime >= 30) save();
  }
  if (!document.hidden && renderClock.due(now, busy ? "light" : displayQuality))
    city.render(sim, layer === "traffic", stats.roads, paused || busy);
  requestAnimationFrame(frame);
}
window.addEventListener("pagehide", () => {
  if (!busy) save();
});
requestAnimationFrame(frame);
try {
  const previous = localStorage.getItem(SAVE_KEY);
  if (previous) void load(previous);
} catch {
  toast("자동 저장을 사용할 수 없어요. 조사 기록에서 파일로 저장할 수 있어요.");
}
// Read-only diagnostics for browser regression checks.
if (import.meta.env.DEV)
  Object.defineProperty(window, "__liveCity", {
    get: () => ({
      time: sim.time,
      budget: sim.budget,
      actions: sim.actions,
      values: sim.values,
      news: sim.news,
      parcels: sim.parcels,
      council: sim.council.records,
      vehicles: sim.vehicles.size,
      paused,
      busy,
    }),
  });
