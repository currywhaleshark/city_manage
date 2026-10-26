# 구조 및 오픈소스 활용

## 통합 도시 성능과 빠른 복원 (2026-10-15)

`simulation/checkpoint.ts`는 현재 모델의 데이터만 구조화 복제하고, 복원 시 새 클래스 인스턴스에 되돌린다. 교통·차로 예약·정책 피드백의 공유 참조를 한 번의 복제로 보존하고, 네트워크·시설의 파생 상태와 콜백은 재구성한다. 내부 버전은 `living-state-3`이며 상태 구조나 의미가 달라지면 반드시 올린다. v1 캐시는 순차 문제 발견·이야기 발표 필드를 초기화한다. v1/v2의 교통 전환 필드가 없는 상태에는 이전 수요를 뜻하는 Infinity를 채우고 기록과의 일치를 검증한 뒤 다음 주기의 도시 전체 수요를 예약한다. 이 이행에는 도시 전체 재계산이 필요하지 않다. 캐시 일치 판정은 시드·시간·명령 접두부·교통 전환 시점을 검사하며 주민의 성찰·메모 수정은 최신 기록에서 읽는다.

`simulation/city-demand.ts`는 통합 도시만의 지구별 수요를 생성한다. 별도 학교 실험은 `scenario.createDemand`를 유지한다. JSON의 선택적 `cityTrafficFrom`은 새 도시에서는 0이고 이전 저장을 불러오면 다음 300초 경계다. 복원 경로는 모두 `prepareLiveSave`로 같은 전환을 정규화하며, 전환 전에는 이전 수요로 재생하고 이후 주기부터 새 수요를 사용한다. 상태 캐시는 전환 시점이 같은 기록 또는 전환 전의 이전 캐시에만 재사용한다. 하루 주기에서는 `simulation/day-clock.ts`가 경과 시간과 `dailyCycleFrom`으로 시각을 계산하고, `createHourlyDemand`가 매시 정각의 출발을 만든다. 전환 전 기록은 5분 주기로 재생한다([DAILY_CYCLE.md](DAILY_CYCLE.md)).

`storage/live-checkpoint.ts`는 IndexedDB 캐시의 읽기와 순차 쓰기, `storage/load-city.ts`는 직접 복원/남은 구간 계산/전체 명령 재생을 선택한다. `simulation/live-worker.ts`가 오래된 기록의 계산을 맡고 Worker를 쓸 수 없으면 메인 스레드에서 짧게 나누어 처리한다. JSON 명령 기록은 계속 localStorage에 먼저 저장한다. 중단·복원 오류 시 새 도시 자동 저장을 막아 원본을 보존한다.

교통 엔진은 계산 단계마다 차로별 차량 목록을 한 번 만들고 변경된 차로만 다시 찾는다. 같은 단계에서 진입 불가능한 입구의 대기 수요를 중복 검사하지 않는다. 수요·물량·정책 규칙은 변경하지 않는다. 통합 화면도 기존 `RenderClock`을 사용해 보통 60/가볍게 30회 상한으로 그린다. 숨겨진 지도 이름표 계산을 생략하고, 정지한 카메라의 HTML 배치는 초당 10회로 제한한다. 카메라 이동은 매 그리기 때 반영한다.

## 주민 회의와 참여 (2026-10-14)

`simulation/community.ts`의 `ResidentsCouncil`이 서로 다른 입장, 참여 방법, 준비·실천 기간, 기여량과 종료 시점 측정을 관리한다. 별도 도시나 교통 시계는 만들지 않는다. `live.ts`가 새 주차 수요의 보행 전환과 무단투기 안내를 연결하고, `WaterSimulation`의 생활하수 계수·예방량 콜백이 새 배출만 바꾼다. 단독 시나리오의 기본 콜백은 효과가 없다.

`ui/community.ts`는 순차 의견 듣기, 방법 비교, 진행·결과와 성찰 기록을 만든다. `src/live.ts`가 임시 회의 상태와 기존 지도 위치 선택을 연결하며 완료 전에는 도시 예산·상태를 변경하지 않는다. 지도 표식·주민 소식은 기존 렌더러를 재사용한다. 자세한 수치, 역할과 교육용 가정은 [LIVING_CITY.md](LIVING_CITY.md)에 기록한다.

## 통합 도시 (2026-10-14)

기본 진입점은 `live.ts`이며 `bootstrap.ts`가 `?mode=lab`일 때만 기존 `main.ts`를 엽니다. `simulation/live.ts`는 수거·투기 엔진을 바탕으로 주차·물류·하천 서비스를 하나의 교통 상태와 시계에 연결합니다. `TrafficSimulation.transport`를 받은 서비스는 공유 차량·보행자·교차로 예약을 사용하고 자체 교통 단계는 진행하지 않습니다. 공공시설은 정적 접근성 계산을 재사용하며 모든 건설이 공터 장부를 공유합니다. 자세한 운영·저장·원인 연결은 [LIVING_CITY.md](LIVING_CITY.md)를 봅니다.


## 수질오염 확장 (2026-10-14)

`simulation/water.ts`가 동일 교통 조건 위에서 1초 단위 물질 묶음의 이동·유입 전 처리·둔치 청소·차단막·경계 유출을 계산한다. 물에 섞인 오염과 쓰레기의 수지를 따로 보존한다. `renderer/water.ts`는 하천 구간 색·관찰소·유입구·처리 시설·흐르는 쓰레기, `ui/water.ts`는 사실과 단계별 관찰·결과, `metrics/water.ts`는 동일 조건 비교를 담당한다. 정책 지도와 주민 의견·수첩은 공통 구조를 사용한다. 생활하수 시설도 `city/parcels.ts`의 면적·중복 규칙을 사용한다. 수질 기록은 v7이며 `records/water.ts`가 발생 일정·처리량·물질 수지·위치·회차를 검증한다. [규칙과 생략한 범위](WATER.md)

## 무단투기 확장 (2026-10-14)

`simulation/services/dumping.ts`가 `WasteSimulation`을 확장한다. 기존 수거장·실제 수거차는 공유하고 추가 투기/배출함 지점·방문 순서·배출 수요와 목적지를 따로 관리한다. `renderer/dumping.ts`는 봉투와 현장 이름표, `ui/dumping.ts`는 관찰·결과, `metrics/dumping.ts`는 동일 조건 비교를 맡는다. 공통 수첩과 지도 정책 선택을 재사용한다. 새 기록만 v6로 저장하며 `records/dumping.ts`에서 수량·수요·위치·회차를 검증한다. 이전 기록 읽기는 유지한다. [규칙](DUMPING.md)

## 공통 조사와 불법주차 추가 (2026-10-14)

`inquiry.ts`가 원인 가설, 시점·장소·실험 회차가 붙은 사실/의견 스냅샷, 시행 순간의 선택 근거와 수정 제안을 보존한다. `ui/inquiry.ts`는 기존 단일 패널 방식을 재사용해 여섯 단계를 하나씩 표시한다. `ParkingSimulation`은 기존 차로 점유·서비스 차량 출구 주행과 보행자의 우회 경로를 결합한다. 시설과 주차장은 `city/parcels.ts`의 동일한 부지 중복·면적 규칙을 사용한다. 개별 시나리오의 건설 상태는 서로 누적되지 않는다.

불법주차까지의 기록은 schemaVersion 5이며 v3·v4를 계속 읽는다. 주차 모델은 `parking-v1`이다. 구현 규칙과 단순화는 [PARKING.md](PARKING.md)에 정리했다. 아래는 이전 단계의 구조 설명이다.

정책 위치 선택은 `renderer/placement.ts`의 임시 지도 계층을 사용한다. `main.ts`가 정책별 후보와 현재 계획 위치를 전달하고, 선택 완료 시에만 계획을 갱신한다. 지도 이름표와 Three.js 지면 클릭이 같은 선택 콜백을 사용한다. 이름표는 다른 이름표·강조한 땅·지도 조작 버튼을 피한다. 취소 시 카메라와 재생 상태를 복구하고 geometry·material·DOM을 해제한다. 현재 시행의 엔진과 `renderer/policies.ts` 표시 자료는 정책 시행 전까지 수정하지 않는다.

## Phase 4 물류·교류 확장 (2026-10-14)

`simulation/economy/`는 공장·외부 입구·상점·화물 임무를 관리하고 기존 `dispatchService`로 실제 차량을 운행한다. `Vehicle`/`Trip`과 공유 교통 엔진을 수정하지 않았다. 물량과 출처를 별도 상태로 보존하며 도착 후 정차 상태에서만 상하차한다. 비교·표현은 `metrics/logistics.ts`, `renderer/logistics.ts`, `ui/logistics.ts`에 분리했다. 상점 건물 색은 기존 `BuildingColors`, 정책·주민 위치는 공통 지도 계층을 재사용한다. [모형·정책·기록 규칙](LOGISTICS.md)을 참고한다.

## Phase 3 개발·환경 확장 (2026-10-14)

`simulation/environment/`는 개발 면적에서 추가 차량을 만들고 같은 `TrafficSimulation`에서 실행한 뒤 1초마다 상태를 관측한다. 기존 교통/보행 엔진 계산은 바꾸지 않았다. `metrics/environment.ts`는 기존 수요의 동일성을 검증하면서 정책으로 생성된 수요의 차이를 허용하고, 기존·추가 차량 결과를 나눈다. 전체 수요가 같은 경우만 다루는 교통 비교 함수를 느슨하게 만들지 않았다.

`renderer/environment.ts`, `ui/environment.ts`가 개발 부지·잔여 녹지·완충 띠와 현재 환경 레이어, 관찰 중 평균 결과를 제공한다. 환경 지표는 거리와 실제 도로 위 차량의 가상 함수로, 실제 환경영향평가를 주장하지 않는다. 현재 조건·규칙·새 v4 필드는 [ENVIRONMENT](ENVIRONMENT.md)에 정리했다.

## Phase 2 공공시설 확장 (2026-10-14)

`simulation/facilities/`에 경로 거리와 횡단 대기로 예상 접근성을 계산하는 보행망, 독립된 주민 수요, 시설 정원 배정을 분리했다. `metrics/facilities.ts`가 같은 주민 조건의 비교를, `renderer/facilities.ts`와 `ui/facilities.ts`가 부지·시설·경로·지역 결과를 맡는다. 상세 모듈과 규칙은 [FACILITIES](FACILITIES.md)를 기준으로 한다.

공통 시나리오에 `clock: planning`을 추가했다. 이 시나리오는 빈 교통 상태로 도시를 그리고 시간 진행 없이 계획 1회를 비교한다. 주민 680명의 예상 이용 가능 수를 기존 60명 보행 애니메이션의 실제 도착 수와 혼동하지 않는다. v4 기록에 `timeUnit: planning-round`, `round: 1`, `facilityPlan`, `facilitiesBefore/After`를 추가했다. 교통·수거 기록은 종전 관찰 초 단위를 유지한다.

## Phase 0·1 확장 (2026-10-14)

`scenarios/` 등록과 `policies/definition.ts` 정책 정의, `city/data.ts` 시설 데이터, `metrics/scenarios.ts` 공통 비교 형식을 추가했다. 서비스 차량은 전용 임무 상태를 두고 기존 도로 이동·신호·예약·충돌을 공유한다. 16블록·기존 차량/보행 결과를 보존했다. [모듈별 역할과 모델 규칙](EXPANSION.md)에 현재 확장 구조를 정리했다.

## 출발점과 분석

빈 작업 폴더에 [Mini Traffic City Simulator](https://github.com/Sudoyan118/mini-traffic-city-sim)를 실제로 복제했다. 기준 커밋은 `28db07c3293c2bd49bab6c3d810fb4c6a64cdb87`이다. 원본의 Git 이력과 MIT `LICENSE`를 보존했다. 변경은 `codex/traffic-mvp` 브랜치에 있다.

먼저 원본 `src/types.ts`, `src/simulation.ts`, `src/main.ts`와 [Traffic Microsim](https://github.com/SaintPepsi/traffic-microsim)의 `index.html`을 분석했다.

| 부분        | 원본 동작과 판단                                  | 이번 변경                                                                                                      |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 기술 기반   | TypeScript + Three.js + Vite, 정적 앱             | 유지. 추가 UI 프레임워크 없음                                                                                  |
| 도로 그래프 | 교차로 노드와 도로 간선, 방향 속성                | 개념과 타입 이름을 유지하고 명시적 방향별 차로로 확장                                                          |
| 차량 경로   | 무작위로 정렬한 BFS                               | 시간 비용 Dijkstra, 목적 있는 OD 수요, 경로 캐시                                                               |
| 주행        | 정지/출발 목표속도, 차량별 진행 순서              | IDM 가감속, 동시 상태 관측, 차간 간격 제한                                                                     |
| 신호        | 남북/동서 초록·노랑                               | 전적색, 이동 경로 충돌 표와 출구 예약, 비상충 동시 통과                                                        |
| 수요        | Math.random 및 window.setTimeout 재생성           | 시드 기반 불변 수요표, 시뮬레이션 시간으로 출발                                                                |
| 시간        | 프레임 dt와 속도 배율을 잘라 계산                 | 0.1초 고정 스텝 + 누산기, 표시 위치 보간                                                                       |
| 렌더링      | 박스 도로·건물·차체, 원뿔 나무, 조명, 회전 카메라 | 절차적 로우폴리 구성 방식을 `renderer/city.ts`로 분리·수정. 정적 geometry 병합, 자동차 인스턴싱, OrbitControls |
| 통계        | 최근 80대 표본, 임의 시점 스냅샷 비교             | 전체 완료 이동 누적, 미완료 수요 대기 포함, 동일 조건 처음부터 비교                                            |
| 화면        | 도로 편집 중심 영어 UI                            | 한글 학생용 관찰·정책·비교 흐름                                                                                |
| 배포        | `/mini-traffic-city-sim/` 고정 base               | 상대 경로 `./`; 어느 정적 하위 폴더에 배포해도 동작                                                            |

Traffic Microsim의 `desiredGap`, `idmAccel`, `mobilDecision`의 안전 감속 한계와 가속 이득·예의 계수 계산을 TypeScript로 이식했다. 이 계산의 원 저작권은 **Copyright (c) 2026 Ian Hogers**, MIT이다. 도시 경로별 회전 허용 차로, 교차로 예약과의 배타성, 이동 중 양쪽 차로 점유를 더했다. 화면 보간만으로 차로를 옮기지 않고 엔진의 차체 위치와 방향이 실제로 변한다.

원본 분석 자료와 라이선스:

- `vendor/mini-traffic-city-sim/`: 수정 전 `main.ts`, `simulation.ts`, `types.ts`, `LICENSE`
- `vendor/traffic-microsim/`: 분석한 `index.html`, `LICENSE` 원문
- 루트 `LICENSE`: 기본 프로젝트의 MIT 고지 유지
- 기존 `docs/INITIAL_PROMPT.txt`, `docs/UI_GUIDE.md`, `docs/header.png`, `QA_INVENTORY.md`는 상위 프로젝트의 역사 자료다. 현 MVP의 설명은 README와 이 문서군이 기준이다.

## 모듈 경계

```text
src/
  bootstrap.ts             초기 로딩 안내, 게임 모듈 지연 로드와 실패 복구
  main.ts                  화면 조립, 활동 흐름, 고정 시간 누산기 호출
  types.ts                 렌더러와 독립적인 데이터 타입
  scenario/index.ts        16블록 도시, 시설, 수요표, 설정값
  simulation.ts            순수 TypeScript 차량 엔진과 교차로 예약
  simulation/pedestrians.ts 보행 수요·보도 경로·대기 줄·횡단 점유·통계
  simulation/idm.ts        IDM 계산식
  simulation/network.ts    Dijkstra, 신호 위상, 3차 Bézier 회전 경로
  simulation/junctions.ts  차체 이동 영역과 이동 경로별 충돌 표 캐시
  simulation/lanes.ts      회전 허용·MOBIL 판단·두 차로 점유·연속 이동
  policies/index.ts        정책 비용과 입력 검증
  metrics/index.ts         실제 상태의 통계 집계
  metrics/comparison.ts    동일 조건 검증, 목적·방향·동일 차량 분석
  renderer/city.ts         Three.js, 카메라, 선택, 차량 보간
  renderer/pedestrians.ts   인스턴싱 사람·이동거리 기반 걸음 애니메이션
  renderer/quality.ts      두 화면 품질, 저장, 렌더 간격 판단
  ui/icons.ts              자체 작성 SVG 아이콘
  ui/layout.ts             도시 중심 HUD와 접히는 정보창 구조
  ui/panels.ts             정보창 단일 열기, 닫기와 초점 복원
  ui/comparison.ts         상세 분석의 펼치기와 집단 전환
  styles.css               반응형 한글 화면
```

`simulation`, `scenario`, `policies`, `metrics`에는 Three.js, DOM, 비동기 타이머, `Math.random()`이 없다. `TrafficSimulation.step()`을 Node에서도 그대로 실행한다. 이벤트 기록과 테스트용 상태는 계산 결과를 관측하며 주행을 바꾸지 않는다.

출구 예약은 차로별 차량 ID 집합이다. 동일 이동의 여러 차량이 공간을 각각 확보하고 진출할 때 자기 항목만 해제한다. 접근·곡선·출구를 연속 좌표로 연결해 앞차를 찾고, 곡선 차량의 다음 상태를 일괄 계산한 뒤 반영한다. 예약 요청은 각 차로의 앞뒤 순서를 지켜 정렬한다. `tests/queue-fixture.ts`의 실제 정차 행렬로 용량과 출구 막힘을 재현한다.

## 게임 흐름

1. 기본 도시를 실행하며 관찰한다. 관찰을 끝까지 빠르게 진행할 수 있다.
2. 선택한 정책과 비용을 계획한다. 아직 도시에는 반영되지 않는다.
3. 시행 버튼을 누르면 선택한 관찰 시간의 기본 도시 결과를 확보하고, 같은 불변 수요 객체로 새 엔진을 만든다.
4. 새로운 도로망과 신호가 3D 화면에 반영되어 0초부터 주행한다.
5. 관찰 종료 시 정지하고 비교 창을 연다. 목적·방향별 영향과 같은 차량 비교는 펼칠 때만 나타난다. JSON 기록은 실제 전후 통계, 완료 이동, 전체 수요표, 시드, 정책, 예산, 학생 생각과 상세 분석을 담는다. 기록 버전은 `schemaVersion: 5`, 교통 모델 버전은 `city-traffic-v5`이다. 버전 상수는 `simulation.ts`에서 UI 기록과 검증 보고서에 공유한다. `laneChangesBefore/After`에는 변경 시각·차량·차로·이유·계산 이득을 저장한다.
6. 다음 실험도 초기 예산 100과 동일 수요로 시작한다. 예산은 실험 간 누적 차감하지 않는다.
7. 동네 소식에서 아침(시드 2404·2405·2406)과 관찰 시간(180·420·600초)을 바꾸면 이전 기준 실행·결과·생각을 지우고 새 수요를 만든다. 변경은 선택 후 새 관찰 버튼을 눌렀을 때 적용한다.

엔진은 동일한 시뮬레이션 시간에 같은 결과를 낸다. 화면 렌더링이 지연되면 벽시계 진행이 느려질 수 있지만, 결과 계산은 렌더 프레임 수에 의존하지 않는다. 탭을 숨겼다가 돌아오면 비활성 시간 전체를 한꺼번에 따라잡지 않는다.

## 렌더링과 성능

- `policies/map.ts`는 실행 중인 엔진에서 적용 정책과 실제 도로·시설·부지 좌표를 읽는 표시 전용 계층이다. 입력 폼의 선택 상태나 다음 건설 예정 부지를 읽지 않는다. 전역 수거 운영과 개발 공통 규칙, 지역 적용 구역을 구분한다. `renderer/policies.ts`는 이 자료로 DOM 표식·연결선·구역 테두리를 만들고 재시행 시 이전 DOM과 구역 geometry를 해제한다. 주민 말풍선이 열리면 정책 표식을 작게 줄여 함께 표시한다.
- `ui/map-layers.ts`는 시나리오별 왼쪽 지도 도구·범례를 정의하며 기존 선택창과 같은 상태를 쓴다. `renderer/map-data.ts`는 고정 쓰레기 색상 척도와 도보 시간 구간을 공유한다. `renderer/building-colors.ts`는 벽·지붕을 하나의 vertex-color mesh로 합쳐 건물 ID별 범위만 갱신하고 일반 보기에서 원래 색을 복원한다. 창문·나무 등은 기존 정적 mesh를 유지한다.
- `renderer/facility-coverage.ts`는 실행 중 시설에서 실제 보행 그래프의 최단 시간을 읽어 300초 내 도달하는 길을 자른다. 횡단 대기 15초와 걷기 속도 1.2m/s를 기존 모델과 동일하게 반영한다. 여러 시설의 범위는 2m 격자에서 합쳐 투명 띠가 겹쳐 진해지지 않게 그린다. 시설·종류가 바뀔 때만 재계산하며 정원은 보행 범위와 분리한다. 도로 밖 임의 원형 반경을 접근 가능 지역으로 간주하지 않는다.
- 건물·나무·창문은 색상별 geometry를 합친다. 도로 장식도 병합한다.
- 차량은 차체·캐빈·후미등의 3개 `InstancedMesh`로 표현한다. 메시를 매 프레임 새로 만들지 않는다.
- 현재 인스턴스 용량은 1,500대다. 기본 수요 140대, 스트레스 수요 300대이다. 과밀 수요는 출발지에서 기다리며 삭제되지 않는다.
- 보통: DPR 상한 1.5, 그림자 맵 2048, 최대 60FPS. 가볍게: DPR 상한 1, 그림자 없음, 최대 30FPS. HTML 글자와 UI의 해상도는 유지한다.
- 품질 변경은 같은 WebGL 컨텍스트에서 적용하고 그림자 맵을 해제/복원한다. 설정은 localStorage에 저장하며 저장이 거부되어도 현재 선택은 적용한다.
- 화면 프레임 제한은 `city.render`에만 적용한다. `RenderClock`은 다음 그리기 시각을 누적해 60/120/144Hz의 소수 간격을 유지하고, 오래 숨긴 뒤에는 밀린 그리기를 버린다. 고정 0.1초 엔진 계산은 그대로 진행한다. 숨겨진 교통 상세 표·그래프의 DOM 재생성은 생략하고 차량 색상 객체를 재사용한다.
- 카메라는 왼쪽 회전·오른쪽 이동·휠 줌. 좌표에 맞춘 시설 라벨, 선택 링, 클릭 정보 제공.
- 개별 정책 시행 시 geometry와 전용 material을 정리한다. 신호 색은 기존 material을 갱신한다.

## 오디오

Audio Production / Agent Audio로 만든 `public/audio/policy-confirm.wav`를 정책 시행 클릭에 연결했다. 기본 음소거이며 사용자가 켰을 때만 볼륨 0.28로 재생한다. 3초, 44,100Hz, 16-bit 스테레오 WAV. 생성 음성·배경음악은 없도록 요청했다. 수치 검사에서는 무음/클리핑/비정상 샘플이 없었다. 직접 청취에 의한 음질 평가는 하지 않았다.

## 배포와 유지관리

Vite 8로 갱신해 원본 개발 의존성의 알려진 취약점을 제거했다. Vite 자체는 Node 22.12 이상을 요구하며, 현재 프로젝트의 DOM 회귀 검사를 포함한 개발 환경은 22.15 이상인 22.x 또는 24 이상이다. 서버는 개발·정적 제공에만 사용하고, 게임용 백엔드·계정·외부 API는 사용하지 않는다. 인터넷 연결 없이 설치된 의존성으로 빌드하고 로컬 정적 서버에서 실행할 수 있다.

HTML의 로딩 안내와 CSS를 먼저 표시하고 `bootstrap.ts`가 게임 모듈을 불러온다. 게임 모듈에 실패하면 재시도 버튼을 제공한다. Three.js는 [Vite의 Rolldown 분할 설정](https://vite.dev/guide/build.html#chunking-strategy)으로 별도 청크에 둔다. 현재 초기 JS 2.78 kB, 게임 코드 약 232 kB, Three.js 497.20 kB이며 총 약 732 kB이다. 라이브러리 청크를 별도 캐시할 수 있고 500 kB 단일 청크 경고가 없다. 게임을 실행하려면 세 청크가 모두 필요하다.

`tests/fixtures/performance.html`은 개발 서버에서 같은 렌더러·엔진을 사용하는 별도 측정 화면이다. 배포 빌드에는 포함하지 않는다. `npm run verify:production`은 실제 dist를 별도 포트 5176에서 열어 로딩·실패 복구·품질 설정·실험 기록을 검사하고 종료한다.

보행자는 차량과 별도 수요표를 사용한다. main은 같은 pedestrianDemand 객체를 전후 엔진에 전달하고, 비교 함수는 보행 ID·출발 시각·경로·속도·색도 검증한다. 엔진은 차량 예약 해제 → 보행 이동과 횡단 점유 → 차량 이동·새 예약 순으로 계산한다. 횡단 중에는 해당 노드의 새 차량 예약을 차단하며, 기존 차량 예약이 남아 있으면 보행 진입을 막는다. JSON은 pedestrianDemand, pedestriansBefore/After, completedPedestriansBefore/After를 추가하고 기존 차량 지표는 그대로 유지한다.
