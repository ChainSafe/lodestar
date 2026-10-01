import {describe, expect, it, vi} from "vitest";
import type {NodePair} from "../../utils/crucible/interfaces.js";
import type {Simulation} from "../../utils/crucible/simulation.js";
import {SimulationTrackerEvent} from "../../utils/crucible/simulationTracker.js";
import {waitForHead} from "../../utils/crucible/utils/network.js";

describe("waitForHead", () => {
  it.each([23, 24])("resolves when a later head reaches slot %s", async (slot) => {
    const {env, node, on, off, emit} = setup();
    const settled = vi.fn();
    const promise = waitForHead(env, node, {slot: 23, head: "target", silent: true}).then(settled);

    emit({slot: 17, block: "earlier"});
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled();

    emit({slot, block: "later"});
    await Promise.resolve();
    await Promise.resolve();
    expect(off).toHaveBeenCalledExactlyOnceWith(node, SimulationTrackerEvent.Head, on.mock.calls[0][2]);
    await promise;
    expect(settled).toHaveBeenCalledOnce();
  });

  it("still resolves on the requested root before the target slot", async () => {
    const {env, node, on, off, emit} = setup();
    const promise = waitForHead(env, node, {slot: 23, head: "target", silent: true});

    emit({slot: 16, block: "target"});
    await promise;
    expect(off).toHaveBeenCalledExactlyOnceWith(node, SimulationTrackerEvent.Head, on.mock.calls[0][2]);
  });

  it("resolves when the first event is already beyond the target slot", async () => {
    const {env, node, off, emit} = setup();
    const promise = waitForHead(env, node, {slot: 23, head: "target", silent: true});

    emit({slot: 24, block: "later"});
    await promise;
    expect(off).toHaveBeenCalledOnce();
  });
});

function setup() {
  type Head = {slot: number; block: string};
  let listener: ((event: Head) => void) | undefined;
  const on = vi.fn((_node: NodePair, _event: SimulationTrackerEvent, callback: (event: Head) => void) => {
    listener = callback;
  });
  const off = vi.fn();
  const node = {id: "test"} as NodePair;
  const env = {tracker: {on, off}} as unknown as Simulation;
  return {
    env,
    node,
    on,
    off,
    emit(event: Head) {
      if (listener === undefined) throw Error("Head listener not registered");
      listener(event);
    },
  };
}
