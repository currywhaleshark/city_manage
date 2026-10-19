/** Describe hidden map choices without taking space from the scrolling list. */
export function bindMapScrollHint(root: HTMLElement) {
  const list = root.querySelector<HTMLElement>(".map-layer-buttons")!;
  const view = root.ownerDocument.defaultView!;
  const hint = root.ownerDocument.createElement("p");
  hint.id = "map-scroll-hint";
  hint.className = "map-scroll-hint";
  hint.hidden = true;
  root.append(hint);

  const update = () => {
    const end = Math.max(0, list.scrollHeight - list.clientHeight);
    // Clamp touch overscroll and tolerate fractional scroll positions at an edge.
    const top = Math.max(0, Math.min(end, list.scrollTop));
    const above = top > 1;
    const below = end - top > 1;
    hint.hidden = list.clientHeight === 0 || !(above || below);
    if (hint.hidden) {
      list.removeAttribute("aria-describedby");
      return;
    }
    const text = above
      ? below
        ? "위아래 더 있음"
        : "위에 더 있음"
      : "아래 더 있음";
    if (hint.textContent !== text) hint.textContent = text;
    list.setAttribute("aria-describedby", hint.id);
  };

  list.addEventListener("scroll", update, { passive: true });
  view.addEventListener("resize", update);
  // The global-policy strip can resize this list without resizing the window.
  const observer = view.ResizeObserver ? new view.ResizeObserver(update) : null;
  observer?.observe(list);
  update();

  return () => {
    observer?.disconnect();
    list.removeEventListener("scroll", update);
    view.removeEventListener("resize", update);
    list.removeAttribute("aria-describedby");
    hint.remove();
  };
}
