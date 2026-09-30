// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMO_SHELLS, type MemoShellProps } from "../../src/components/skins/layouts/memo-layouts";

let root: Root;
let container: HTMLDivElement;
const decide = vi.fn();
const props: MemoShellProps = {
  role: "Growth leader",
  company: "Example",
  verdict: "CONSIDER",
  fit: 74,
  evidenceCount: 8,
  openQuestions: 2,
  onDecide: decide,
  children: "Memo evidence",
};
async function render(overrides: Partial<MemoShellProps> = {}) {
  await act(async () => root.render(createElement(MEMO_SHELLS.signal, { ...props, ...overrides })));
}
function key(value: string, options: KeyboardEventInit = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options }),
  );
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  decide.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("Signal memo decisions", () => {
  it("routes p/c/x to the page decision callback", async () => {
    await render();
    key("p");
    key("c");
    key("x");
    expect(decide.mock.calls.map(([verb]) => verb)).toEqual(["PURSUE", "CONSIDER", "PASS"]);
  });
  it("blocks shortcuts while a decision is pending and restores them when it settles", async () => {
    await render({ decisionPending: true });
    key("p");
    expect(decide).not.toHaveBeenCalled();
    expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    await render({ decisionPending: false });
    key("p");
    expect(decide).toHaveBeenCalledExactlyOnceWith("PURSUE");
  });
  it("does not change the underlying decision while a cockpit or dialog is open", async () => {
    await render();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-pursuit-cockpit", "");
    document.body.append(overlay);
    key("x");
    expect(decide).not.toHaveBeenCalled();
    overlay.removeAttribute("data-pursuit-cockpit");
    overlay.setAttribute("role", "dialog");
    key("c");
    expect(decide).not.toHaveBeenCalled();
    overlay.remove();
    key("x");
    expect(decide).toHaveBeenCalledExactlyOnceWith("PASS");
  });
  it("ignores typing, browser shortcuts and held keys", async () => {
    await render();
    const input = document.createElement("input");
    container.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    const editable = document.createElement("div");
    // jsdom does not implement isContentEditable.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    container.append(editable);
    editable.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    key("p", { ctrlKey: true });
    key("c", { metaKey: true });
    key("x", { altKey: true });
    key("p", { repeat: true });
    expect(decide).not.toHaveBeenCalled();
  });
  it("removes shortcuts when the Signal shell unmounts", async () => {
    await render();
    await act(async () => root.render(createElement(MEMO_SHELLS.radar, props)));
    key("p");
    expect(decide).not.toHaveBeenCalled();
    expect(container.textContent).toBe("Memo evidence");
  });
});
