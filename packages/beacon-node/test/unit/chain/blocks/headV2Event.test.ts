import {beforeEach, describe, expect, it} from "vitest";
import {routes} from "@lodestar/api";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {emitHeadV2} from "../../../../src/chain/blocks/headV2Event.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";

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

    emitHeadV2.call(chain, protoBlock(slot, PayloadStatus.EMPTY));

    expect(events).toHaveLength(1);
    expect(events[0].data.payloadStatus).toBe("empty");
  });

  it("emits head_v2 with full on empty→full transition", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    chain.emitter.on(EventType.headV2, (data) => events.push(data));

    emitHeadV2.call(chain, protoBlock(slot, PayloadStatus.EMPTY));
    emitHeadV2.call(chain, protoBlock(slot, PayloadStatus.FULL));

    expect(events).toHaveLength(2);
    expect(events[0].data.payloadStatus).toBe("empty");
    expect(events[1].data.payloadStatus).toBe("full");
  });

  it("does not re-emit on empty→empty", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    chain.emitter.on(EventType.headV2, (data) => events.push(data));

    emitHeadV2.call(chain, protoBlock(slot, PayloadStatus.EMPTY));
    emitHeadV2.call(chain, protoBlock(slot, PayloadStatus.EMPTY));

    expect(events).toHaveLength(1);
    expect(events[0].data.payloadStatus).toBe("empty");
  });

  it("does not re-emit on full→full", () => {
    const events: routes.events.EventData[typeof EventType.headV2][] = [];
    chain.emitter.on(EventType.headV2, (data) => events.push(data));

    emitHeadV2.call(chain, protoBlock(slot, PayloadStatus.FULL));
    emitHeadV2.call(chain, protoBlock(slot, PayloadStatus.FULL));

    expect(events).toHaveLength(1);
    expect(events[0].data.payloadStatus).toBe("full");
  });
});
