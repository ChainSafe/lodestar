import {Mock, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {PayloadStatus} from "@lodestar/fork-choice";
import {BUILDER_INDEX_SELF_BUILD, BYTES_PER_CELL, ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {DataColumnSidecar, RootHex, gloas, ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {revealSelfBuiltPayload} from "../../../../src/chain/blocks/revealSelfBuiltPayload.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {BlockType, ProduceFullGloas, ProduceResult} from "../../../../src/chain/produceBlock/index.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("chain / blocks / revealSelfBuiltPayload", () => {
  const slot = 5;
  const parentBlockRoot = Buffer.alloc(32, 0x11);

  let blockProductionCache: Map<RootHex, ProduceResult>;
  let payloadInputs: Map<RootHex, PayloadEnvelopeInput>;
  /** Roots of blocks in fork choice, and of those whose payload is imported */
  let importedBlocks: Set<RootHex>;
  let importedPayloads: Set<RootHex>;
  let emitter: ChainEventEmitter;
  let onPublishEnvelope: Mock<(envelope: gloas.ExecutionPayloadEnvelope) => void>;
  let onPublishDataColumns: Mock<(sidecars: DataColumnSidecar[]) => void>;
  let onExecutionPayloadGossip: Mock<
    (data: routes.events.EventData[routes.events.EventType.executionPayloadGossip]) => void
  >;
  let processExecutionPayload: ReturnType<typeof vi.fn>;
  let persistExecutionPayloadEnvelope: ReturnType<typeof vi.fn>;
  let chain: BeaconChain;

  beforeEach(() => {
    blockProductionCache = new Map();
    payloadInputs = new Map();
    importedBlocks = new Set();
    importedPayloads = new Set();
    emitter = new ChainEventEmitter();
    onPublishEnvelope = vi.fn();
    onPublishDataColumns = vi.fn();
    onExecutionPayloadGossip = vi.fn();
    emitter.on(ChainEvent.publishExecutionPayloadEnvelope, onPublishEnvelope);
    emitter.on(ChainEvent.publishDataColumns, onPublishDataColumns);
    emitter.on(routes.events.EventType.executionPayloadGossip, onExecutionPayloadGossip);
    processExecutionPayload = vi.fn().mockResolvedValue(undefined);
    persistExecutionPayloadEnvelope = vi.fn();

    chain = {
      blockProductionCache,
      revealedSelfBuiltPayloads: new Set<RootHex>(),
      seenPayloadEnvelopeInputCache: {get: (rootHex: RootHex) => payloadInputs.get(rootHex)},
      forkChoice: {
        hasBlockHex: (rootHex: RootHex) => importedBlocks.has(rootHex),
        getBlockHex: (rootHex: RootHex, payloadStatus: PayloadStatus) =>
          payloadStatus === PayloadStatus.FULL && importedPayloads.has(rootHex) ? {} : null,
      },
      emitter,
      logger: getMockedLogger(),
      opts: {},
      processExecutionPayload,
      persistExecutionPayloadEnvelope,
    } as unknown as BeaconChain;
  });

  /**
   * A block as it is known to the node once it was published through the API or received on gossip: its
   * PayloadEnvelopeInput is seeded. If `selfBuilt`, the node also holds the payload it produced for it.
   */
  function addBlock({selfBuilt, blobs = 0}: {selfBuilt: boolean; blobs?: number}): {
    blockRootHex: RootHex;
    payloadInput: PayloadEnvelopeInput;
    produceResult: ProduceFullGloas;
  } {
    const payload = ssz.gloas.ExecutionPayload.defaultValue();
    payload.slotNumber = slot;
    payload.blockHash = Buffer.alloc(32, 0x22);
    const executionRequests = ssz.gloas.ExecutionRequests.defaultValue();
    const blobsBundle = ssz.gloas.BlobsBundle.defaultValue();
    blobsBundle.commitments = Array.from({length: blobs}, (_, i) => Buffer.alloc(48, i + 1));
    blobsBundle.proofs = Array.from({length: blobs * NUMBER_OF_COLUMNS}, (_, i) => Buffer.alloc(48, i % 251));
    const cells = Array.from({length: blobs}, (_, i) =>
      Array.from({length: NUMBER_OF_COLUMNS}, () => new Uint8Array(BYTES_PER_CELL).fill(i + 1))
    );

    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.parentRoot = parentBlockRoot;
    const bid = block.message.body.signedExecutionPayloadBid.message;
    bid.slot = slot;
    bid.builderIndex = selfBuilt ? BUILDER_INDEX_SELF_BUILD : 7;
    bid.blockHash = payload.blockHash;
    bid.payloadRoot = ssz.gloas.ExecutionPayload.hashTreeRoot(payload);
    bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(executionRequests);
    bid.blobKzgCommitments = blobsBundle.commitments;
    const blockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));

    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      blockRootHex,
      block,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      seenTimestampSec: 0,
      source: PayloadEnvelopeInputSource.gossip,
      daOutOfRange: false,
    });
    payloadInputs.set(blockRootHex, payloadInput);

    const produceResult: ProduceFullGloas = {
      type: BlockType.Full,
      fork: ForkName.gloas,
      executionPayload: payload,
      executionRequests,
      blobsBundle,
      cells,
      parentBlockRoot,
    };
    if (selfBuilt) {
      blockProductionCache.set(blockRootHex, produceResult);
    }

    return {blockRootHex, payloadInput, produceResult};
  }

  function expectedEnvelope(blockRootHex: RootHex, produceResult: ProduceFullGloas): gloas.ExecutionPayloadEnvelope {
    return {
      payload: produceResult.executionPayload,
      executionRequests: produceResult.executionRequests,
      beaconBlockRoot: fromHex(blockRootHex),
      parentBeaconBlockRoot: parentBlockRoot,
    };
  }

  it("broadcasts the envelope once the block was published through the API, and imports it once the block is imported", () => {
    const {blockRootHex, payloadInput, produceResult} = addBlock({selfBuilt: true});

    // publishBlockV2 calls it right after the block was broadcast, the block is not in fork choice yet
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    expect(onPublishEnvelope).toHaveBeenCalledExactlyOnceWith(expectedEnvelope(blockRootHex, produceResult));
    expect(payloadInput.getPayloadEnvelope()).toEqual(expectedEnvelope(blockRootHex, produceResult));
    expect(onExecutionPayloadGossip).toHaveBeenCalledExactlyOnceWith({
      slot,
      builderIndex: BUILDER_INDEX_SELF_BUILD,
      blockHash: toRootHex(produceResult.executionPayload.blockHash),
      blockRoot: blockRootHex,
    });
    expect(processExecutionPayload).not.toHaveBeenCalled();

    // importBlock calls it again once the block is in fork choice
    importedBlocks.add(blockRootHex);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(onPublishEnvelope).toHaveBeenCalledOnce();
    expect(processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput, {validEnvelope: false});
  });

  it("broadcasts and imports the envelope once the block was imported from gossip", () => {
    const {blockRootHex, payloadInput, produceResult} = addBlock({selfBuilt: true});

    // The block was never published through this node's API, importBlock is the first caller
    importedBlocks.add(blockRootHex);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    expect(onPublishEnvelope).toHaveBeenCalledExactlyOnceWith(expectedEnvelope(blockRootHex, produceResult));
    expect(processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput, {validEnvelope: false});
  });

  it("broadcasts the data columns of the cached blobs with the envelope", () => {
    const {blockRootHex, payloadInput} = addBlock({selfBuilt: true, blobs: 2});

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    expect(onPublishEnvelope).toHaveBeenCalledOnce();
    expect(onPublishDataColumns).toHaveBeenCalledOnce();
    const sidecars = onPublishDataColumns.mock.calls[0][0] as gloas.DataColumnSidecar[];
    expect(sidecars).toHaveLength(NUMBER_OF_COLUMNS);
    for (const [index, sidecar] of sidecars.entries()) {
      expect(sidecar.index).toBe(index);
      expect(sidecar.slot).toBe(slot);
      expect(toRootHex(sidecar.beaconBlockRoot)).toBe(blockRootHex);
      expect(sidecar.column).toHaveLength(2);
      expect(sidecar.kzgProofs).toHaveLength(2);
    }
    expect(payloadInput.getAllColumns()).toHaveLength(NUMBER_OF_COLUMNS);
    // The envelope goes out before its data columns
    expect(onPublishEnvelope.mock.invocationCallOrder[0]).toBeLessThan(
      onPublishDataColumns.mock.invocationCallOrder[0]
    );
  });

  it("does not broadcast data columns for a payload without blobs", () => {
    const {blockRootHex} = addBlock({selfBuilt: true});

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    expect(onPublishDataColumns).not.toHaveBeenCalled();
  });

  it("does nothing for a block this node did not build", () => {
    const {blockRootHex, payloadInput} = addBlock({selfBuilt: false});
    importedBlocks.add(blockRootHex);

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(onPublishEnvelope).not.toHaveBeenCalled();
    expect(onPublishDataColumns).not.toHaveBeenCalled();
    expect(onExecutionPayloadGossip).not.toHaveBeenCalled();
    expect(processExecutionPayload).not.toHaveBeenCalled();
    expect(payloadInput.hasPayloadEnvelope()).toBe(false);
  });

  it("does nothing for a block this node produced on a builder's bid", () => {
    const {blockRootHex, payloadInput, produceResult} = addBlock({selfBuilt: false});
    // Blocks committing to a builder bid are cached as full but without payload data
    blockProductionCache.set(blockRootHex, {type: produceResult.type, fork: produceResult.fork} as ProduceResult);
    importedBlocks.add(blockRootHex);

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(onPublishEnvelope).not.toHaveBeenCalled();
    expect(processExecutionPayload).not.toHaveBeenCalled();
    expect(payloadInput.hasPayloadEnvelope()).toBe(false);
  });

  it("broadcasts only once, however often and in whichever order the block is published and imported", () => {
    const {blockRootHex, payloadInput} = addBlock({selfBuilt: true, blobs: 1});

    // published through the API twice, then imported, then published and imported again
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);
    importedBlocks.add(blockRootHex);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);
    // the payload is imported by now
    importedPayloads.add(blockRootHex);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(onPublishEnvelope).toHaveBeenCalledOnce();
    expect(onPublishDataColumns).toHaveBeenCalledOnce();
    expect(onExecutionPayloadGossip).toHaveBeenCalledOnce();
    // The payload import is requested on every call until the payload is in fork choice, the
    // PayloadEnvelopeProcessor shares the in-flight import between callers
    expect(processExecutionPayload).toHaveBeenCalledTimes(2);
    expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput, {validEnvelope: false});
  });

  it("does not broadcast an envelope that was already published through the API", () => {
    const {blockRootHex, payloadInput, produceResult} = addBlock({selfBuilt: true});
    const apiEnvelope = expectedEnvelope(blockRootHex, produceResult);
    payloadInput.addPayloadEnvelope({
      envelope: apiEnvelope,
      source: PayloadEnvelopeInputSource.api,
      seenTimestampSec: 0,
      peerIdStr: undefined,
    });
    importedBlocks.add(blockRootHex);

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(onPublishEnvelope).not.toHaveBeenCalled();
    expect(payloadInput.getPayloadEnvelope()).toBe(apiEnvelope);
    // The API publish imports the envelope it added
    expect(processExecutionPayload).not.toHaveBeenCalled();
  });

  it("persists the revealed envelope if persistProducedPayloadEnvelopes is set", () => {
    const {blockRootHex, produceResult} = addBlock({selfBuilt: true});
    chain.opts.persistProducedPayloadEnvelopes = true;

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    expect(persistExecutionPayloadEnvelope).toHaveBeenCalledExactlyOnceWith(
      expectedEnvelope(blockRootHex, produceResult)
    );
  });
});
