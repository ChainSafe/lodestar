import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {CheckpointWithHex, ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {defer, fromHex} from "@lodestar/utils";
import {BeaconChain} from "../../../src/chain/chain.js";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";
import {generateProtoBlock, generateSignedBlockAtSlot} from "../../utils/typeGenerator.js";

describe("BeaconChain finalized_checkpoint event", () => {
  const rootHex = `0x${"aa".repeat(32)}`;
  const stateRoot = `0x${"bb".repeat(32)}`;
  const cp: CheckpointWithHex = {epoch: 2, root: fromHex(rootHex), rootHex};

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function onForkChoiceFinalized(finalizedBlock: ProtoBlock | null, custodyUpdate = Promise.resolve()) {
    const emitter = new ChainEventEmitter();
    const events: routes.events.EventData[routes.events.EventType.finalizedCheckpoint][] = [];
    emitter.on(routes.events.EventType.finalizedCheckpoint, (data) => {
      events.push(data);
    });
    const chain = {
      emitter,
      logger: getMockedLogger(),
      metrics: {finalizedEpoch: {set: vi.fn()}},
      forkChoice: {
        getBlockHexDefaultStatus: vi.fn().mockReturnValue(finalizedBlock),
        getHead: vi.fn().mockReturnValue(generateProtoBlock()),
      },
      seenBlockProposers: {prune: vi.fn()},
      updateValidatorsCustodyRequirement: vi.fn().mockReturnValue(custodyUpdate),
      regen: {getStateSync: vi.fn().mockReturnValue(null)},
      getBlockByRoot: vi.fn().mockResolvedValue({block: generateSignedBlockAtSlot(0)}),
    };

    const completed = BeaconChain.prototype["onForkChoiceFinalized"].call(chain as unknown as BeaconChain, cp);
    return {events, chain, completed};
  }

  it("emits the finalized block root and state root on the next event loop", async () => {
    const {events, completed} = onForkChoiceFinalized(
      generateProtoBlock({blockRoot: rootHex, stateRoot, executionStatus: ExecutionStatus.Valid})
    );

    expect(events).toHaveLength(0);
    await completed;
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([{block: rootHex, epoch: cp.epoch, state: stateRoot, executionOptimistic: false}]);
  });

  it("flags execution optimistic when the finalized block is still syncing", async () => {
    const {events, completed} = onForkChoiceFinalized(
      generateProtoBlock({blockRoot: rootHex, stateRoot, executionStatus: ExecutionStatus.Syncing})
    );

    await completed;
    await vi.advanceTimersByTimeAsync(1);
    expect(events[0]?.executionOptimistic).toBe(true);
  });

  it("continues finalization without emitting when the finalized block is unknown", async () => {
    const {events, chain, completed} = onForkChoiceFinalized(null);

    await completed;
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toHaveLength(0);
    expect(chain.metrics.finalizedEpoch.set).toHaveBeenCalledWith(cp.epoch);
    expect(chain.seenBlockProposers.prune).toHaveBeenCalledOnce();
    expect(chain.updateValidatorsCustodyRequirement).toHaveBeenCalledWith(cp);
    expect(chain.getBlockByRoot).toHaveBeenCalledOnce();
  });

  it("emits without waiting for the custody update", async () => {
    const {promise, resolve} = defer<void>();
    const {events, chain, completed} = onForkChoiceFinalized(
      generateProtoBlock({blockRoot: rootHex, stateRoot, executionStatus: ExecutionStatus.Valid}),
      promise
    );

    try {
      expect(events).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual([{block: rootHex, epoch: cp.epoch, state: stateRoot, executionOptimistic: false}]);
      expect(chain.getBlockByRoot).not.toHaveBeenCalled();
    } finally {
      resolve();
      await completed;
    }
  });
});
