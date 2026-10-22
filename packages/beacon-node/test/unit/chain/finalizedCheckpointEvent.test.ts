import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {RootHex} from "@lodestar/types";
import {defer, fromHex} from "@lodestar/utils";
import {FinalizedCheckpointSnapshot} from "../../../src/chain/beaconEngine/interface.js";
import {BeaconChain} from "../../../src/chain/chain.js";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";

describe("BeaconChain finalized_checkpoint event", () => {
  const rootHex = `0x${"aa".repeat(32)}`;
  const stateRoot = `0x${"bb".repeat(32)}`;
  const cp: FinalizedCheckpointSnapshot & {rootHex: RootHex} = {
    epoch: 2,
    root: fromHex(rootHex),
    rootHex,
    slot: 63,
    stateRoot: fromHex(stateRoot),
    executionOptimistic: false,
    blockSnapshot: {canonical: [], nonCanonical: []},
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function onForkChoiceFinalized(checkpoint = cp, custodyUpdate = Promise.resolve()) {
    const emitter = new ChainEventEmitter();
    const events: routes.events.EventData[routes.events.EventType.finalizedCheckpoint][] = [];
    emitter.on(routes.events.EventType.finalizedCheckpoint, (data) => {
      events.push(data);
    });
    const chain = {
      emitter,
      logger: getMockedLogger(),
      metrics: {finalizedEpoch: {set: vi.fn()}},
      beaconEngine: {pruneOnFinalized: vi.fn().mockResolvedValue(undefined)},
      updateValidatorsCustodyRequirement: vi.fn().mockReturnValue(custodyUpdate),
    };

    const completed = BeaconChain.prototype["onForkChoiceFinalized"].call(chain as unknown as BeaconChain, checkpoint);
    return {events, chain, completed};
  }

  it("emits the pulled checkpoint data on the next event loop without another read", async () => {
    const {events, chain, completed} = onForkChoiceFinalized();
    expect(events).toHaveLength(0);
    await completed;
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([{block: rootHex, epoch: cp.epoch, state: stateRoot, executionOptimistic: false}]);
    expect(chain.metrics.finalizedEpoch.set).toHaveBeenCalledWith(cp.epoch);
    expect(chain.updateValidatorsCustodyRequirement).toHaveBeenCalledWith({
      epoch: cp.epoch,
      root: cp.root,
      rootHex: cp.rootHex,
    });
    expect(chain.beaconEngine.pruneOnFinalized).toHaveBeenCalledOnce();
  });

  it("preserves pulled metadata until deferred delivery", async () => {
    const checkpoint = {...cp, stateRoot: cp.stateRoot.slice(), executionOptimistic: true};
    const {events, completed} = onForkChoiceFinalized(checkpoint);
    checkpoint.stateRoot.fill(0);
    checkpoint.executionOptimistic = false;
    await completed;
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([{block: rootHex, epoch: cp.epoch, state: stateRoot, executionOptimistic: true}]);
  });

  it("emits without waiting for the custody update", async () => {
    const {promise, resolve} = defer<void>();
    const {events, chain, completed} = onForkChoiceFinalized(cp, promise);
    try {
      expect(events).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual([{block: rootHex, epoch: cp.epoch, state: stateRoot, executionOptimistic: false}]);
      expect(chain.beaconEngine.pruneOnFinalized).not.toHaveBeenCalled();
    } finally {
      resolve();
      await completed;
    }
    expect(chain.beaconEngine.pruneOnFinalized).toHaveBeenCalledOnce();
  });
});
