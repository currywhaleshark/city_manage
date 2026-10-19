import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { bindMapScrollHint } from "../src/ui/map-scroll-hint";

// JSDOM does not lay out CSS. Supply scroll geometry to check the actual
// event handling, edge hints, resize updates and focus preservation.
function fixture() {
  const dom = new JSDOM(
    '<div class="map-tools"><div class="map-layer-buttons"><button>지구·공터</button><button>인구·시설</button></div></div>',
  );
  const root = dom.window.document.querySelector<HTMLElement>(".map-tools")!;
  const list = root.querySelector<HTMLElement>(".map-layer-buttons")!;
  const size = { content: 422, viewport: 353 };
  Object.defineProperties(list, {
    scrollHeight: { get: () => size.content },
    clientHeight: { get: () => size.viewport },
  });
  return { dom, root, list, size };
}

test("map hints follow both scroll edges without changing the focused choice", () => {
  const { dom, root, list, size } = fixture();
  const dispose = bindMapScrollHint(root);
  try {
    const hint = root.querySelector<HTMLElement>(".map-scroll-hint")!;
    const choice = list.querySelector<HTMLButtonElement>("button")!;
    const scroll = (top: number) => {
      list.scrollTop = top;
      list.dispatchEvent(new dom.window.Event("scroll"));
    };
    assert.equal(hint.hidden, false);
    assert.equal(hint.textContent, "아래 더 있음");
    assert.equal(list.getAttribute("aria-describedby"), hint.id);
    choice.focus();
    scroll(30);
    assert.equal(hint.textContent, "위아래 더 있음");
    scroll(68.5);
    assert.equal(hint.textContent, "위에 더 있음");
    scroll(100); // Touch overscroll beyond the bottom.
    assert.equal(hint.textContent, "위에 더 있음");
    scroll(-15); // Touch overscroll above the first choice.
    assert.equal(hint.textContent, "아래 더 있음");
    assert.equal(dom.window.document.activeElement, choice);
    assert.equal(list.firstElementChild, choice);

    size.viewport = 557; // A taller portrait viewport fits all seven choices.
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    assert.equal(hint.hidden, true);
    assert.equal(list.hasAttribute("aria-describedby"), false);
    size.viewport = 353;
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    assert.equal(hint.hidden, false);
    assert.equal(hint.textContent, "아래 더 있음");
  } finally {
    dispose();
    dom.window.close();
  }
});

test("map hints handle a list resize and stop observing after disposal", () => {
  const { dom, root, list, size } = fixture();
  let resized = () => {};
  let observed: Element | undefined;
  let disconnected = false;
  Object.defineProperty(dom.window, "ResizeObserver", {
    value: class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe(element: Element) {
        observed = element;
      }
      disconnect() {
        disconnected = true;
      }
    },
  });
  size.viewport = 0; // No misleading cue while the list is not laid out.
  const dispose = bindMapScrollHint(root);
  try {
    const hint = root.querySelector<HTMLElement>(".map-scroll-hint")!;
    assert.equal(observed, list);
    assert.equal(hint.hidden, true);
    size.viewport = 353;
    resized();
    assert.equal(hint.hidden, false);
    size.viewport = 422;
    resized();
    assert.equal(hint.hidden, true);
    dispose();
    assert.equal(disconnected, true);
    assert.equal(root.querySelector(".map-scroll-hint"), null);
    size.viewport = 100;
    list.dispatchEvent(new dom.window.Event("scroll"));
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    assert.equal(list.hasAttribute("aria-describedby"), false);
  } finally {
    dispose();
    dom.window.close();
  }
});
