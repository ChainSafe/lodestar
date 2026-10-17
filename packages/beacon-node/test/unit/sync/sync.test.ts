import {afterEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {defer} from "@lodestar/utils";
import {NetworkEventBus} from "../../../src/network/events.js";
import {INetwork} from "../../../src/network/interface.js";
import {SyncState} from "../../../src/sync/interface.js";
import {BeaconSync} from "../../../src/sync/sync.js";
import {ClockEvent} from "../../../src/util/clock.js";
import {ClockStopped} from "../../mocks/clock.js";
import {getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {getMockedBeaconDb} from "../../mocks/mockedBeaconDb.js";

vi.mock("../../../src/sync/range/range.js");
vi.mock("../../../src/sync/unknownBlock.js");

function fixture() {
  const config = createBeaconConfig(defaultConfig, new Uint8Array(32));
  const clock = new ClockStopped(10 * SLOTS_PER_EPOCH);
  const chain = {...getMockedBeaconChain({config}), clock};
  chain.forkChoice.getHead.mockReturnValue({slot: 0} as ReturnType<typeof chain.forkChoice.getHead>);
  const state = vi.spyOn(BeaconSync.prototype, "state", "get").mockReturnValue(SyncState.Synced);
  let applied = false;
  const pending: {target: boolean; completion: ReturnType<typeof defer<void>>}[] = [];
  const request = (target: boolean): Promise<void> => {
    const completion = defer<void>();
    pending.push({target, completion});
    return completion.promise;
  };
  const network = {
    events: new NetworkEventBus(),
    isSubscribedToGossipCoreTopics: () => applied,
    subscribeGossipCoreTopics: vi.fn(() => request(true)),
    unsubscribeGossipCoreTopics: vi.fn(() => request(false)),
  } satisfies Pick<
    INetwork,
    "events" | "isSubscribedToGossipCoreTopics" | "subscribeGossipCoreTopics" | "unsubscribeGossipCoreTopics"
  >;
  const sync = new BeaconSync(
    {},
    {
      config,
      chain,
      network: network as unknown as INetwork,
      logger: chain.logger,
      metrics: null,
      db: getMockedBeaconDb(),
    }
  );
  const update = (synced: boolean): void => {
    state.mockReturnValue(synced ? SyncState.Synced : SyncState.Stalled);
    clock.emit(ClockEvent.epoch, clock.currentEpoch);
  };
  const complete = async (index: number, failure?: Error): Promise<void> => {
    const item = pending[index];
    if (failure) item.completion.reject(failure);
    else {
      applied = item.target;
      item.completion.resolve();
    }
    await Promise.resolve();
  };
  return {sync, update, complete, pending, network, logger: chain.logger};
}

describe("sync gossip subscriptions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests unsubscribe when sync falls behind during a pending subscribe", async () => {
    const node = fixture();
    try {
      node.update(true);
      node.update(true);
      node.update(false);
      expect(node.pending.map(({target}) => target)).toEqual([true, false]);
      await node.complete(0);
      expect(node.logger.info).not.toHaveBeenCalledWith("Subscribed gossip core topics");
      await node.complete(1);
      expect(node.network.isSubscribedToGossipCoreTopics()).toBe(false);
      expect(node.logger.info).toHaveBeenCalledExactlyOnceWith("Un-subscribed gossip core topics");
    } finally {
      node.sync.close();
    }
  });

  it("ignores superseded completions and retries the current target after failure", async () => {
    const node = fixture();
    try {
      node.update(true);
      node.update(false);
      node.update(true);
      expect(node.pending.map(({target}) => target)).toEqual([true, false, true]);
      await node.complete(0);
      await node.complete(1);
      expect(node.logger.info).not.toHaveBeenCalled();
      const failure = new Error("subscription failed");
      await node.complete(2, failure);
      expect(node.logger.error).toHaveBeenCalledExactlyOnceWith("Error subscribing to gossip core topics", {}, failure);
      node.update(true);
      expect(node.pending).toHaveLength(4);
      await node.complete(3);
      expect(node.logger.info).toHaveBeenCalledExactlyOnceWith("Subscribed gossip core topics");
    } finally {
      node.sync.close();
    }
  });

  it("does not announce a subscription completion after close", async () => {
    const node = fixture();
    node.update(true);
    node.sync.close();
    await node.complete(0);
    expect(node.logger.info).not.toHaveBeenCalled();
  });
});
