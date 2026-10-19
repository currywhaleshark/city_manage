import test from "node:test";
import assert from "node:assert/strict";
import { LiveCitySimulation } from "../src/simulation/live";
import {
  communityProject,
  type CommunityProjectId,
} from "../src/simulation/community";
import { SCHOOL_NODE } from "../src/scenario";
import { storyVoice } from "../src/ui/live-study";
import { WATER_CELL_LENGTH } from "../src/simulation/water";
import { WORLD } from "../src/city/world";

function setWater(city: LiveCitySimulation, level: number) {
  city.water.packets.length = 0;
  if (level > 0)
    city.water.packets.push({
      z: WORLD.max - 1,
      amount: (level * WATER_CELL_LENGTH) / 20,
      kind: "dissolved",
      source: "upstream",
    });
}

// Controlled observations exercise the real issue lifecycle and feedback routing.
// Transport, collection and pollution physics are covered by the domain tests.
function fixture() {
  const city = new LiveCitySimulation();
  const state = { time: 20, illegal: 0, stopped: 0 };
  const traffic = city.stats,
    parking = city.parking.parkingStats;
  const schoolRoad = city.network.nodes.get(SCHOOL_NODE)!.connectedRoadIds[0];
  Object.defineProperty(city, "time", { get: () => state.time });
  Object.defineProperty(city, "stats", {
    get: () => ({
      ...traffic,
      stopped: state.stopped,
      roads: traffic.roads.map((r) => ({
        ...r,
        stopped: r.id === schoolRoad ? state.stopped : 0,
      })),
    }),
  });
  Object.defineProperty(city.parking, "parkingStats", {
    get: () => ({
      ...parking,
      illegal: state.illegal,
      sites: parking.sites.map((s) => ({
        ...s,
        illegal: s.id === "school" ? state.illegal : 0,
      })),
    }),
  });
  for (const site of city.sites) site.remaining = 0;
  setWater(city, 0);
  for (const shop of city.logistics.shops) shop.stock = 10;
  for (const place of city.facilities.access) place.unserved = 0;
  return {
    city,
    state,
    detect() {
      (city as unknown as { detectIssues(): void }).detectIssues();
    },
  };
}

const cases = [
  {
    name: "parking",
    high: 2,
    low: 0,
    set: (f: ReturnType<typeof fixture>, n: number) => {
      f.state.illegal = n;
    },
    noun: /불법주차한 차/,
    evidence: /현재 불법주차 대수/,
    exclude: /덜 막혀|수거장/,
  },
  {
    name: "traffic",
    high: 20,
    low: 6,
    set: (f: ReturnType<typeof fixture>, n: number) => {
      f.state.stopped = n;
    },
    noun: /기다리는 차가 줄어 전보다 덜 막혀요/,
    evidence: /도로 위 정차 차량/,
    exclude: /불법주차/,
  },
  {
    name: "dumping",
    high: 18,
    low: 3,
    set: (f: ReturnType<typeof fixture>, n: number) => {
      f.city.illegal("alley").remaining = n;
    },
    noun: /길가에 버려진 쓰레기/,
    evidence: /길가 투기물 봉투 수/,
    exclude: /수거장에 쌓여|모두 수거/,
  },
  {
    name: "collection",
    high: 50,
    low: 19,
    set: (f: ReturnType<typeof fixture>, n: number) => {
      f.city.sites.find((s) => !s.kind)!.remaining = n;
    },
    noun: /수거장에 쌓여 있던 쓰레기/,
    evidence: /수거장에 남은 봉투/,
    exclude: /길가에 버려진/,
  },
  {
    name: "water",
    high: 14,
    low: 8,
    set: (f: ReturnType<typeof fixture>, n: number) => {
      setWater(f.city, n);
    },
    noun: /하류 물의 오염/,
    evidence: /하류의 가상 오염도/,
    exclude: /마셔도|모두 깨끗/,
  },
  {
    name: "supply",
    high: 0,
    low: 10,
    set: (f: ReturnType<typeof fixture>, n: number) => {
      f.city.logistics.shops[0].stock = n;
    },
    noun: /물건이 모자라던 가게/,
    evidence: /현재 재고가 부족한 상점 수/,
    exclude: /모든 물건/,
  },
  {
    name: "access",
    high: 120,
    low: 50,
    set: (f: ReturnType<typeof fixture>, n: number) => {
      f.city.facilities.access[0].unserved = n;
    },
    noun: /도서관이나 공원을 이용할 수 있는 주민/,
    evidence: /시설을 이용하기 어려운 주민 수/,
    exclude: /모두 이용/,
  },
];

for (const c of cases)
  test(`improved ${c.name} reports the observed situation and keeps its local evidence`, () => {
    const f = fixture();
    c.set(f, c.high);
    f.detect();
    f.state.time = 120;
    f.detect();
    assert.equal(f.city.activeIssues.length, 1);
    const issue = f.city.activeIssues[0];
    c.set(f, c.low);
    f.state.time = 140;
    f.detect();
    const event = f.city.news.find((n) => n.type === "improved")!;
    assert.ok(event);
    assert.match(event.text, c.noun);
    assert.doesNotMatch(event.text, c.exclude);
    assert.doesNotMatch(event.text, /수치가 줄었|모두 해결/);
    assert.match(event.evidence!, c.evidence);
    assert.match(event.evidence!, /140초/);
    assert.deepEqual(event.position, issue.position);
    assert.equal(f.city.activeIssues.length, 0);
    f.state.time = 160;
    f.detect();
    assert.equal(f.city.news.filter((n) => n.type === "improved").length, 1);
    const voice = storyVoice(event);
    c.set(f, c.high);
    assert.equal(
      storyVoice(event).fact,
      voice.fact,
      "later conditions cannot rewrite a past observation",
    );
    assert.equal(
      voice.summary,
      event.text,
      "the map bubble uses the same concrete explanation",
    );
  });

test("policy feedback distinguishes traffic queues from illegal parking for lower, unchanged and higher counts", () => {
  for (const [stopped, illegal, change] of [
    [6, 0, /줄|덜 막혀/],
    [20, 2, /비슷/],
    [25, 4, /늘|더 막혀/],
  ] as const) {
    const f = fixture();
    f.state.stopped = 20;
    f.state.illegal = 2;
    f.city.apply("signal", SCHOOL_NODE);
    f.city.apply("patrol", "school");
    f.state.stopped = stopped;
    f.state.illegal = illegal;
    f.state.time = 140;
    f.city.step();
    const reactions = f.city.news.filter((n) => n.type === "reaction");
    assert.equal(reactions.length, 2);
    const signal = reactions.find((n) => n.title.includes("초록불"))!;
    const patrol = reactions.find((n) => n.title.includes("순찰"))!;
    assert.match(signal.text, /기다리는 차/);
    assert.doesNotMatch(signal.text, /불법주차/);
    assert.match(patrol.text, /불법주차한 차/);
    for (const event of reactions) assert.match(event.text, change);
    assert.match(
      signal.evidence!,
      new RegExp(`시행 전 20.0 → 지금 ${stopped}.0`),
    );
    assert.match(
      patrol.evidence!,
      new RegExp(`시행 전 2.0 → 지금 ${illegal}.0`),
    );
  }
});

test("completed resident activities describe parking, litter and downstream pollution without promising a cure", () => {
  const projects: [CommunityProjectId, string, RegExp][] = [
    ["walking", "school", /불법주차한 차/],
    ["sorting", "alley", /길가에 버려진 쓰레기/],
    ["waterCare", "homes", /하류 물의 오염/],
  ];
  for (const [project, target, noun] of projects) {
    const f = fixture();
    f.state.illegal = 2;
    f.city.illegal("alley").remaining = 18;
    setWater(f.city, 14);
    const record = f.city.council.start(
      project,
      target,
      "together",
      communityProject(project).voices.map((v) => v.id),
    );
    f.state.illegal = 0;
    f.city.illegal("alley").remaining = 3;
    setWater(f.city, 8);
    f.state.time = record.endsAt;
    f.city.council.tick();
    const event = f.city.news.find((n) => n.title === "주민 활동을 돌아봐요")!;
    assert.match(event.text, noun);
    assert.match(event.text, /줄었어요/);
    assert.match(event.text, /다른 정책과 생활 변화/);
    assert.doesNotMatch(event.text, /모두 해결|수치가/);
    assert.ok(record.result!.after < record.before);
  }
});
