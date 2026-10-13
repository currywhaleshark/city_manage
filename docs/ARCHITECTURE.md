# 구조 및 오픈소스 활용

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
5. 관찰 종료 시 정지하고 비교 창을 연다. 목적·방향별 영향과 같은 차량 비교는 펼칠 때만 나타난다. JSON 기록은 실제 전후 통계, 완료 이동, 전체 수요표, 시드, 정책, 예산, 학생 생각과 상세 분석을 담는다. 기록 버전은 `schemaVersion: 3`, 모델 버전은 `pedestrians-v4`이다. 버전 상수는 `simulation.ts`에서 UI 기록과 검증 보고서에 공유한다. `laneChangesBefore/After`에는 변경 시각·차량·차로·이유·계산 이득을 저장한다.
6. 다음 실험도 초기 예산 100과 동일 수요로 시작한다. 예산은 실험 간 누적 차감하지 않는다.
7. 동네 소식에서 아침(시드 2404·2405·2406)과 관찰 시간(180·420·600초)을 바꾸면 이전 기준 실행·결과·생각을 지우고 새 수요를 만든다. 변경은 선택 후 새 관찰 버튼을 눌렀을 때 적용한다.

엔진은 동일한 시뮬레이션 시간에 같은 결과를 낸다. 화면 렌더링이 지연되면 벽시계 진행이 느려질 수 있지만, 결과 계산은 렌더 프레임 수에 의존하지 않는다. 탭을 숨겼다가 돌아오면 비활성 시간 전체를 한꺼번에 따라잡지 않는다.

## 렌더링과 성능

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

Vite 8로 갱신해 원본 개발 의존성의 알려진 취약점을 제거했다. Node 22.12 이상이 필요하다. 서버는 개발·정적 제공에만 사용하고, 게임용 백엔드·계정·외부 API는 사용하지 않는다. 인터넷 연결 없이 설치된 의존성으로 빌드하고 로컬 정적 서버에서 실행할 수 있다.

HTML의 로딩 안내와 CSS를 먼저 표시하고 `bootstrap.ts`가 게임 모듈을 불러온다. 게임 모듈에 실패하면 재시도 버튼을 제공한다. Three.js는 [Vite의 Rolldown 분할 설정](https://vite.dev/guide/build.html#chunking-strategy)으로 별도 청크에 둔다. 현재 초기 JS 2.78 kB, 게임 코드 79.34 kB, Three.js 493.09 kB이며 총 약 575.2 kB이다. 라이브러리 청크를 별도 캐시할 수 있고 500 kB 단일 청크 경고가 없다. 게임을 실행하려면 세 청크가 모두 필요하다.

`tests/fixtures/performance.html`은 개발 서버에서 같은 렌더러·엔진을 사용하는 별도 측정 화면이다. 배포 빌드에는 포함하지 않는다. `npm run verify:production`은 실제 dist를 별도 포트 5176에서 열어 로딩·실패 복구·품질 설정·실험 기록을 검사하고 종료한다.

보행자는 차량과 별도 수요표를 사용한다. main은 같은 pedestrianDemand 객체를 전후 엔진에 전달하고, 비교 함수는 보행 ID·출발 시각·경로·속도·색도 검증한다. 엔진은 차량 예약 해제 → 보행 이동과 횡단 점유 → 차량 이동·새 예약 순으로 계산한다. 횡단 중에는 해당 노드의 새 차량 예약을 차단하며, 기존 차량 예약이 남아 있으면 보행 진입을 막는다. JSON은 pedestrianDemand, pedestriansBefore/After, completedPedestriansBefore/After를 추가하고 기존 차량 지표는 그대로 유지한다.
