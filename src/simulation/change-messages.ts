import type { Topic } from "./live";

// Traffic queues and collection piles share a topic with parking and dumping,
// but residents must describe the quantity that was actually observed.
export type CityChangeMetric = Topic | "traffic" | "collection";
export type CityChangeDirection = "less" | "more" | "same";

const messages: Record<
  CityChangeMetric,
  Record<CityChangeDirection, string> & { followup: string }
> = {
  traffic: {
    less: "길에서 기다리는 차가 줄어 전보다 덜 막혀요.",
    more: "길에서 기다리는 차가 늘어 전보다 더 막혀요.",
    same: "길에서 기다리는 차는 아직 전과 비슷해요.",
    followup: "다른 길에서도 차가 잘 움직이는지 함께 살펴봐 주세요.",
  },
  parking: {
    less: "불법주차한 차가 전보다 줄었어요.",
    more: "불법주차한 차가 전보다 늘었어요.",
    same: "불법주차한 차는 아직 전과 비슷해요.",
    followup: "다시 길을 막는 차가 생기지 않는지 살펴봐 주세요.",
  },
  waste: {
    less: "길가에 버려진 쓰레기가 전보다 줄었어요.",
    more: "길가에 버려진 쓰레기가 전보다 늘었어요.",
    same: "길가에 버려진 쓰레기의 양은 아직 전과 비슷해요.",
    followup:
      "새로 버린 쓰레기와 수거한 양, 하천으로 흘러간 양도 함께 살펴봐 주세요.",
  },
  collection: {
    less: "수거장에 쌓여 있던 쓰레기가 전보다 줄었어요.",
    more: "수거장에 쌓인 쓰레기가 전보다 늘었어요.",
    same: "수거장에 쌓인 쓰레기의 양은 아직 전과 비슷해요.",
    followup: "다시 쌓이지 않는지 수거차가 오는 모습도 살펴봐 주세요.",
  },
  water: {
    less: "하류 물의 오염이 전보다 줄었어요.",
    more: "하류 물의 오염이 전보다 늘었어요.",
    same: "하류 물의 오염은 아직 전과 비슷해요.",
    followup: "물 위에 떠 있는 쓰레기도 함께 살펴봐 주세요.",
  },
  supply: {
    less: "물건이 모자라던 가게가 전보다 줄었어요.",
    more: "물건이 모자란 가게가 전보다 늘었어요.",
    same: "물건이 모자란 가게 수는 아직 전과 비슷해요.",
    followup: "물건이 계속 들어오는지 배송차도 살펴봐 주세요.",
  },
  access: {
    less: "도서관이나 공원을 이용할 수 있는 주민이 전보다 늘었어요.",
    more: "도서관이나 공원을 이용하기 어려운 주민이 전보다 늘었어요.",
    same: "도서관이나 공원을 이용하기 어려운 주민 수는 아직 전과 비슷해요.",
    followup: "아직 시설을 이용하기 어려운 동네도 살펴봐 주세요.",
  },
};

export function cityChangeText(
  metric: CityChangeMetric,
  direction: CityChangeDirection,
) {
  const message = messages[metric];
  return `${message[direction]} ${message.followup}`;
}
