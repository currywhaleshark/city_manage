import { POLICIES } from "../policies";
import { icon } from "./icons";
import { mapTools } from "./map-layers";

const close = (label: string) =>
  `<button class="square close-panel" data-close-panel aria-label="${label} 닫기">${icon("close", 18)}</button>`;
const tool = (name: string, label: string, glyph: string) =>
  `<button class="tool" data-open-panel="${name}" aria-expanded="false" aria-controls="panel-${name}"><span class="tool-icon">${icon(glyph, 25)}</span><span>${label}</span></button>`;

export const layout = `
  <main class="workspace">
    <section class="city-view" aria-label="조작 가능한 3D 도시">
      <canvas id="city-canvas" tabindex="0" aria-label="도시 지도. 왼쪽 드래그 회전, 오른쪽 드래그 이동, 휠 확대·축소"></canvas>
      <div id="map-labels" aria-hidden="true"></div>
    </section>
    <header class="topbar">
      <div class="brand"><span class="brand-mark">${icon("city", 24)}</span><div><h1>우리 동네 시장님</h1><span>새봄동 · 첫 번째 도시 이야기</span></div></div>
      <div class="header-end"><span class="mode-badge"><i class="live-dot"></i><span id="mode-label">정책 시행 전 · 관찰 중</span></span><button id="sound" class="square" aria-label="효과음 켜기" title="효과음 켜기" aria-pressed="false">${icon("sound", 18)}</button><button id="help" class="square" aria-label="조작 방법" title="조작 방법">${icon("help")}</button></div>
    </header>
    <button class="mission-peek" data-open-panel="mission" aria-expanded="false" aria-controls="panel-mission"><span class="mission-number">01</span><span><small>오늘의 도시 문제</small><strong>막히는 등굣길</strong></span>${icon("arrow", 17)}</button>
    ${mapTools}
    <div class="compass"><span>북</span><svg width="25" height="35" viewBox="0 0 25 35" aria-hidden="true"><path d="M12 2 5 24l7-5 7 5Z" fill="#384e48"/><path d="m12 19 7 5-7 7-7-7Z" fill="#97aaa1"/></svg></div>
    <div class="map-controls"><button id="zoom-in" aria-label="지도 확대">${icon("plus")}</button><button id="zoom-out" aria-label="지도 축소">${icon("minus")}</button><button id="camera-reset" aria-label="전체 도시 보기" title="전체 도시 보기">${icon("home")}</button></div>
    <div class="map-hint">드래그로 회전 <span>·</span> 오른쪽 드래그로 이동 <span>·</span> 휠로 확대</div>

    <section id="panel-mission" class="floating-panel mission-panel" data-panel="mission" role="region" aria-labelledby="mission-title" hidden>
      <div class="panel-heading"><div><span class="eyebrow">동네 소식 · 01</span><h2 id="mission-title" data-panel-heading tabindex="-1">막히는 등굣길</h2></div>${close("동네 소식")}</div>
      <div class="panel-body"><p class="intro">아침마다 학교 앞에 차가 길게 늘어서요.<br>시장님, 우리 동네의 길을 바꿔 볼까요?</p>
      <blockquote class="resident"><span>${icon("home", 22)}</span><div><small>새봄동 주민의 부탁</small><p>“학교에 늦지 않게, 등굣길이 조금 더 편해지면 좋겠어요.”</p></div></blockquote>
      <button id="choose-scenario" class="secondary wide">다른 도시 문제 살펴보기</button><div class="steps" aria-label="활동 단계"><span id="step-observe" class="active"><b>1</b> 관찰</span><i></i><span id="step-trial"><b>2</b> 정책</span><i></i><span id="step-done"><b>3</b> 비교</span></div>
      <button id="focus-school" class="primary wide">${icon("eye", 18)} 학교 앞 교차로 살펴보기 ${icon("arrow", 17)}</button>
      <details class="experiment-settings"><summary>관찰 조건 바꾸기</summary><p>다른 아침에도 정책이 도움이 될까요? 조건을 바꾸면 새 관찰이 시작돼요.</p><label for="experiment-seed">차량 출발 조건<select id="experiment-seed"><option value="2404">첫 번째 아침</option><option value="2405">두 번째 아침</option><option value="2406">세 번째 아침</option></select></label><label for="experiment-duration">관찰 시간<select id="experiment-duration"><option value="180">3분</option><option value="420" selected>7분</option><option value="600">10분</option></select></label><button id="new-experiment" class="secondary wide">이 조건으로 새로 관찰</button></details><div class="record-tools"><button id="open-record" class="secondary">저장한 기록 열기</button></div></div>
    </section>

    <section id="panel-policy" class="floating-panel policy-panel" data-panel="policy" role="region" aria-labelledby="policy-title" hidden>
      <div class="panel-heading"><div><span class="eyebrow">도시 도구</span><h2 id="policy-title" data-panel-heading tabindex="-1">등굣길을 바꾸는 방법</h2></div>${close("정책")}</div>
      <div class="panel-body"><div class="section-line"><p class="muted">시도할 정책을 골라 보세요.</p><span>여러 개 선택 가능</span></div>
      <div class="policy-list">${POLICIES.map((p) => `<label class="policy-card" data-policy-card="${p.id}"><input type="checkbox" data-policy="${p.id}" aria-label="${p.title}"><span class="policy-icon">${icon(p.id, 30)}</span><strong>${p.title}</strong><span class="policy-cost">${icon("coin", 14)} ${p.cost}</span><span class="checkmark" aria-hidden="true">✓</span></label>`).join("")}</div>
      <div class="policy-detail"><span id="policy-target" class="eyebrow"></span><p id="policy-description"></p><p id="policy-tradeoff" class="tradeoff"></p><div id="signal-setting" class="signal-setting" hidden><label for="green">동서 방향 초록불 <strong id="green-value">26초</strong></label><input id="green" type="range" min="12" max="38" value="26" step="2"><span>남북 방향은 10초로 바뀌어요.</span></div></div>
      <label class="decision-reason" for="decision-reason">선택한 까닭 <small>적고 싶을 때만 적어요</small><textarea id="decision-reason" rows="2" maxlength="400" placeholder="어떤 자료나 주민 의견을 참고했나요?"></textarea></label></div><div class="panel-footer"><div class="budget"><span>남은 예산</span><strong>${icon("coin", 17)} <b id="budget">100</b><small> / 100</small></strong></div><button id="apply" class="primary" disabled>선택한 정책 시행하기 ${icon("arrow", 17)}</button></div>
      <p class="fair-note">자동차 140대 · 보행자 60명 · 같은 출발 조건 · <span data-observation-minutes>7</span>분 동안 비교해요.</p>
    </section>

    <section id="panel-traffic" class="floating-panel traffic-panel" data-panel="traffic" role="region" aria-labelledby="traffic-title" hidden>
      <div class="panel-heading"><div><span class="eyebrow">실시간 관찰</span><h2 id="traffic-title" data-panel-heading tabindex="-1">우리 동네 교통</h2></div>${close("교통 현황")}</div>
      <div class="panel-body"><label class="layer-picker" for="map-layer">지도 자료<select id="map-layer"></select></label><p id="map-layer-note" class="metric-note"></p><div id="waste-observation" hidden></div><div id="traffic-observation"><div id="traffic-status" class="traffic-status"><i class="status-dot"></i><div><strong>차들이 출발하고 있어요</strong><span>도로 위 자동차를 관찰해 보세요.</span></div></div>
      <div class="big-metric"><span>목적지에 도착한 차</span><strong><b id="arrived">0</b><small> / 140대</small></strong><div class="arrival-track"><i id="arrival-bar"></i></div></div>
      <div class="metric-grid"><div><span>평균 이동시간</span><strong id="travel">집계 중</strong></div><div><span>평균 대기시간</span><strong id="wait">집계 중</strong></div><div><span>길 위의 차</span><strong id="active">0대</strong></div><div><span>정차 중인 차</span><strong id="stopped">0대</strong></div></div>
      <p class="metric-note">이동·대기 평균은 도착한 차 기준이에요.<br><span id="queue-note">출발을 준비하고 있어요.</span></p>
      <details class="traffic-details pedestrian-observation" name="traffic-observation"><summary>걸어가는 사람들 ${icon("plus", 17)}</summary><p id="pedestrian-status" class="metric-note"></p><p id="pedestrian-wait" class="metric-note"></p><p id="pedestrian-average" class="metric-note"></p></details><details class="traffic-details vehicle-history" name="traffic-observation"><summary>시간별 변화와 막히는 길 ${icon("chart", 17)}</summary><section class="chart-section"><div class="section-line"><h3>멈춰 있는 차의 변화</h3><span>대</span></div><svg id="traffic-chart" viewBox="0 0 240 95" role="img" aria-label="시간에 따른 정차 차량 수"><path d="M0 20H240M0 50H240M0 80H240" stroke="#3c4a54" fill="none"/><polyline id="chart-line" points="0,80" fill="none" stroke="#f0bc71" stroke-width="2.5" stroke-linejoin="round"/></svg><div class="chart-axis"><span>08:00</span><span data-observation-end>08:07</span></div></section><section class="roads-section"><h3>어디가 막히나요?</h3><div id="road-list"></div></section></details></div></div>
    </section>

    <section id="panel-residents" class="floating-panel" data-panel="residents" role="region" aria-labelledby="residents-title" hidden><div class="resident-guide"><div><h2 id="residents-title" data-panel-heading tabindex="-1">우리 동네 목소리</h2><p>지도 위 말풍선을 눌러 들어 봐요.</p></div>${close("주민 의견")}</div><nav class="resident-navigation" aria-label="주민 의견 차례로 듣기"><button id="resident-previous" aria-label="이전 주민 의견">${icon("arrow", 16)}</button><span id="resident-count" aria-live="polite"></span><button id="resident-next" aria-label="다음 주민 의견">${icon("arrow", 16)}</button><small>가상 주민의 이야기</small></nav></section>
    <section id="panel-selection" class="floating-panel selection-panel" data-panel="selection" role="region" aria-labelledby="selection-title" hidden><div class="panel-heading"><div><span class="eyebrow">선택한 장소</span><h2 id="selection-title" data-panel-heading tabindex="-1">학교 앞 교차로</h2></div>${close("장소 정보")}</div><div class="panel-body"><p id="selection-description"></p><div id="selection-detail"></div><button class="secondary wide" data-open-panel="policy" aria-controls="panel-policy" aria-expanded="false">정책으로 바꿔 보기 ${icon("arrow", 17)}</button></div></section>
  </main>
  <footer class="command-deck">
    <div class="toolbelt"><div class="town-badge"><span>${icon("city", 30)}</span><div><strong>새봄동</strong><small>함께 살기 좋은 우리 동네</small></div></div><nav class="tools" aria-label="도시 관리 도구">${tool("mission", "동네 소식", "home")}${tool("residents", "주민 의견", "residents")}${tool("policy", "정책 만들기", "bypass")}${tool("traffic", "교통 현황", "car")}<button id="show-results" class="tool" disabled title="정책 실험을 마치면 결과를 비교할 수 있어요."><span class="tool-icon">${icon("chart", 25)}</span><span>결과 비교</span><i class="notification-dot" hidden></i></button></nav><div class="compact-metrics"><div title="선택한 정책을 시행하고 남는 예산">${icon("coin", 20)}<span><small>남은 예산</small><strong id="hud-budget">100</strong></span></div><div title="목적지에 도착한 차량 수">${icon("car", 20)}<span><small>도착한 차</small><strong><b id="hud-arrived">0</b><em> / 140</em></strong></span></div></div></div>
    <div class="statusbar"><div class="time-controls"><button id="pause" class="square" aria-label="일시정지" title="일시정지 (스페이스)">${icon("pause", 18)}</button><span id="clock">08:00:00</span><select id="speed" aria-label="시뮬레이션 속도"><option value="1">1배속</option><option value="2" selected>2배속</option><option value="4">4배속</option><option value="8">8배속</option></select><button id="finish" class="finish-button" title="7분 관찰을 끝까지 빠르게 보기">끝까지 ${icon("arrow", 15)}</button><button id="next-policy" class="finish-button" data-open-panel="policy" aria-expanded="false" aria-controls="panel-policy" hidden>정책 고르기 ${icon("arrow", 15)}</button></div><p id="footer-status">학교 앞 교차로를 눌러 살펴보세요.</p><div class="timeline-group"><span id="elapsed">0:00 / 7:00</span><div class="timeline"><i id="progress"></i></div></div><button id="reset" class="square" aria-label="처음부터" title="처음부터">${icon("reset", 17)}</button></div>
  </footer>
  <div id="toast" role="status" aria-live="polite"></div>
`;
