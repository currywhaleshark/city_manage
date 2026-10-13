export type PanelName = "mission" | "policy" | "traffic" | "selection";

/** One modeless tool panel at a time; the city remains interactive. */
export function createPanels() {
  let active: PanelName | null = null;
  let returnFocus: HTMLElement | null = null;
  const panels = document.querySelectorAll<HTMLElement>("[data-panel]");
  const triggers =
    document.querySelectorAll<HTMLButtonElement>("[data-open-panel]");

  function close(restoreFocus = false) {
    panels.forEach((panel) => (panel.hidden = true));
    triggers.forEach((button) => button.setAttribute("aria-expanded", "false"));
    document.body.removeAttribute("data-active-panel");
    active = null;
    if (restoreFocus) returnFocus?.focus();
  }

  function open(name: PanelName, trigger?: HTMLElement) {
    close();
    document.querySelector("#toast")?.classList.remove("visible");
    active = name;
    returnFocus =
      (trigger &&
      !trigger.closest("[data-panel]") &&
      trigger.id !== "next-policy"
        ? trigger
        : document.querySelector<HTMLElement>(
            `.tools [data-open-panel="${name}"]`,
          )) ?? document.querySelector("#city-canvas");
    document.body.dataset.activePanel = name;
    const panel = document.querySelector<HTMLElement>(
      `[data-panel="${name}"]`,
    )!;
    panel.hidden = false;
    triggers.forEach((button) =>
      button.setAttribute(
        "aria-expanded",
        String(button.dataset.openPanel === name),
      ),
    );
    panel
      .querySelector<HTMLElement>("[data-panel-heading]")
      ?.focus({ preventScroll: true });
  }

  triggers.forEach((button) =>
    button.addEventListener("click", () => {
      const name = button.dataset.openPanel as PanelName;
      if (active === name) close(true);
      else open(name, button);
    }),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-close-panel]")
    .forEach((button) => button.addEventListener("click", () => close(true)));
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      active &&
      !document.querySelector("dialog[open]")
    ) {
      event.preventDefault();
      close(true);
    }
  });
  return { open, close };
}
