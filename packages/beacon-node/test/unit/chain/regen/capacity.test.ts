import {expect, it, vi} from "vitest";
import {IBeaconStateView} from "@lodestar/state-transition";
import {defer} from "@lodestar/utils";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {RegenCaller} from "../../../../src/chain/regen/interface.js";
import {QueuedStateRegenerator} from "../../../../src/chain/regen/queued.js";
import {RegenModules, StateRegenerator} from "../../../../src/chain/regen/regen.js";

it("notifies at dequeue when validation capacity recovers, before the job finishes", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const active = defer<IBeaconStateView>();
  const process = vi.spyOn(StateRegenerator.prototype, "getState").mockReturnValue(active.promise);
  const emitter = new ChainEventEmitter();
  const modules = {emitter, blockStateCache: {get: () => null}, metrics: null} as unknown as RegenModules;
  const regen = new QueuedStateRegenerator({...modules, signal: controller.signal});
  const wake = vi.fn(() => expect(regen.canAcceptWork()).toBe(true));
  emitter.on(ChainEvent.validationCapacity, wake);
  const pending = Array.from({length: 16}, (_, i) =>
    regen.getState(`0x${i}`, RegenCaller.validateGossipBlock).catch((error: unknown) => error)
  );
  try {
    expect(regen.canAcceptWork()).toBe(false);
    await vi.runAllTimersAsync();
    expect(process).toHaveBeenCalledOnce();
    expect(wake).toHaveBeenCalledOnce();
    expect(regen.jobQueue.jobLen).toBe(15);
  } finally {
    controller.abort();
    active.reject(Error("test shutdown"));
    await vi.runAllTimersAsync();
    await Promise.all(pending);
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
