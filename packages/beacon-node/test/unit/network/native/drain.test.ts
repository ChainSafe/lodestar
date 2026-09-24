import {afterEach, describe, expect, it, vi} from "vitest";
import {RegistryMetricCreator} from "../../../../src/metrics/utils/registryMetricCreator.js";
import {NativeDrain, NativeDrainStages} from "../../../../src/network/core/native/drain.js";

const limits = {budgetMs: 8, peers: 32, settle: 32, servingStarts: 8, gossipItems: 16, gossipBytes: 2 * 1024 * 1024};

function macrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function yields(register: RegistryMetricCreator): Promise<Record<string, number>> {
  const metric = await register.getSingleMetric("lodestar_native_drain_yields_total")?.get();
  return Object.fromEntries((metric?.values ?? []).map(({labels, value}) => [String(labels.reason), value]));
}

function fixture() {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const runtime = {settle: vi.fn(() => false), endDrain: vi.fn(() => false)};
  const stages = {
    peers: vi.fn<NativeDrainStages["peers"]>(() => false),
    requests: vi.fn<NativeDrainStages["requests"]>(() => false),
    gossip: vi.fn<NativeDrainStages["gossip"]>(() => false),
  };
  let open = true;
  const onError = vi.fn((_error: unknown) => false);
  const register = new RegistryMetricCreator();
  const drain = new NativeDrain(runtime, limits, () => (open ? stages : null), onError, register);
  return {
    runtime,
    stages,
    onError,
    register,
    drain,
    advance(ms: number) {
      now += ms;
    },
    close() {
      open = false;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("native drain", () => {
  it("only schedules on notification and coalesces notifications into one drain", async () => {
    const node = fixture();
    node.drain.request();
    node.drain.request();
    expect(node.runtime.settle).not.toHaveBeenCalled();
    await macrotask();
    expect(node.runtime.settle).toHaveBeenCalledExactlyOnceWith(limits.settle);
    expect(node.stages.peers).toHaveBeenCalledExactlyOnceWith(limits.peers);
    expect(node.stages.requests).toHaveBeenCalledExactlyOnceWith(limits.servingStarts);
    expect(node.stages.gossip).toHaveBeenCalledExactlyOnceWith({
      items: limits.gossipItems,
      bytes: limits.gossipBytes,
      deadline: limits.budgetMs,
    });
    expect(node.runtime.endDrain).toHaveBeenCalledOnce();
    await macrotask();
    expect(node.runtime.settle).toHaveBeenCalledOnce();
    expect(await yields(node.register)).toEqual({idle: 1});
  });

  it("stops starting stages once the budget is spent and resumes in the next macrotask", async () => {
    const node = fixture();
    node.stages.requests.mockImplementationOnce(() => {
      node.advance(limits.budgetMs);
      return false;
    });
    node.drain.request();
    await macrotask();
    expect(node.stages.requests).toHaveBeenCalledOnce();
    expect(node.stages.gossip).not.toHaveBeenCalled();
    expect(node.runtime.endDrain).not.toHaveBeenCalled();
    await macrotask();
    expect(node.stages.gossip).toHaveBeenCalledOnce();
    expect(node.runtime.endDrain).toHaveBeenCalledOnce();
    expect(await yields(node.register)).toEqual({budget: 1, idle: 1});
  });

  it("keeps the latch while a cap leaves work and drains again until native reports none", async () => {
    const node = fixture();
    node.stages.peers.mockReturnValueOnce(true);
    node.runtime.endDrain.mockReturnValueOnce(true);
    node.drain.request();
    await macrotask();
    expect(node.runtime.endDrain).not.toHaveBeenCalled();
    await macrotask();
    expect(node.runtime.endDrain).toHaveBeenCalledOnce();
    await macrotask();
    expect(node.runtime.endDrain).toHaveBeenCalledTimes(2);
    await macrotask();
    expect(node.stages.peers).toHaveBeenCalledTimes(3);
    expect(await yields(node.register)).toEqual({caps: 2, idle: 1});
  });

  it("settles only after the host closes, until native has nothing left", async () => {
    const node = fixture();
    node.close();
    node.runtime.settle.mockReturnValueOnce(true);
    node.drain.request();
    await macrotask();
    await macrotask();
    await macrotask();
    expect(node.runtime.settle).toHaveBeenCalledTimes(2);
    expect(node.runtime.endDrain).toHaveBeenCalledOnce();
    expect(node.stages.peers).not.toHaveBeenCalled();
  });

  it("retries after a failure its handler recovers and otherwise still ends the drain", async () => {
    const node = fixture();
    const failure = new Error("drain failed");
    node.stages.gossip.mockImplementationOnce(() => {
      throw failure;
    });
    node.onError.mockReturnValueOnce(true);
    node.drain.request();
    await macrotask();
    expect(node.onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(node.runtime.endDrain).not.toHaveBeenCalled();
    node.runtime.settle.mockImplementationOnce(() => {
      throw failure;
    });
    await macrotask();
    expect(node.onError).toHaveBeenCalledTimes(2);
    expect(node.runtime.endDrain).toHaveBeenCalledOnce();
    await macrotask();
    expect(node.runtime.settle).toHaveBeenCalledTimes(2);
  });
});
