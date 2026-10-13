import type { PolicySelection } from "../types";
import { CONFIG } from "../scenario";
export const POLICIES = [
  {
    id: "signal",
    title: "초록불 시간 조절",
    cost: 15,
    target: "학교 앞 교차로",
    description: "차가 많이 오는 동서 방향의 초록불을 늘려요.",
    tradeoff: "세로길에서 오는 차는 더 기다릴 수 있어요.",
  },
  {
    id: "bypass",
    title: "우회도로 개설",
    cost: 55,
    target: "학교 북쪽 연결 구간",
    description: "주거지와 상가 사이에 새로운 길을 이어요.",
    tradeoff: "새 길에도 차가 몰릴 수 있어요.",
  },
  {
    id: "oneWay",
    title: "일방통행 도입",
    cost: 30,
    target: "학교 가는 길 서쪽 구간",
    description: "두 차로 모두 학교 쪽으로 달리게 해요.",
    tradeoff: "반대 방향 차량은 돌아가야 해요.",
  },
] as const;
export const policyCost = (policy: PolicySelection) =>
  POLICIES.reduce((total, p) => total + (policy[p.id] ? p.cost : 0), 0);
export function validatePolicy(policy: PolicySelection) {
  if (policyCost(policy) > CONFIG.budget) throw new Error("예산이 부족해요.");
  if (
    !Number.isFinite(policy.ewGreen) ||
    policy.ewGreen < 12 ||
    policy.ewGreen > 38
  )
    throw new Error("초록불은 12~38초로 정해 주세요.");
}
