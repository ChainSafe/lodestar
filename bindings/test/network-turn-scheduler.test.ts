import {afterEach, expect, it, vi} from "vitest";
import {TurnScheduler} from "../src/network-turn-scheduler.js";
import {immediates} from "./utils/network-turn-scheduler.js";

afterEach(() => {
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(["now", "idle"] as const)("schedules the pump's %s continuation", (next) => {
  const queued = immediates();
  const pump = {turn: vi.fn(() => next)};
  const scheduler = new TurnScheduler(pump);
  scheduler.schedule();
  scheduler.schedule();
  expect(queued).toHaveLength(1);
  queued.shift()?.();
  expect(pump.turn).toHaveBeenCalledOnce();
  expect(queued.length).toBe(next === "now" ? 1 : 0);
  scheduler.stop();
  queued.shift()?.();
  expect(pump.turn).toHaveBeenCalledOnce();
});

it("keeps a wake that arrives during a running turn", () => {
  const queued = immediates();
  const scheduler = new TurnScheduler({
    turn() {
      scheduler.schedule();
      scheduler.schedule();
      return "idle";
    },
  });
  scheduler.schedule();
  queued.shift()?.();
  expect(queued).toHaveLength(1);
  scheduler.stop();
});
