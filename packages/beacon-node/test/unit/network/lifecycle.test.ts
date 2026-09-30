import {EventEmitter} from "node:events";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {LogLevel, defer} from "@lodestar/utils";
import {ChainEvent} from "../../../src/chain/emitter.js";
import {INetworkCore} from "../../../src/network/core/types.js";
import {NetworkEvent, NetworkEventBus} from "../../../src/network/events.js";
import {Network} from "../../../src/network/network.js";
import {defaultNetworkOptions} from "../../../src/network/options.js";
import {AggregatorTracker} from "../../../src/network/processor/aggregatorTracker.js";
import {NetworkProcessor} from "../../../src/network/processor/index.js";
import {ClockEvent} from "../../../src/util/clock.js";
import {ClockStopped} from "../../mocks/clock.js";
import {getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {getMockedBeaconDb} from "../../mocks/mockedBeaconDb.js";

async function fixture(close: () => Promise<void>) {
  const config = createBeaconConfig(defaultConfig, new Uint8Array(32));
  const clock = new ClockStopped(0);
  const chain = {...getMockedBeaconChain(), clock, config, getStatus: vi.fn(() => ssz.fulu.Status.defaultValue())};
  const events = new NetworkEventBus();
  const logger = testLogger();
  const aggregatorTracker = new AggregatorTracker();
  const publishGossip = vi.fn(async () => 0);
  const updateStatus = vi.fn<INetworkCore["updateStatus"]>().mockResolvedValue(undefined);
  const setTargetGroupCount = vi.fn<INetworkCore["setTargetGroupCount"]>().mockResolvedValue(undefined);
  const core = {close, publishGossip, updateStatus, setTargetGroupCount} as unknown as INetworkCore;
  const networkProcessor = new NetworkProcessor(
    {chain, db: getMockedBeaconDb(), config, logger, metrics: null, events, core, aggregatorTracker},
    {}
  );
  const network = new Network({
    opts: defaultNetworkOptions,
    privateKey: await generateKeyPair("secp256k1"),
    config,
    chain,
    logger,
    networkEventBus: events,
    networkProcessor,
    core,
    aggregatorTracker,
  });
  return {network, events, chain, clock, publishGossip, updateStatus, setTargetGroupCount, logger};
}

describe("outer network retirement", () => {
  afterEach(() => vi.useRealTimers());

  it("latches close, stops ingress and removes exact listeners before joining the core", async () => {
    const joined = defer<void>();
    const close = vi.fn(() => joined.promise);
    const {network, events, chain, clock} = await fixture(close);
    events.emit(NetworkEvent.peerConnected, {
      peer: network.peerId.toString(),
      status: ssz.phase0.Status.defaultValue(),
      custodyColumns: [],
      clientAgent: "test",
    });
    expect(network.getConnectedPeerCount()).toBe(1);
    const first = network.close();
    const second = network.close();
    try {
      expect(second).toBe(first);
      expect(network.closed).toBe(true);
      expect(network.getConnectedPeerCount()).toBe(0);
      expect(network.isSubscribedToGossipCoreTopics()).toBe(false);
      expect(close).toHaveBeenCalledOnce();
      expect(EventEmitter.prototype.listenerCount.call(events, NetworkEvent.pendingGossipsubMessage)).toBe(0);
      expect(clock.listenerCount(ClockEvent.slot)).toBe(0);
      expect(chain.emitter.listenerCount(routes.events.EventType.lightClientFinalityUpdate)).toBe(0);
      expect(chain.emitter.listenerCount(routes.events.EventType.lightClientOptimisticUpdate)).toBe(0);
    } finally {
      joined.resolve();
      await first;
    }
  });

  it("aborts delayed light-client publications at close", async () => {
    const {network, chain, publishGossip} = await fixture(async () => {});
    vi.useFakeTimers();
    chain.emitter.emit(routes.events.EventType.lightClientFinalityUpdate, {
      version: ForkName.altair,
      data: ssz.altair.LightClientFinalityUpdate.defaultValue(),
    });
    chain.emitter.emit(routes.events.EventType.lightClientOptimisticUpdate, {
      version: ForkName.altair,
      data: ssz.altair.LightClientOptimisticUpdate.defaultValue(),
    });
    await network.close();
    await vi.runAllTimersAsync();
    expect(publishGossip).not.toHaveBeenCalled();
  });

  it("preserves the close failure for all callers after stopping the processor", async () => {
    const error = new Error("native join failed");
    const close = vi.fn(async () => {
      throw error;
    });
    const {network, events, clock} = await fixture(close);
    await expect(network.close()).rejects.toBe(error);
    await expect(network.close()).rejects.toBe(error);
    expect(network.closed).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(EventEmitter.prototype.listenerCount.call(events, NetworkEvent.pendingGossipsubMessage)).toBe(0);
    expect(clock.listenerCount(ClockEvent.slot)).toBe(0);
  });
});

describe("network event command failures", () => {
  it.each([ChainEvent.updateStatus, routes.events.EventType.head])(
    "handles %s rejection without retrying",
    async (event) => {
      const {network, chain, updateStatus, logger} = await fixture(async () => {});
      const error = new Error("status admission refused");
      const failed = Promise.reject(error);
      void failed.catch(() => {});
      updateStatus.mockReturnValue(failed);
      const log = vi.spyOn(logger, LogLevel.error).mockImplementation(() => {});
      try {
        const [listener] = EventEmitter.prototype.listeners.call(chain.emitter, event) as (() => Promise<void>)[];
        await expect(listener()).resolves.toBeUndefined();
        expect(updateStatus).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledWith("Error updating network status", {}, error);
      } finally {
        await network.close();
      }
    }
  );

  it("handles custody rejection without retrying or changing the count", async () => {
    const {network, chain, setTargetGroupCount, logger} = await fixture(async () => {});
    const error = new Error("custody admission refused");
    const failed = Promise.reject(error);
    void failed.catch(() => {});
    setTargetGroupCount.mockReturnValue(failed);
    const log = vi.spyOn(logger, LogLevel.error).mockImplementation(() => {});
    try {
      const [listener] = chain.emitter.listeners(ChainEvent.updateTargetCustodyGroupCount);
      await expect(listener(12)).resolves.toBeUndefined();
      expect(setTargetGroupCount).toHaveBeenCalledExactlyOnceWith(12);
      expect(log).toHaveBeenCalledWith("Error updating network custody group count", {count: 12}, error);
    } finally {
      await network.close();
    }
  });

  it("handles a synchronous status failure", async () => {
    const {network, chain, updateStatus, logger} = await fixture(async () => {});
    const error = new Error("status construction failed");
    chain.getStatus.mockImplementation(() => {
      throw error;
    });
    const log = vi.spyOn(logger, LogLevel.error).mockImplementation(() => {});
    try {
      const [listener] = chain.emitter.listeners(ChainEvent.updateStatus);
      await expect(listener()).resolves.toBeUndefined();
      expect(updateStatus).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith("Error updating network status", {}, error);
    } finally {
      await network.close();
    }
  });
});
