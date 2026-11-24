import {TopicValidatorResult} from "@libp2p/gossipsub";
import {Mock, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {BUILDER_INDEX_SELF_BUILD, ForkName, GENESIS_EPOCH, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ISignatureSet} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {MapDef, byteArrayEquals} from "@lodestar/utils";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {GossipErrorCode} from "../../../../src/chain/errors/gossipValidation.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {computeSubnetForDataColumnSidecar} from "../../../../src/chain/validation/dataColumnSidecar.js";
import {IBeaconDb} from "../../../../src/db/interface.js";
import {NetworkEvent, NetworkEventBus} from "../../../../src/network/events.js";
import {GossipType} from "../../../../src/network/gossip/interface.js";
import {PeerAction} from "../../../../src/network/peers/score/interface.js";
import {
  MAX_AWAITING_MESSAGES_PER_ROOT,
  MAX_BUFFERED_ROOTS_PER_SLOT,
  MAX_EARLY_ENVELOPES,
  MAX_SEARCHED_ROOTS_PER_SLOT,
  MAX_UNKNOWN_ROOTS_SLOT_CACHE_SIZE,
  NetworkProcessor,
  NetworkProcessorModules,
} from "../../../../src/network/processor/index.js";
import {PendingGossipsubMessage} from "../../../../src/network/processor/types.js";
import {PeerIdStr} from "../../../../src/util/peerId.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {generateBlockWithColumnSidecars} from "../../../utils/blocksAndData.js";

// per-(root, topic) message caps, read from the source so the tests track the real limits
const MAX_BID_PER_ROOT = MAX_AWAITING_MESSAGES_PER_ROOT[GossipType.execution_payload_bid] as number;
const MAX_DATA_COLUMN_PER_ROOT = MAX_AWAITING_MESSAGES_PER_ROOT[GossipType.data_column_sidecar] as number;

// When a gossip message points at a block we don't have yet, we hold the message and look the block up.
// A malicious peer could flood us with messages pointing at blocks that will never arrive, so we put two
// limits in place: how much we're willing to hold in memory, and how many block lookups we'll start.
// These tests exercise both limits, and check that a real block is still recovered when an attacker floods.
const PARENT_ROOT_HEX = `0x${"aa".repeat(32)}`;
const VALID_SIGNATURE = Buffer.alloc(96, 0x01);
const SEEN_BLOCK_MAX_TRANSACTIONS = 2;

describe("NetworkProcessor: handling gossip that points at an unknown block", () => {
  const clockSlot = 1000;
  const peerIdStr = "16Uiu2HAmTestGossipPeer" as PeerIdStr;

  let processor: NetworkProcessor;
  let emitter: ChainEventEmitter;
  let unknownBlockRootSpy: Mock<(data: unknown) => void>;
  let unknownEnvelopeBlockRootSpy: Mock<(data: unknown) => void>;
  let unknownEnvelopeBlockRootSlotSpy: Mock<(data: unknown) => void>;
  let reportPeerSpy: Mock<(peer: PeerIdStr, action: PeerAction, actionName: string) => void>;
  let seenBlocks: Map<string, gloas.SignedBeaconBlock>;
  let headRoot: string;

  beforeEach(() => {
    emitter = new ChainEventEmitter();
    unknownBlockRootSpy = vi.fn();
    unknownEnvelopeBlockRootSpy = vi.fn();
    unknownEnvelopeBlockRootSlotSpy = vi.fn();
    reportPeerSpy = vi.fn();
    seenBlocks = new Map();
    headRoot = PARENT_ROOT_HEX;
    // the unknown-root search (recovery signal to BlockInputSync) is emitted here - our observable surface
    emitter.on(ChainEvent.unknownBlockRoot, (data) => unknownBlockRootSpy(data));
    emitter.on(ChainEvent.unknownEnvelopeBlockRoot, (data) => unknownEnvelopeBlockRootSpy(data));
    emitter.on(ChainEvent.unknownEnvelopeBlockRootSlot, (data) => unknownEnvelopeBlockRootSlotSpy(data));

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
      // blocks that passed gossip validation but are not imported yet
      seenBlockInputCache: {
        get: (root: string) => {
          const block = seenBlocks.get(root);
          return block && {hasBlock: () => true, forkName: ForkName.gloas, getBlock: () => block};
        },
      },
    } as unknown as IBeaconChain;
    Object.assign(chain, {
      config: createBeaconConfig(config, Buffer.alloc(32, 0x01)),
      getHeadState: () => ({forkName: ForkName.gloas}),
      bls: {
        verifySignatureSets: async (sets: ISignatureSet[]) => byteArrayEquals(sets[0].signature, VALID_SIGNATURE),
      },
    });
    Object.assign(chain.forkChoice, {getHead: () => ({blockRoot: headRoot})});

    const modules = {
      chain,
      core: {reportPeer: reportPeerSpy},
      db: null as unknown as IBeaconDb,
      events: new NetworkEventBus(),
      config,
      logger: {debug: vi.fn(), verbose: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()},
      metrics: null,
      gossipHandlers: {},
    } as unknown as NetworkProcessorModules;

    processor = new NetworkProcessor(modules, {});
  });

  function emit(topicType: GossipType, fork: ForkName, data: Uint8Array, peer = peerIdStr, subnet?: number): void {
    (processor as unknown as {events: NetworkEventBus}).events.emit(NetworkEvent.pendingGossipsubMessage, {
      topic: {type: topicType, boundary: {fork, epoch: GENESIS_EPOCH}, subnet},
      msg: {data},
      msgId: "id",
      propagationSource: peer,
      clientAgent: "",
      clientVersion: "",
      seenTimestampSec: 0,
      startProcessUnixSec: null,
    } as unknown as PendingGossipsubMessage);
  }

  /** An aggregate that votes for a different unknown block per `rootByte` (each becomes a distinct unknown block). */
  function processAggregate(rootByte: number, slot = clockSlot): void {
    const signedAggregateAndProof = ssz.phase0.SignedAggregateAndProof.defaultValue();
    signedAggregateAndProof.message.aggregate.data.slot = slot;
    signedAggregateAndProof.message.aggregate.data.beaconBlockRoot = Buffer.alloc(32, rootByte);
    const data = ssz.phase0.SignedAggregateAndProof.serialize(signedAggregateAndProof);
    emit(GossipType.beacon_aggregate_and_proof, ForkName.phase0, data);
  }

  /** A gloas aggregate voting that the payload of the unknown block is present (index = 1). */
  function processGloasAggregatePayloadPresent(rootByte: number, slot = clockSlot): void {
    const signedAggregateAndProof = ssz.gloas.SignedAggregateAndProof.defaultValue();
    signedAggregateAndProof.message.aggregate.data.slot = slot;
    signedAggregateAndProof.message.aggregate.data.beaconBlockRoot = Buffer.alloc(32, rootByte);
    signedAggregateAndProof.message.aggregate.data.index = 1;
    const data = ssz.gloas.SignedAggregateAndProof.serialize(signedAggregateAndProof);
    emit(GossipType.beacon_aggregate_and_proof, ForkName.gloas, data);
  }

  /** A PTC vote that the payload of the unknown block is present. */
  function processPayloadAttestationMessage(rootByte = 0xee): void {
    const payloadAttestationMessage = ssz.gloas.PayloadAttestationMessage.defaultValue();
    payloadAttestationMessage.data.slot = clockSlot;
    payloadAttestationMessage.data.beaconBlockRoot = Buffer.alloc(32, rootByte);
    payloadAttestationMessage.data.payloadPresent = true;
    const data = ssz.gloas.PayloadAttestationMessage.serialize(payloadAttestationMessage);
    emit(GossipType.payload_attestation_message, ForkName.gloas, data);
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
  function processExecutionPayload(rootByte = 0xdd, peer = peerIdStr): void {
    const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signedEnvelope.message.payload.slotNumber = clockSlot;
    signedEnvelope.message.beaconBlockRoot = Buffer.alloc(32, rootByte);
    const data = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(signedEnvelope);
    emit(GossipType.execution_payload, ForkName.gloas, data, peer);
  }

  /** peers whose envelopes we hold for the unknown block `rootByte`, in arrival order */
  function heldEnvelopePeers(rootByte: number): PeerIdStr[] {
    const messages = (
      processor as unknown as {
        awaitingMessagesByBlockRoot: MapDef<string, MapDef<GossipType, Set<PendingGossipsubMessage>>>;
      }
    ).awaitingMessagesByBlockRoot
      .get(`0x${rootByte.toString(16).padStart(2, "0").repeat(32)}`)
      ?.get(GossipType.execution_payload);
    return Array.from(messages ?? [], (message) => message.propagationSource);
  }

  /** A block for root `rootByte` that passed gossip validation but is not imported, self-built on PARENT_ROOT_HEX */
  function seeBlock(rootByte: number): void {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = clockSlot;
    block.message.parentRoot = Buffer.from(PARENT_ROOT_HEX.slice(2), "hex");
    const bid = block.message.body.signedExecutionPayloadBid.message;
    bid.builderIndex = BUILDER_INDEX_SELF_BUILD;
    bid.blockHash = Buffer.alloc(32, 0x11);
    bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(ssz.gloas.ExecutionRequests.defaultValue());
    bid.gasLimit = BigInt(SEEN_BLOCK_MAX_TRANSACTIONS * config.MIN_TRANSACTION_GAS);
    seenBlocks.set(`0x${rootByte.toString(16).padStart(2, "0").repeat(32)}`, block);
  }

  /** A self-built envelope matching the bid of seeBlock(rootByte), unless overridden */
  function processSeenBlockEnvelope(
    rootByte: number,
    peer: PeerIdStr,
    opts: {signature?: Uint8Array; blockHash?: Uint8Array; builderIndex?: number; transactionCount?: number} = {}
  ): void {
    const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signedEnvelope.message.payload.slotNumber = clockSlot;
    signedEnvelope.message.payload.blockHash = opts.blockHash ?? Buffer.alloc(32, 0x11);
    signedEnvelope.message.builderIndex = opts.builderIndex ?? BUILDER_INDEX_SELF_BUILD;
    signedEnvelope.message.payload.gasLimit = SEEN_BLOCK_MAX_TRANSACTIONS * config.MIN_TRANSACTION_GAS;
    const transactionCount = opts.transactionCount ?? 0;
    // one-byte transactions: offsets first, then the bytes
    const transactions = new Uint8Array(5 * transactionCount);
    for (let i = 0; i < transactionCount; i++) {
      new DataView(transactions.buffer).setUint32(4 * i, 4 * transactionCount + i, true);
    }
    signedEnvelope.message.payload.transactions = ssz.gloas.Transactions.deserialize(transactions);
    signedEnvelope.message.beaconBlockRoot = Buffer.alloc(32, rootByte);
    signedEnvelope.message.parentBeaconBlockRoot = Buffer.from(PARENT_ROOT_HEX.slice(2), "hex");
    signedEnvelope.signature = opts.signature ?? VALID_SIGNATURE;
    emit(
      GossipType.execution_payload,
      ForkName.gloas,
      ssz.gloas.SignedExecutionPayloadEnvelope.serialize(signedEnvelope),
      peer
    );
  }

  function verifiedEarlyEnvelopes(): Map<string, PendingGossipsubMessage> {
    return (processor as unknown as {verifiedEarlyEnvelopes: Map<string, PendingGossipsubMessage>})
      .verifiedEarlyEnvelopes;
  }

  /** let the async signature check of an envelope for a seen block finish */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function bufferedBlockCount(): number {
    return (processor as unknown as {awaitingBlockMessageCount: number}).awaitingBlockMessageCount;
  }

  function bufferedPayloadCount(): number {
    return (processor as unknown as {awaitingPayloadMessageCount: number}).awaitingPayloadMessageCount;
  }

  /** number of distinct block roots we currently hold messages for */
  function distinctBlockRoots(): number {
    return (processor as unknown as {awaitingMessagesByBlockRoot: {size: number}}).awaitingMessagesByBlockRoot.size;
  }

  function lastEnvelopeSearch(): {slot?: number; peer?: PeerIdStr} | undefined {
    return unknownEnvelopeBlockRootSpy.mock.calls.at(-1)?.[0] as {slot?: number; peer?: PeerIdStr} | undefined;
  }

  function lastEnvelopeSlotSearch(): {slot?: number; peer?: PeerIdStr} | undefined {
    return unknownEnvelopeBlockRootSlotSpy.mock.calls.at(-1)?.[0] as {slot?: number; peer?: PeerIdStr} | undefined;
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

    it("does not let a repeated block sneak past the hold limit (sending each block twice)", () => {
      // an over-limit block's first message is looked up but not held, which leaves it "tracked". The bug:
      // a second message for that same block would then be treated as already-held and slip into the buffer,
      // letting an attacker hold messages for far more than 5 blocks by sending each one twice.
      const blocks = 10;
      for (let i = 1; i <= blocks; i++) {
        processAggregate(i);
        processAggregate(i); // same block again
      }
      // still only 5 distinct blocks are held, no matter how many times each is repeated
      expect(distinctBlockRoots()).toBe(MAX_BUFFERED_ROOTS_PER_SLOT);
    });

    it("applies the per-slot hold limit only to slots we have not expired yet", () => {
      // we accept messages up to 32 slots old, but expire held messages after a few slots. Holding messages
      // for an already expired slot would give each of those old slots its own 5-block budget
      let rootByte = 1;
      for (let slot = clockSlot - 32; slot <= clockSlot; slot++) {
        for (let i = 0; i < MAX_BUFFERED_ROOTS_PER_SLOT; i++) {
          processAggregate(rootByte++, slot);
        }
      }
      expect(distinctBlockRoots()).toBe(MAX_UNKNOWN_ROOTS_SLOT_CACHE_SIZE * MAX_BUFFERED_ROOTS_PER_SLOT);
    });

    it("does not hold messages waiting on an unknown payload from an already expired slot", () => {
      processGloasAggregatePayloadPresent(1, clockSlot - MAX_UNKNOWN_ROOTS_SLOT_CACHE_SIZE);
      // the payload is still looked up, the message is just not held
      expect(unknownEnvelopeBlockRootSpy).toHaveBeenCalledTimes(1);
      expect(bufferedPayloadCount()).toBe(0);

      processGloasAggregatePayloadPresent(2, clockSlot - MAX_UNKNOWN_ROOTS_SLOT_CACHE_SIZE + 1);
      expect(bufferedPayloadCount()).toBe(1);
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
  });

  // An envelope can arrive before its block, and until the block is known anyone can send one claiming any root.
  // Junk must not be able to keep the real envelope out of the buffer.
  describe("execution payload envelopes that arrive before their block", () => {
    const attacker = "16Uiu2HAmAttacker" as PeerIdStr;
    const honest = "16Uiu2HAmHonest" as PeerIdStr;

    it("holds the real envelope after one peer sent junk for the same block", () => {
      processExecutionPayload(0xdd, attacker);
      processExecutionPayload(0xdd, attacker);
      processExecutionPayload(0xdd, honest);
      expect(heldEnvelopePeers(0xdd)).toEqual([attacker, honest]);
    });

    it("holds the real envelope after junk for other blocks filled the slot's root budget", () => {
      for (let i = 1; i <= MAX_BUFFERED_ROOTS_PER_SLOT; i++) {
        processAggregate(i);
        processExecutionPayload(0x10 + i, attacker);
      }
      processExecutionPayload(0xdd, honest);
      expect(heldEnvelopePeers(0xdd)).toEqual([honest]);
    });

    it("evicts the oldest envelope when full, so pushing one out takes that many peers sending after it", () => {
      for (let i = 0; i < MAX_EARLY_ENVELOPES; i++) {
        processExecutionPayload(0x10, `16Uiu2HAmEarly${i}` as PeerIdStr);
      }
      processExecutionPayload(0xdd, honest);
      expect(bufferedBlockCount()).toBe(MAX_EARLY_ENVELOPES);
      expect(heldEnvelopePeers(0x10)).not.toContain("16Uiu2HAmEarly0");

      for (let i = 0; i < MAX_EARLY_ENVELOPES - 1; i++) {
        processExecutionPayload(0x20, `16Uiu2HAmLate${i}` as PeerIdStr);
      }
      expect(heldEnvelopePeers(0xdd)).toEqual([honest]);
      processExecutionPayload(0x20, "16Uiu2HAmLateLast" as PeerIdStr);
      expect(heldEnvelopePeers(0xdd)).toEqual([]);
      expect(bufferedBlockCount()).toBe(MAX_EARLY_ENVELOPES);
    });

    it("holds one envelope per peer per clock slot", () => {
      processExecutionPayload(0x10, attacker);
      processExecutionPayload(0x20, attacker);
      expect(bufferedBlockCount()).toBe(1);

      (processor as unknown as {onClockSlot: (slot: number) => void}).onClockSlot(clockSlot + 1);
      processExecutionPayload(0x20, attacker);
      expect(bufferedBlockCount()).toBe(2);
    });

    it("frees the entries of envelopes released by a block import or expired", () => {
      const pushSpy = vi
        .spyOn(
          processor as unknown as {pushPendingGossipsubMessageToQueue: () => void},
          "pushPendingGossipsubMessageToQueue"
        )
        .mockImplementation(() => {});
      const earlyEnvelopes = (processor as unknown as {earlyEnvelopes: Map<PendingGossipsubMessage, string>})
        .earlyEnvelopes;
      processExecutionPayload(0xdd, honest);
      processExecutionPayload(0xee, attacker);

      emitter.emit(routes.events.EventType.block, {
        slot: clockSlot,
        block: `0x${"dd".repeat(32)}`,
        executionOptimistic: false,
      });
      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(earlyEnvelopes.size).toBe(1);

      (processor as unknown as {onClockSlot: (slot: number) => void}).onClockSlot(
        clockSlot + MAX_UNKNOWN_ROOTS_SLOT_CACHE_SIZE
      );
      expect(earlyEnvelopes.size).toBe(0);
      expect(bufferedBlockCount()).toBe(0);
    });
  });

  // An envelope can arrive while its block passed gossip validation but is still being imported. The block's bid
  // tells the real envelope apart from junk, so junk that arrived first cannot keep it out of the buffer.
  describe("execution payload envelopes for a block that is seen but not imported", () => {
    const attacker = "16Uiu2HAmAttacker" as PeerIdStr;
    const honest = "16Uiu2HAmHonest" as PeerIdStr;
    const rootHex = `0x${"dd".repeat(32)}`;

    it("holds the real envelope outside a full early envelope queue, and releases it on import", async () => {
      for (let i = 0; i < MAX_EARLY_ENVELOPES; i++) {
        processExecutionPayload(0x10, `16Uiu2HAmEarly${i}` as PeerIdStr);
      }
      seeBlock(0xdd);
      processSeenBlockEnvelope(0xdd, honest);
      await settle();
      expect(verifiedEarlyEnvelopes().get(rootHex)?.propagationSource).toBe(honest);
      // nothing was evicted for it
      expect(heldEnvelopePeers(0x10)).toHaveLength(MAX_EARLY_ENVELOPES);

      const pushSpy = vi
        .spyOn(
          processor as unknown as {pushPendingGossipsubMessageToQueue: () => void},
          "pushPendingGossipsubMessageToQueue"
        )
        .mockImplementation(() => {});
      emitter.emit(routes.events.EventType.block, {slot: clockSlot, block: rootHex, executionOptimistic: false});
      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(verifiedEarlyEnvelopes().size).toBe(0);
    });

    it("rejects an envelope that does not match the bid before it takes a buffer slot", async () => {
      seeBlock(0xdd);
      processSeenBlockEnvelope(0xdd, attacker, {blockHash: Buffer.alloc(32, 0x22)});
      await settle();
      expect(reportPeerSpy).toHaveBeenCalledWith(
        attacker,
        PeerAction.LowToleranceError,
        "EXECUTION_PAYLOAD_ENVELOPE_ERROR_BLOCK_HASH_MISMATCH"
      );
      expect(bufferedBlockCount()).toBe(0);
    });

    it("rejects a self-built envelope with a bad signature as Fatal", async () => {
      seeBlock(0xdd);
      processSeenBlockEnvelope(0xdd, attacker, {signature: Buffer.alloc(96, 0x02)});
      await settle();
      expect(reportPeerSpy).toHaveBeenCalledWith(
        attacker,
        PeerAction.Fatal,
        "EXECUTION_PAYLOAD_ENVELOPE_ERROR_INVALID_SIGNATURE"
      );
      expect(bufferedBlockCount()).toBe(0);
      expect(verifiedEarlyEnvelopes().size).toBe(0);
    });

    it("checks one envelope per peer per clock slot, further ones go to the early envelope queue", async () => {
      seeBlock(0xdd);
      processSeenBlockEnvelope(0xdd, attacker, {signature: Buffer.alloc(96, 0x02)});
      processSeenBlockEnvelope(0xdd, attacker, {signature: Buffer.alloc(96, 0x03)});
      await settle();
      expect(reportPeerSpy).toHaveBeenCalledTimes(1);
      expect(heldEnvelopePeers(0xdd)).toEqual([attacker]);
    });

    it("does not check an envelope with more transactions than the bid's gas limit allows", async () => {
      seeBlock(0xdd);
      processSeenBlockEnvelope(0xdd, attacker, {
        signature: Buffer.alloc(96, 0x02),
        transactionCount: SEEN_BLOCK_MAX_TRANSACTIONS + 1,
      });
      await settle();
      expect(reportPeerSpy).not.toHaveBeenCalled();
      expect(heldEnvelopePeers(0xdd)).toEqual([attacker]);
    });

    it("falls back to the buffer caps if the builder's key cannot be read because the head is not the parent", async () => {
      headRoot = `0x${"bb".repeat(32)}`;
      seeBlock(0xdd);
      const bid = seenBlocks.get(rootHex)?.message.body.signedExecutionPayloadBid.message;
      if (bid) bid.builderIndex = 3;
      processSeenBlockEnvelope(0xdd, honest, {builderIndex: 3});
      await settle();
      expect(reportPeerSpy).not.toHaveBeenCalled();
      expect(verifiedEarlyEnvelopes().size).toBe(0);
      expect(bufferedBlockCount()).toBe(1);
    });
  });

  // Columns can also arrive while their block passed gossip validation but is still being imported. They are checked
  // against the block's bid, so junk that arrived first cannot keep them out of the buffer.
  describe("data columns for a block that is seen but not imported", () => {
    const attacker = "16Uiu2HAmAttacker" as PeerIdStr;
    const honest = "16Uiu2HAmHonest" as PeerIdStr;
    const {block, rootHex, columnSidecars} = generateBlockWithColumnSidecars({
      forkName: ForkName.gloas,
      slot: clockSlot,
    });
    const columns = columnSidecars as gloas.DataColumnSidecar[];

    function processColumn(column: gloas.DataColumnSidecar, peer: PeerIdStr): void {
      const subnet = computeSubnetForDataColumnSidecar(config, column);
      emit(GossipType.data_column_sidecar, ForkName.gloas, ssz.gloas.DataColumnSidecar.serialize(column), peer, subnet);
    }

    function verifiedEarlyColumns(): Map<string, Map<number, PendingGossipsubMessage>> {
      return (processor as unknown as {verifiedEarlyColumns: Map<string, Map<number, PendingGossipsubMessage>>})
        .verifiedEarlyColumns;
    }

    beforeEach(() => {
      seenBlocks.set(rootHex, block as gloas.SignedBeaconBlock);
    });

    it("holds real columns after junk filled the slot's root budget, and releases them on import", async () => {
      for (let i = 1; i <= MAX_BUFFERED_ROOTS_PER_SLOT; i++) {
        processAggregate(i);
      }
      processColumn(columns[0], honest);
      processColumn(columns[1], honest);
      await vi.waitFor(() => expect(verifiedEarlyColumns().get(rootHex)?.size).toBe(2));

      const pushSpy = vi
        .spyOn(
          processor as unknown as {pushPendingGossipsubMessageToQueue: () => void},
          "pushPendingGossipsubMessageToQueue"
        )
        .mockImplementation(() => {});
      emitter.emit(routes.events.EventType.block, {slot: clockSlot, block: rootHex, executionOptimistic: false});
      expect(pushSpy).toHaveBeenCalledTimes(2);
      expect(verifiedEarlyColumns().size).toBe(0);
    });

    it("rejects a column that fails the KZG check before it takes a buffer slot", async () => {
      const junk = ssz.gloas.DataColumnSidecar.clone(columns[0]);
      junk.kzgProofs = junk.kzgProofs.map((proof) => proof.map((b) => b ^ 1));
      processColumn(junk, attacker);
      await vi.waitFor(() =>
        expect(reportPeerSpy).toHaveBeenCalledWith(
          attacker,
          PeerAction.LowToleranceError,
          "DATA_COLUMN_SIDECAR_ERROR_INVALID_KZG_PROOF"
        )
      );
      expect(bufferedBlockCount()).toBe(0);
      expect(verifiedEarlyColumns().size).toBe(0);
    });

    it("sends columns past the per-peer check budget to the buffer caps unchecked", async () => {
      (processor as unknown as {earlyColumnChecksByPeer: Map<PeerIdStr, number>}).earlyColumnChecksByPeer.set(
        attacker,
        NUMBER_OF_COLUMNS
      );
      const junk = ssz.gloas.DataColumnSidecar.clone(columns[0]);
      junk.kzgProofs = junk.kzgProofs.map((proof) => proof.map((b) => b ^ 1));
      processColumn(junk, attacker);
      await settle();
      expect(reportPeerSpy).not.toHaveBeenCalled();
      expect(bufferedBlockCount()).toBe(1);
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

    it("does not give an older slot a fresh lookup budget on the next slot", () => {
      const oldSlot = clockSlot - 5;
      for (let i = 1; i <= MAX_SEARCHED_ROOTS_PER_SLOT; i++) {
        processAggregate(i, oldSlot);
      }
      expect(unknownBlockRootSpy).toHaveBeenCalledTimes(MAX_SEARCHED_ROOTS_PER_SLOT);

      // gossip still accepts messages for the slot, so its budget must not start over
      (processor as unknown as {onClockSlot: (slot: number) => void}).onClockSlot(clockSlot + 1);
      for (let i = MAX_SEARCHED_ROOTS_PER_SLOT + 1; i <= 2 * MAX_SEARCHED_ROOTS_PER_SLOT; i++) {
        processAggregate(i, oldSlot);
      }
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

  describe("which envelope lookups carry the payload slot", () => {
    it("carries the slot, and no peer, when the message slot is the payload's slot", () => {
      // optimistic search: the forwarding peer may not have the payload, so no peer is attached
      processPayloadAttestationMessage();
      expect(unknownEnvelopeBlockRootSpy).not.toHaveBeenCalled();
      expect(unknownEnvelopeBlockRootSlotSpy).toHaveBeenCalledTimes(1);
      expect(lastEnvelopeSlotSearch()).toMatchObject({slot: clockSlot, peer: undefined});

      unknownEnvelopeBlockRootSlotSpy.mockClear();
      processDataColumn(0, 0xcf);
      expect(unknownEnvelopeBlockRootSpy).not.toHaveBeenCalled();
      expect(unknownEnvelopeBlockRootSlotSpy).toHaveBeenCalledTimes(1);
      expect(lastEnvelopeSlotSearch()).toMatchObject({slot: clockSlot, peer: undefined});
    });

    it("carries no slot when the message slot is not necessarily the payload's slot", () => {
      processGloasAggregatePayloadPresent(0xdf);
      expect(unknownEnvelopeBlockRootSlotSpy).not.toHaveBeenCalled();
      expect(unknownEnvelopeBlockRootSpy).toHaveBeenCalledTimes(1);
      expect(lastEnvelopeSearch()).toEqual(expect.not.objectContaining({slot: expect.anything()}));
    });

    it("still emits the payload slot once when a slot-less lookup started the search", () => {
      // aggregate (no slot) first, PTC vote (payload slot) second, both for the same root
      processGloasAggregatePayloadPresent(0xef);
      expect(unknownEnvelopeBlockRootSpy).toHaveBeenCalledTimes(1);

      processPayloadAttestationMessage(0xef);
      expect(unknownEnvelopeBlockRootSlotSpy).toHaveBeenCalledTimes(1);
      expect(lastEnvelopeSlotSearch()).toMatchObject({slot: clockSlot});

      // the payload slot is emitted only once per root
      processPayloadAttestationMessage(0xef);
      expect(unknownEnvelopeBlockRootSlotSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("messages whose slot does not fit in 32 bits", () => {
    let validationResultSpy: Mock<(data: unknown) => void>;

    beforeEach(() => {
      validationResultSpy = vi.fn();
      (processor as unknown as {events: NetworkEventBus}).events.on(
        NetworkEvent.gossipMessageValidationResult,
        (data) => validationResultSpy(data)
      );
    });

    it("rejects a block before any processing", () => {
      const data = ssz.phase0.SignedBeaconBlock.serialize(ssz.phase0.SignedBeaconBlock.defaultValue());
      // slot is at byte 100 (4-byte message offset + 96-byte signature), set one of its high 4 bytes
      data[100 + 4] = 1;
      emit(GossipType.beacon_block, ForkName.phase0, data);
      expect(validationResultSpy).toHaveBeenCalledWith(
        expect.objectContaining({propagationSource: peerIdStr, acceptance: TopicValidatorResult.Reject})
      );
      expect(reportPeerSpy).toHaveBeenCalledWith(peerIdStr, PeerAction.LowToleranceError, GossipErrorCode.INVALID_SLOT);
    });

    it("rejects an aggregate without looking up its unknown block", () => {
      const signedAggregateAndProof = ssz.phase0.SignedAggregateAndProof.defaultValue();
      signedAggregateAndProof.message.aggregate.data.slot = 2 ** 32;
      signedAggregateAndProof.message.aggregate.data.beaconBlockRoot = Buffer.alloc(32, 0xab);
      emit(
        GossipType.beacon_aggregate_and_proof,
        ForkName.phase0,
        ssz.phase0.SignedAggregateAndProof.serialize(signedAggregateAndProof)
      );
      expect(validationResultSpy).toHaveBeenCalledWith(
        expect.objectContaining({acceptance: TopicValidatorResult.Reject})
      );
      expect(unknownBlockRootSpy).not.toHaveBeenCalled();
      expect(bufferedBlockCount()).toBe(0);
    });
  });

  describe("expiring old unknown blocks", () => {
    type Entry = {blockPeerIds?: Set<string>; envelopePeerIds?: Set<string>};
    type Internals = {
      searchedRootsBySlot: MapDef<number, MapDef<string, Entry>>;
      bufferedRootsBySlot: MapDef<number, Set<string>>;
      awaitingMessagesByBlockRoot: MapDef<string, MapDef<GossipType, Set<PendingGossipsubMessage>>>;
      awaitingMessagesByPayloadBlockRoot: MapDef<string, MapDef<GossipType, Set<PendingGossipsubMessage>>>;
      awaitingBlockMessageCount: number;
      awaitingPayloadMessageCount: number;
      onClockSlot: (slot: number) => void;
    };

    it("expiring a block wait for one block does not drop a newer payload wait for the same block", () => {
      // a block may be waited on at one slot and, later (after the block arrives), its payload waited on from a
      // newer slot. Expiring the old slot must not also drop the newer payload wait just because they share the block
      const p = processor as unknown as Internals;
      const root = `0x${"ab".repeat(32)}`;
      const oldSlot = clockSlot - 4; // expires this tick (<= clockSlot - MAX_UNKNOWN_ROOTS_SLOT_CACHE_SIZE)
      const newSlot = clockSlot; //     must survive
      const message = (msgSlot: number): PendingGossipsubMessage =>
        ({
          topic: {type: GossipType.beacon_aggregate_and_proof},
          seenTimestampSec: 0,
          msgSlot,
        }) as unknown as PendingGossipsubMessage;

      // old slot: a message waiting for the block
      p.bufferedRootsBySlot.getOrDefault(oldSlot).add(root);
      p.awaitingMessagesByBlockRoot
        .getOrDefault(root)
        .getOrDefault(GossipType.beacon_aggregate_and_proof)
        .add(message(oldSlot));
      p.awaitingBlockMessageCount++;

      // newer slot: a message waiting for the payload of the SAME block
      p.bufferedRootsBySlot.getOrDefault(newSlot).add(root);
      p.awaitingMessagesByPayloadBlockRoot
        .getOrDefault(root)
        .getOrDefault(GossipType.beacon_aggregate_and_proof)
        .add(message(newSlot));
      p.awaitingPayloadMessageCount++;

      p.onClockSlot(clockSlot);

      // the old block wait is expired
      expect(p.awaitingMessagesByBlockRoot.has(root)).toBe(false);
      expect(p.awaitingBlockMessageCount).toBe(0);
      // the newer payload wait survives - it belongs to a slot that hasn't expired
      expect(p.awaitingMessagesByPayloadBlockRoot.has(root)).toBe(true);
      expect(p.awaitingPayloadMessageCount).toBe(1);
    });

    it("expires only the old messages of a payload wait held across two slots", () => {
      const p = processor as unknown as Internals;
      const root = `0x${"cd".repeat(32)}`;
      const oldSlot = clockSlot - 4;
      const newSlot = clockSlot;
      for (const msgSlot of [oldSlot, newSlot]) {
        p.bufferedRootsBySlot.getOrDefault(msgSlot).add(root);
        p.awaitingMessagesByPayloadBlockRoot
          .getOrDefault(root)
          .getOrDefault(GossipType.beacon_aggregate_and_proof)
          .add({
            topic: {type: GossipType.beacon_aggregate_and_proof},
            seenTimestampSec: 0,
            msgSlot,
          } as unknown as PendingGossipsubMessage);
        p.awaitingPayloadMessageCount++;
      }

      p.onClockSlot(clockSlot);

      expect(p.awaitingPayloadMessageCount).toBe(1);
      expect(p.awaitingMessagesByPayloadBlockRoot.get(root)?.get(GossipType.beacon_aggregate_and_proof)?.size).toBe(1);
    });

    it("expires a held message even when its block was never looked up", () => {
      // the per-slot lookup budget is larger than the hold budget, so lookups can run out while holds remain.
      // A message held without a lookup must still expire with its slot
      const p = processor as unknown as Internals;
      for (let i = 0; i < MAX_SEARCHED_ROOTS_PER_SLOT; i++) {
        p.searchedRootsBySlot.getOrDefault(clockSlot).getOrDefault(`0x${i}`).blockPeerIds = new Set();
      }

      processExecutionPayload(0xdd);
      expect(unknownBlockRootSpy).not.toHaveBeenCalled();
      expect(bufferedBlockCount()).toBe(1);

      p.onClockSlot(clockSlot + 3);
      expect(bufferedBlockCount()).toBe(0);
    });
  });

  describe("tryReserveBufferedRoot", () => {
    function reserve(slot: number, root: string): boolean {
      return (
        processor as unknown as {tryReserveBufferedRoot: (slot: number, root: string) => boolean}
      ).tryReserveBufferedRoot(slot, root);
    }

    it("reserves up to MAX_BUFFERED_ROOTS_PER_SLOT distinct roots per slot, then refuses new ones", () => {
      for (let i = 0; i < MAX_BUFFERED_ROOTS_PER_SLOT; i++) {
        expect(reserve(clockSlot, `0x0${i}`)).toBe(true);
      }
      // budget full -> a new root is refused
      expect(reserve(clockSlot, "0xnew")).toBe(false);
    });

    it("is idempotent: an already-reserved root stays allowed and never consumes a second slot", () => {
      for (let i = 0; i < MAX_BUFFERED_ROOTS_PER_SLOT; i++) {
        expect(reserve(clockSlot, `0x0${i}`)).toBe(true);
      }
      // re-reserving existing roots any number of times is still allowed and doesn't overflow the budget
      expect(reserve(clockSlot, "0x00")).toBe(true);
      expect(reserve(clockSlot, "0x00")).toBe(true);
      // ...and a genuinely new root is still refused (the repeats didn't free or take extra slots)
      expect(reserve(clockSlot, "0xnew")).toBe(false);
    });

    it("budgets each slot independently", () => {
      for (let i = 0; i < MAX_BUFFERED_ROOTS_PER_SLOT; i++) {
        expect(reserve(clockSlot, `0x0${i}`)).toBe(true);
      }
      expect(reserve(clockSlot, "0xover")).toBe(false);
      // a different slot has its own budget
      expect(reserve(clockSlot + 1, "0xover")).toBe(true);
    });
  });
});
