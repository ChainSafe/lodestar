import {beforeEach, describe, expect, it} from "vitest";
import {routes} from "@lodestar/api";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {emitHeadV2} from "../../../../src/chain/blocks/headV2Event.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";

const {EventType} = routes.events;

const blockRoot1 = "0xaabb";
const blockRoot2 = "0xbbcc";

function protoBlock(blockRoot: string, slot: number, payloadStatus: PayloadStatus): ProtoBlock {
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

describe("head_v2 event emission", () => {
  let chain: MockedBeaconChain;
  const slot = 10;

  beforeEach(() => {
    chain = getMockedBeaconChain();
    chain.headV2PayloadStatusCache = new Map();
    chain.forkChoice.getDependentRoot.mockReturnValue("0x1234");
  });

  it("emits head_v2 with empty on first import", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    chain.emitter.on(EventType.headV2, (data) => events.push(data));

    emitHeadV2.call(chain, protoBlock(blockRoot1, slot, PayloadStatus.EMPTY), true);

    expect(events).toHaveLength(1);
    expect(events[0].data.payloadStatus).toBe("empty");
  });

  it("emits head_v2 with full on empty→full transition", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    chain.emitter.on(EventType.headV2, (data) => events.push(data));

    emitHeadV2.call(chain, protoBlock(blockRoot1, slot, PayloadStatus.EMPTY), true);
    emitHeadV2.call(chain, protoBlock(blockRoot1, slot, PayloadStatus.FULL), false);

    expect(events).toHaveLength(2);
    expect(events[0].data.payloadStatus).toBe("empty");
    expect(events[1].data.payloadStatus).toBe("full");
  });

  it("does not re-emit on empty→empty", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    chain.emitter.on(EventType.headV2, (data) => events.push(data));

    emitHeadV2.call(chain, protoBlock(blockRoot1, slot, PayloadStatus.EMPTY), true);
    emitHeadV2.call(chain, protoBlock(blockRoot1, slot, PayloadStatus.EMPTY), false);

    expect(events).toHaveLength(1);
    expect(events[0].data.payloadStatus).toBe("empty");
  });

  it("does not re-emit on full→full", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    chain.emitter.on(EventType.headV2, (data) => events.push(data));

    emitHeadV2.call(chain, protoBlock(blockRoot1, slot, PayloadStatus.FULL), true);
    emitHeadV2.call(chain, protoBlock(blockRoot1, slot, PayloadStatus.FULL), false);

    expect(events).toHaveLength(1);
    expect(events[0].data.payloadStatus).toBe("full");
  });

  it("re-emits on head change to already-cached root (reorg)", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    chain.emitter.on(EventType.headV2, (data) => events.push(data));

    emitHeadV2.call(chain, protoBlock(blockRoot1, slot, PayloadStatus.FULL), true);
    emitHeadV2.call(chain, protoBlock(blockRoot2, slot, PayloadStatus.FULL), true);
    emitHeadV2.call(chain, protoBlock(blockRoot1, slot, PayloadStatus.FULL), true);

    expect(events).toHaveLength(3);
    expect(events[0].data.payloadStatus).toBe("full");
  });
});
