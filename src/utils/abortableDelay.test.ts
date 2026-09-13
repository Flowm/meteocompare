import { afterEach, describe, expect, it, vi } from "vitest";

import { abortableDelay } from "./abortableDelay";

afterEach(() => vi.useRealTimers());
describe("abortableDelay", () => {
  it("rejects an already aborted signal without creating a timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    await expect(abortableDelay(250, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels the timer when aborted while waiting", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = expect(abortableDelay(250, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("removes the abort listener after the delay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = abortableDelay(250, controller.signal);
    await vi.advanceTimersByTimeAsync(250);
    await pending;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
