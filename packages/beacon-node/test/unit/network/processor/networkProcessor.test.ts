import {Mock, beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName, GENESIS_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {IBeaconDb} from "../../../../src/db/interface.js";
import {NetworkEvent, NetworkEventBus} from "../../../../src/network/events.js";
import {GossipType} from "../../../../src/network/gossip/interface.js";
import {
  MAX_AWAITING_MESSAGES_PER_ROOT,
  MAX_BUFFERED_ROOTS_PER_SLOT,
  MAX_SEARCHED_ROOTS_PER_SLOT,
  NetworkProcessor,
  NetworkProcessorModules,
} from "../../../../src/network/processor/index.js";
import {PendingGossipsubMessage} from "../../../../src/network/processor/types.js";
import {PeerIdStr} from "../../../../src/util/peerId.js";
import {ClockStopped} from "../../../mocks/clock.js";

// per-(root, topic) message caps, read from the source so the tests track the real limits
const MAX_BID_PER_ROOT = MAX_AWAITING_MESSAGES_PER_ROOT[GossipType.execution_payload_bid] as number;
const MAX_EXECUTION_PAYLOAD_PER_ROOT = MAX_AWAITING_MESSAGES_PER_ROOT[GossipType.execution_payload] as number;
const MAX_DATA_COLUMN_PER_ROOT = MAX_AWAITING_MESSAGES_PER_ROOT[GossipType.data_column_sidecar] as number;

// When a gossip message points at a block we don't have yet, we hold the message and look the block up.
// A malicious peer could flood us with messages pointing at blocks that will never arrive, so we put two
// limits in place: how much we're willing to hold in memory, and how many block lookups we'll start.
// These tests exercise both limits, and check that a real block is still recovered when an attacker floods.
describe("NetworkProcessor: handling gossip that points at an unknown block", () => {
  const clockSlot = 1000;
  const peerIdStr = "16Uiu2HAmTestGossipPeer" as PeerIdStr;

  let processor: NetworkProcessor;
  let emitter: ChainEventEmitter;
  let unknownBlockRootSpy: Mock<(data: unknown) => void>;

  beforeEach(() => {
    emitter = new ChainEventEmitter();
    unknownBlockRootSpy = vi.fn();
    // the unknown-root search (recovery signal to BlockInputSync) is emitted here - our observable surface
    emitter.on(ChainEvent.unknownBlockRoot, (data) => unknownBlockRootSpy(data));

    const chain = {
      clock: new ClockStopped(clockSlot),
      emitter,
      forkChoice: {
        hasBlockHexUnsafe: vi.fn().mockReturnValue(false),
        hasPayloadHexUnsafe: vi.fn().mockReturnValue(false),
        getBlockHexAndBlockHash: vi.fn().mockReturnValue(undefined),
        getBlockHexDefaultStatus: vi.fn().mockReturnValue(null),
      },
      seenBlock: vi.fn().mockReturnValue(false),
      seenPayloadEnvelope: vi.fn().mockReturnValue(false),
    } as unknown as IBeaconChain;

    const modules = {
      chain,
      db: null as unknown as IBeaconDb,
      events: new NetworkEventBus(),
      config,
      logger: {debug: vi.fn(), verbose: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()},
      metrics: null,
      gossipHandlers: {},
    } as unknown as NetworkProcessorModules;

    processor = new NetworkProcessor(modules, {});
  });

  function emit(topicType: GossipType, fork: ForkName, data: Uint8Array): void {
    (processor as unknown as {events: NetworkEventBus}).events.emit(NetworkEvent.pendingGossipsubMessage, {
      topic: {type: topicType, boundary: {fork, epoch: GENESIS_EPOCH}},
      msg: {data},
      msgId: "id",
      propagationSource: peerIdStr,
      clientAgent: "",
      clientVersion: "",
      seenTimestampSec: 0,
      startProcessUnixSec: null,
    } as unknown as PendingGossipsubMessage);
  }

  /** An aggregate that votes for a different unknown block per `rootByte` (each becomes a distinct unknown block). */
  function processAggregate(rootByte: number): void {
    const signedAggregateAndProof = ssz.phase0.SignedAggregateAndProof.defaultValue();
    signedAggregateAndProof.message.aggregate.data.slot = clockSlot;
    signedAggregateAndProof.message.aggregate.data.beaconBlockRoot = Buffer.alloc(32, rootByte);
    const data = ssz.phase0.SignedAggregateAndProof.serialize(signedAggregateAndProof);
    emit(GossipType.beacon_aggregate_and_proof, ForkName.phase0, data);
  }

  /** Competing bids from different builders, all for the same unknown block (they pile up under one block). */
  function processBid(builderIndex: number): void {
    const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    signedBid.message.slot = clockSlot;
    signedBid.message.builderIndex = builderIndex;
    signedBid.message.parentBlockRoot = Buffer.alloc(32, 0xaa);
    signedBid.message.parentBlockHash = Buffer.alloc(32, 0xbb);
    const data = ssz.gloas.SignedExecutionPayloadBid.serialize(signedBid);
    emit(GossipType.execution_payload_bid, ForkName.gloas, data);
  }

  /** Data column messages (one per column index), all for the same unknown block. */
  function processDataColumn(index: number, rootByte = 0xcc): void {
    const sidecar = ssz.gloas.DataColumnSidecar.defaultValue();
    sidecar.index = index;
    sidecar.slot = clockSlot;
    sidecar.beaconBlockRoot = Buffer.alloc(32, rootByte);
    const data = ssz.gloas.DataColumnSidecar.serialize(sidecar);
    emit(GossipType.data_column_sidecar, ForkName.gloas, data);
  }

  /** An execution payload for an unknown block (there is only ever one payload per block). */
  function processExecutionPayload(rootByte = 0xdd): void {
    const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signedEnvelope.message.payload.slotNumber = clockSlot;
    signedEnvelope.message.beaconBlockRoot = Buffer.alloc(32, rootByte);
    const data = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(signedEnvelope);
    emit(GossipType.execution_payload, ForkName.gloas, data);
  }

  function bufferedBlockCount(): number {
    return (processor as unknown as {awaitingBlockMessageCount: number}).awaitingBlockMessageCount;
  }

  describe("how many unknown blocks we hold messages for, per slot", () => {
    it("stops holding messages once too many different blocks are unknown in the same slot", () => {
      for (let i = 1; i <= MAX_BUFFERED_ROOTS_PER_SLOT + 1; i++) {
        processAggregate(i);
      }
      // we hold messages for at most 5 unknown blocks per slot; messages for the 6th block are dropped,
      // so a flood of fake blocks can't grow our memory without bound
      expect(bufferedBlockCount()).toBe(MAX_BUFFERED_ROOTS_PER_SLOT);
    });

    it("still holds another message for a block we are already waiting on", () => {
      for (let i = 1; i <= MAX_BUFFERED_ROOTS_PER_SLOT; i++) {
        processAggregate(i);
      }
      expect(bufferedBlockCount()).toBe(MAX_BUFFERED_ROOTS_PER_SLOT);
      // the limit counts distinct unknown blocks, not messages: a second message for a block we already
      // wait on is still held, even though we're at the block limit
      processAggregate(1);
      expect(bufferedBlockCount()).toBe(MAX_BUFFERED_ROOTS_PER_SLOT + 1);
    });

    it("keeps looking up a real block even after it stops holding messages for it", () => {
      for (let i = 1; i <= MAX_BUFFERED_ROOTS_PER_SLOT + 1; i++) {
        processAggregate(i);
      }
      // an attacker can fill the 5 hold slots with fake blocks first; the 6th (real) block is no longer
      // held, but we still look it up by root, so it can be fetched and the node recovers
      expect(unknownBlockRootSpy).toHaveBeenCalledTimes(MAX_BUFFERED_ROOTS_PER_SLOT + 1);
    });
  });

  describe("how many messages we hold for a single unknown block", () => {
    it("holds only a limited number of execution payload bids for one block", () => {
      for (let i = 0; i < MAX_BID_PER_ROOT + 3; i++) {
        processBid(i);
      }
      // there can be several competing bids for the same block, but we stop holding them after the limit
      expect(bufferedBlockCount()).toBe(MAX_BID_PER_ROOT);
    });

    it("holds a limited number of data column messages for one block", () => {
      for (let i = 0; i < MAX_DATA_COLUMN_PER_ROOT + 3; i++) {
        processDataColumn(i);
      }
      // a block has NUMBER_OF_COLUMNS genuine columns; we allow twice that so malformed front-runners
      // can't push genuine columns out (a missing column would block import), then stop
      expect(bufferedBlockCount()).toBe(MAX_DATA_COLUMN_PER_ROOT);
    });

    it("holds a limited number of execution payloads for one block", () => {
      for (let i = 0; i < MAX_EXECUTION_PAYLOAD_PER_ROOT + 2; i++) {
        processExecutionPayload();
      }
      // a block has exactly one genuine payload; we keep one extra slot so a malformed front-runner
      // doesn't push the genuine payload out, then drop further messages
      expect(bufferedBlockCount()).toBe(MAX_EXECUTION_PAYLOAD_PER_ROOT);
    });
  });

  describe("how many unknown blocks we look up by root, per slot", () => {
    it("stops looking up new blocks once too many are unknown in the same slot", () => {
      for (let i = 1; i <= MAX_SEARCHED_ROOTS_PER_SLOT + 1; i++) {
        processAggregate(i);
      }
      // the lookup limit is higher than the hold limit (so real blocks past the hold limit still recover),
      // but it's still bounded, so a flood can't make us start unlimited lookups
      expect(unknownBlockRootSpy).toHaveBeenCalledTimes(MAX_SEARCHED_ROOTS_PER_SLOT);
    });

    it("looks up a block only once, no matter how many messages point at it", () => {
      processAggregate(1);
      processAggregate(1); // another message for the same unknown block
      expect(unknownBlockRootSpy).toHaveBeenCalledTimes(1);
      // the repeated message triggers no extra lookup, but is still held
      expect(bufferedBlockCount()).toBe(2);
    });
  });
});
