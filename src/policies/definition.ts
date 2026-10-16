export interface PolicyDefinition<State> {
  id: string;
  scenarioId: string;
  title: string;
  cost: number;
  target: string;
  description: string;
  tradeoff: string;
  metrics: readonly string[];
  available: (state: Readonly<State>) => boolean;
  apply: (state: State) => void;
}
export function applyPolicies<S>(
  definitions: readonly PolicyDefinition<S>[],
  ids: readonly string[],
  initial: S,
  budget: number,
) {
  if (new Set(ids).size !== ids.length)
    throw new Error("같은 정책을 두 번 선택할 수 없어요.");
  let cost = 0;
  for (const id of ids) {
    const definition = definitions.find((p) => p.id === id);
    if (!definition || !definition.available(initial))
      throw new Error("시행할 수 없는 정책이에요.");
    cost += definition.cost;
  }
  if (cost > budget) throw new Error("예산이 부족해요.");
  for (const id of ids) definitions.find((p) => p.id === id)!.apply(initial);
  return { state: initial, cost };
}
