import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {defer} from "@lodestar/utils";
import {BeaconNode, BeaconNodeStatus} from "../../../src/node/nodejs.js";

function fixture() {
  const controller = new AbortController();
  const steps = {
    sync: vi.fn<() => void>(),
    restApi: vi.fn(async () => {}),
    network: vi.fn(async () => {}),
    metrics: vi.fn(async () => {}),
    monitoring: vi.fn(async () => {}),
    persist: vi.fn(async () => {}),
    chain: vi.fn(async () => {}),
    abort: vi.spyOn(controller, "abort"),
    db: vi.fn(async () => {}),
  };
  const node = Object.create(BeaconNode.prototype) as BeaconNode;
  Object.assign(node, {
    status: BeaconNodeStatus.started,
    sync: {close: steps.sync},
    restApi: {close: steps.restApi},
    network: {close: steps.network},
    metricsServer: {close: steps.metrics},
    monitoring: {close: steps.monitoring},
    chain: {persistToDisk: steps.persist, close: steps.chain},
    controller,
    db: {close: steps.db},
  });
  return {node, steps, controller};
}

describe("beacon node close", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shares completion with concurrent and reentrant callers and waits for ordered cleanup", async () => {
    const {node, steps, controller} = fixture();
    const networkClosed = defer<void>();
    const dbClosed = defer<void>();
    steps.network.mockReturnValue(networkClosed.promise);
    steps.db.mockReturnValue(dbClosed.promise);
    let reentrant: Promise<void> | undefined;
    steps.sync.mockImplementation(() => {
      reentrant = node.close();
    });
    const first = node.close();
    expect(reentrant).toBe(first);
    expect(node.close()).toBe(first);
    expect(node.status).toBe(BeaconNodeStatus.closing);
    let settled = false;
    void first.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(steps.network).toHaveBeenCalledOnce();
    expect(steps.persist).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
    networkClosed.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(steps.chain).toHaveBeenCalledOnce();
    expect(controller.signal.aborted).toBe(true);
    expect(steps.db).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(steps.db).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    expect(node.status).toBe(BeaconNodeStatus.closing);
    dbClosed.resolve();
    await first;
    expect(node.status).toBe(BeaconNodeStatus.closed);
    expect(node.close()).toBe(first);
    const ordered = Object.entries(steps);
    for (let i = 0; i < ordered.length; i++) {
      const [name, step] = ordered[i];
      expect(step, name).toHaveBeenCalledOnce();
      if (i > 0) expect(ordered[i - 1][1], name).toHaveBeenCalledBefore(step);
    }
  });

  it.each(["sync", "restApi", "network", "persist"] as const)(
    "finishes cleanup after %s fails and preserves the failure for every caller",
    async (failedStep) => {
      const {node, steps, controller} = fixture();
      const error = new Error(`${failedStep} failed`);
      steps[failedStep].mockImplementation(() => {
        throw error;
      });
      const first = node.close();
      const rejected = expect(first).rejects.toBe(error);
      await Promise.all([rejected, vi.runAllTimersAsync()]);
      for (const [name, step] of Object.entries(steps)) expect(step, name).toHaveBeenCalledOnce();
      expect(controller.signal.aborted).toBe(true);
      expect(node.status).toBe(BeaconNodeStatus.closed);
      expect(node.close()).toBe(first);
    }
  );

  it("preserves all cleanup errors, including a database close failure", async () => {
    const {node, steps} = fixture();
    const networkError = new Error("network cleanup failed");
    const persistError = new Error("persistence failed");
    const dbError = new Error("database close failed");
    steps.network.mockRejectedValue(networkError);
    steps.persist.mockRejectedValue(persistError);
    steps.db.mockRejectedValue(dbError);
    const first = node.close();
    const rejected = expect(first).rejects.toMatchObject({errors: [networkError, persistError, dbError]});
    await Promise.all([rejected, vi.runAllTimersAsync()]);
    expect(node.status).toBe(BeaconNodeStatus.closed);
    expect(node.close()).toBe(first);
  });
});
