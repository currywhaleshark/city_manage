import {
  GLOBAL_POLICIES,
  LIVE_POLICIES,
  type LiveCitySimulation,
  type LivePolicyId,
  type Topic,
} from "../simulation/live";

// Read the same budget, applied policies and buildable targets as the engine.
// This preview never buys a policy or reserves land.
export function policyAvailability(sim: LiveCitySimulation, id: LivePolicyId) {
  const global = GLOBAL_POLICIES.includes(id);
  const targets = sim.targets(id);
  const blocked = sim.policyBlocked(id);
  const reasons = blocked ? [blocked] : [];
  return {
    available: !reasons.length,
    global,
    targets,
    reasons,
    label: reasons.length
      ? reasons.join(" · ")
      : global
        ? "도시 전체에 적용"
        : `지도에서 적용 장소 선택 · ${targets.length}곳`,
  };
}

export function policyListMarkup(sim: LiveCitySimulation, topic: Topic) {
  return LIVE_POLICIES.filter((p) => p.topic === topic)
    .map((p) => {
      const status = policyAvailability(sim, p.id);
      return `<article class="live-policy-item"><button class="live-policy" data-live-policy="${p.id}" aria-disabled="${!status.available}" aria-describedby="policy-status-${p.id}"><strong>${p.title}<em>예산 ${p.cost}</em></strong><span>${p.description}</span></button><details class="live-policy-details"><summary><span class="policy-availability" id="policy-status-${p.id}" data-policy-status="${p.id}" data-unavailable="${!status.available}">${status.label}</span><span class="policy-caution">주의할 점</span></summary><p>${p.tradeoff}</p></details></article>`;
    })
    .join("");
}

/** Budget grants must update an open list without replacing focus or disclosures. */
export function updatePolicyAvailability(
  root: HTMLElement,
  sim: LiveCitySimulation,
) {
  const budget = root.querySelector("#policy-budget");
  if (budget && budget.textContent !== String(sim.budget))
    budget.textContent = String(sim.budget);
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    "[data-live-policy]",
  )) {
    const id = button.dataset.livePolicy as LivePolicyId;
    const status = policyAvailability(sim, id);
    button.setAttribute("aria-disabled", String(!status.available));
    const label = root.querySelector<HTMLElement>(`#policy-status-${id}`)!;
    label.dataset.unavailable = String(!status.available);
    if (label.textContent !== status.label) label.textContent = status.label;
  }
}
