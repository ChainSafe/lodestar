import {describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {BeaconChain} from "../../../src/chain/chain.js";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {ForkchoiceCaller} from "../../../src/chain/forkChoice/index.js";
import {ZERO_HASH_HEX} from "../../../src/constants/constants.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

type HeadEvent = routes.events.EventData[routes.events.EventType.head];
type HeadV2Event = routes.events.EventData[routes.events.EventType.headV2];

describe("BeaconChain head events", () => {
  const headA = generateProtoBlock({
    slot: 10,
    blockRoot: `0x${"aa".repeat(32)}`,
    stateRoot: `0x${"a1".repeat(32)}`,
    payloadStatus: PayloadStatus.FULL,
  });
  const headB = generateProtoBlock({
    slot: 11,
    blockRoot: `0x${"bb".repeat(32)}`,
    stateRoot: `0x${"b1".repeat(32)}`,
    payloadStatus: PayloadStatus.FULL,
  });

  /**
   * Fake chain whose fork choice swaps its head to `headAfterUpdate` inside `updateTime()` or `updateAndGetHead()`,
   * mirroring the head being recomputed inside fork choice without the caller being told.
   */
  function setup(
    initialHead: ProtoBlock,
    headAfterUpdate: ProtoBlock
  ): {chain: BeaconChain; headEvents: HeadEvent[]; headV2Events: HeadV2Event[]} {
    let currentHead = initialHead;
    const emitter = new ChainEventEmitter();
    const headEvents: HeadEvent[] = [];
    const headV2Events: HeadV2Event[] = [];
    emitter.on(routes.events.EventType.head, (data) => {
      headEvents.push(data);
    });
    emitter.on(routes.events.EventType.headV2, (data) => {
      headV2Events.push(data);
    });

    const prune = {prune: vi.fn()};
    const onSlot = {onSlot: vi.fn()};
    // Real prototype so the methods under test can reach `emitHeadEvents()`, fake state for everything else
    const chain: BeaconChain = Object.assign(Object.create(BeaconChain.prototype), {
      config,
      emitter,
      logger: getMockedLogger(),
      opts: {},
      forkChoice: {
        getHead: vi.fn(() => currentHead),
        getDependentRoot: vi.fn().mockReturnValue(ZERO_HASH_HEX),
        updateTime: vi.fn(() => {
          currentHead = headAfterUpdate;
        }),
        updateAndGetHead: vi.fn(() => {
          currentHead = headAfterUpdate;
          return {head: currentHead};
        }),
      },
      attestationPool: prune,
      aggregatedAttestationPool: prune,
      syncCommitteeMessagePool: prune,
      seenSyncCommitteeMessages: prune,
      payloadAttestationPool: prune,
      executionPayloadBidPool: prune,
      seenExecutionPayloadBids: prune,
      proposerPreferencesPool: prune,
      seenAttestationDatas: onSlot,
      reprocessController: onSlot,
      blockProductionCache: new Map(),
    });

    return {chain, headEvents, headV2Events};
  }

  describe("onClockSlot", () => {
    it("emits head and head_v2 when updateTime() moves the head", () => {
      const {chain, headEvents, headV2Events} = setup(headA, headB);

      chain["onClockSlot"](headB.slot);

      expect(headEvents.map((e) => e.block)).toEqual([headB.blockRoot]);
      expect(headV2Events.map((e) => e.data.block)).toEqual([headB.blockRoot]);
    });

    it("emits nothing when updateTime() leaves the head unchanged", () => {
      const {chain, headEvents, headV2Events} = setup(headA, headA);

      chain["onClockSlot"](headA.slot + 1);

      expect(headEvents).toHaveLength(0);
      expect(headV2Events).toHaveLength(0);
    });
  });

  describe("recomputeForkChoiceHead", () => {
    it("emits head and head_v2 when the head root changes", () => {
      const {chain, headEvents, headV2Events} = setup(headA, headB);

      const head = chain.recomputeForkChoiceHead(ForkchoiceCaller.prepareNextSlot);

      expect(head).toBe(headB);
      expect(headEvents).toEqual([
        {
          block: headB.blockRoot,
          slot: headB.slot,
          state: headB.stateRoot,
          epochTransition: false,
          previousDutyDependentRoot: ZERO_HASH_HEX,
          currentDutyDependentRoot: ZERO_HASH_HEX,
          executionOptimistic: false,
        },
      ]);
      expect(headV2Events.map((e) => e.data.block)).toEqual([headB.blockRoot]);
    });

    it("emits only head_v2 when just the payload status changes", () => {
      const headAEmpty = {...headA, payloadStatus: PayloadStatus.EMPTY};
      const {chain, headEvents, headV2Events} = setup(headAEmpty, headA);

      chain.recomputeForkChoiceHead(ForkchoiceCaller.prepareNextSlot);

      expect(headEvents).toHaveLength(0);
      expect(headV2Events.map((e) => e.data.payloadStatus)).toEqual(["full"]);
    });

    it("emits nothing when the head is unchanged", () => {
      const {chain, headEvents, headV2Events} = setup(headA, headA);

      chain.recomputeForkChoiceHead(ForkchoiceCaller.prepareNextSlot);

      expect(headEvents).toHaveLength(0);
      expect(headV2Events).toHaveLength(0);
    });
  });
});
