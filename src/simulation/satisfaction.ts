import { TOPICS, type LiveCitySimulation, type Topic } from "./live";
import { DUMPING_SITES } from "./services/dumping";

/**
 * Residents' satisfaction is read from the same measurements that raise and
 * clear neighbourhood problems. It never feeds back into budget or demand.
 */
export interface SatisfactionPart {
  label: string;
  value: number;
  /** At or better than this value residents are content (score 100). */
  good: number;
  /** At or worse than this value residents are unhappy (score 0). */
  bad: number;
  score: number;
  unit: string;
  digits: number;
}
export interface TopicSatisfaction {
  topic: Topic;
  title: string;
  score: number;
  parts: SatisfactionPart[];
}
export interface CitySatisfaction {
  overall: number;
  topics: Record<Topic, TopicSatisfaction>;
}

export const SATISFACTION_TOPICS = Object.keys(TOPICS) as Topic[];

export function partScore(value: number, good: number, bad: number) {
  return Math.max(0, Math.min(100, (100 * (bad - value)) / (bad - good)));
}

function part(
  label: string,
  value: number,
  good: number,
  bad: number,
  unit: string,
  digits = 0,
): SatisfactionPart {
  const score = partScore(value, good, bad);
  return { label, value, good, bad, unit, digits, score };
}

// Good values match the problem-cleared thresholds in LiveCitySimulation;
// bad values sit near what an untended city reaches in about 20 minutes.
function parts(sim: LiveCitySimulation): Record<Topic, SatisfactionPart[]> {
  const values = sim.values;
  const piles = sim.sites.filter((s) => !s.kind).map((s) => s.remaining);
  const population = sim.facilities.access.reduce(
    (n, s) => n + s.population,
    0,
  );
  return {
    parking: sim.usesEastBank
      ? [
          part("불법주차한 차", values.parking, 0, 6, "대"),
          part("강 서쪽 길에서 기다리는 차", sim.stats.stopped - sim.eastStopped, 4, 18, "대"),
          part("강 건너 길에서 기다리는 차", sim.eastStopped, 4, 15, "대"),
        ]
      : [
          part("불법주차한 차", values.parking, 0, 6, "대"),
          part("길에서 기다리는 차", sim.stats.stopped, 6, 24, "대"),
        ],
    waste: [
      part(
        "길가에 버려진 쓰레기",
        values.waste,
        4 * DUMPING_SITES.length,
        40 * DUMPING_SITES.length,
        "봉투",
        1,
      ),
      part(
        "가장 많이 쌓인 수거장",
        Math.max(0, ...piles),
        20,
        60,
        "봉투",
        1,
      ),
    ],
    water: [
      ...(sim.usesEastBank
        ? [part("배출구 아래의 가상 오염도", sim.water.cells[4].level, 8, 30, "", 1)]
        : []),
      part("하류의 가상 오염도", values.water, 8, 30, "", 1),
    ],
    supply: [
      part(
        "물건이 모자란 상점",
        values.supply,
        0,
        sim.logistics.shops.length,
        "곳",
      ),
    ],
    access: [
      part("시설을 이용하기 어려운 주민", values.access, 50, population, "명"),
    ],
  };
}

export function citySatisfaction(sim: LiveCitySimulation): CitySatisfaction {
  const all = parts(sim);
  const topics = Object.fromEntries(
    SATISFACTION_TOPICS.map((topic) => [
      topic,
      {
        topic,
        title: TOPICS[topic],
        parts: all[topic],
        score:
          all[topic].reduce((n, p) => n + p.score, 0) / all[topic].length,
      },
    ]),
  ) as Record<Topic, TopicSatisfaction>;
  const overall =
    SATISFACTION_TOPICS.reduce((n, t) => n + topics[t].score, 0) /
    SATISFACTION_TOPICS.length;
  return { overall, topics };
}
