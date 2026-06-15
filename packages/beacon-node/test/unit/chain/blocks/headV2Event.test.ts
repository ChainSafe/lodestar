import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ExecutionStatus, IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {toApiPayloadStatus} from "../../../../src/chain/blocks/importBlock.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {config} from "../../../utils/blocksAndData.js";

const {EventType} = routes.events;

const blockRoot = "0xaabb";

function protoBlock(slot: number, payloadStatus: PayloadStatus): ProtoBlock {
  return {
    slot,
    blockRoot,
    parentRoot: blockRoot,
    stateRoot: blockRoot,
    targetRoot: blockRoot,
    justifiedEpoch: 0,
    justifiedRoot: blockRoot,
    finalizedEpoch: 0,
    finalizedRoot: blockRoot,
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: blockRoot,
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: blockRoot,
    timeliness: false,
    executionPayloadBlockHash: null,
    executionStatus: ExecutionStatus.Valid,
    dataAvailabilityStatus: DataAvailabilityStatus.Available,
    payloadStatus,
    parentBlockHash: null,
  };
}

function emitHeadV2(
  emitter: ChainEventEmitter,
  cache: Map<RootHex, {status: PayloadStatus; slot: number}>,
  head: ProtoBlock,
  forkChoice: Pick<IForkChoice, "getDependentRoot">
): void {
  if (
    !cache.has(blockRoot) ||
    (cache.get(blockRoot)?.status !== PayloadStatus.FULL && head.payloadStatus === PayloadStatus.FULL)
  ) {
    emitter.emit(EventType.headV2, {
      version: config.getForkName(head.slot),
      data: {
        slot: head.slot,
        block: head.blockRoot,
        state: head.stateRoot,
        payloadStatus: toApiPayloadStatus(head.payloadStatus),
        epochTransition: false,
        currentEpochDependentRoot: forkChoice.getDependentRoot(head, 0 as any),
        nextEpochDependentRoot: forkChoice.getDependentRoot(head, 1 as any),
        executionOptimistic: false,
      },
    });
    cache.set(head.blockRoot, {status: head.payloadStatus, slot: head.slot});
  }
}

describe("head_v2 event emission", () => {
  let emitter: ChainEventEmitter;
  let cache: Map<RootHex, {status: PayloadStatus; slot: number}>;
  let forkChoice: Pick<IForkChoice, "getDependentRoot">;
  const slot = 10;

  beforeEach(() => {
    emitter = new ChainEventEmitter();
    cache = new Map();
    forkChoice = {
      getDependentRoot: vi.fn().mockReturnValue("0x1234"),
    };
  });

  it("emits head_v2 with empty on first import", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    emitter.on(EventType.headV2, (data) => events.push(data));

    const head = protoBlock(slot, PayloadStatus.EMPTY);
    emitHeadV2(emitter, cache, head, forkChoice);

    expect(events).toHaveLength(1);
    expect(events[0].data.payloadStatus).toBe("empty");
  });

  it("emits head_v2 with full on empty→full transition", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    emitter.on(EventType.headV2, (data) => events.push(data));

    // First emission: empty
    const emptyHead = protoBlock(slot, PayloadStatus.EMPTY);
    emitHeadV2(emitter, cache, emptyHead, forkChoice);

    // Second emission: full
    const fullHead = protoBlock(slot, PayloadStatus.FULL);
    emitHeadV2(emitter, cache, fullHead, forkChoice);

    expect(events).toHaveLength(2);
    expect(events[0].data.payloadStatus).toBe("empty");
    expect(events[1].data.payloadStatus).toBe("full");
  });

  it("does not re-emit on empty→empty (no second emission)", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    emitter.on(EventType.headV2, (data) => events.push(data));

    const emptyHead = protoBlock(slot, PayloadStatus.EMPTY);
    emitHeadV2(emitter, cache, emptyHead, forkChoice);

    // Attempt second emission with still-empty status
    const stillEmptyHead = protoBlock(slot, PayloadStatus.EMPTY);
    emitHeadV2(emitter, cache, stillEmptyHead, forkChoice);

    expect(events).toHaveLength(1);
    expect(events[0].data.payloadStatus).toBe("empty");
  });

  it("does not re-emit on full→full", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    emitter.on(EventType.headV2, (data) => events.push(data));

    const fullHead = protoBlock(slot, PayloadStatus.FULL);
    emitHeadV2(emitter, cache, fullHead, forkChoice);

    // Attempt second emission with full status
    emitHeadV2(emitter, cache, fullHead, forkChoice);

    expect(events).toHaveLength(1);
    expect(events[0].data.payloadStatus).toBe("full");
  });
});
