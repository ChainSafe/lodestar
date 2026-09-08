import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {CheckpointWithHex, ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {fromHex} from "@lodestar/utils";
import {BeaconChain} from "../../../src/chain/chain.js";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

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

  function emitFinalizedCheckpointEvent(
    finalizedBlock: ProtoBlock | null
  ): routes.events.EventData[routes.events.EventType.finalizedCheckpoint][] {
    const emitter = new ChainEventEmitter();
    const events: routes.events.EventData[routes.events.EventType.finalizedCheckpoint][] = [];
    emitter.on(routes.events.EventType.finalizedCheckpoint, (data) => {
      events.push(data);
    });
    const chain = {
      emitter,
      logger: getMockedLogger(),
      forkChoice: {getBlockHexDefaultStatus: vi.fn().mockReturnValue(finalizedBlock)},
    } as unknown as BeaconChain;

    BeaconChain.prototype["emitFinalizedCheckpointEvent"].call(chain, cp);
    return events;
  }

  it("emits the finalized block root and state root on the next event loop", async () => {
    const events = emitFinalizedCheckpointEvent(
      generateProtoBlock({blockRoot: rootHex, stateRoot, executionStatus: ExecutionStatus.Valid})
    );

    expect(events).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([{block: rootHex, epoch: cp.epoch, state: stateRoot, executionOptimistic: false}]);
  });

  it("flags execution optimistic when the finalized block is still syncing", async () => {
    const events = emitFinalizedCheckpointEvent(
      generateProtoBlock({blockRoot: rootHex, stateRoot, executionStatus: ExecutionStatus.Syncing})
    );

    await vi.advanceTimersByTimeAsync(1);
    expect(events[0]?.executionOptimistic).toBe(true);
  });

  it("does not emit when the finalized block is unknown to fork choice", async () => {
    const events = emitFinalizedCheckpointEvent(null);

    await vi.advanceTimersByTimeAsync(1);
    expect(events).toHaveLength(0);
  });
});
