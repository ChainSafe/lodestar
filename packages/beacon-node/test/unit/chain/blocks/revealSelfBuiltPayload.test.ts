import {Mock, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {PayloadStatus} from "@lodestar/fork-choice";
import {BUILDER_INDEX_SELF_BUILD, BYTES_PER_CELL, ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {RootHex, gloas, ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {
  PublishExecutionPayloadEnvelopeResult,
  SELF_BUILT_PAYLOAD_REVEAL_MAX_ATTEMPTS,
  SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS,
  SELF_BUILT_PAYLOAD_REVEAL_WAIT_MS,
  SelfBuiltPayloadReveals,
  completeSelfBuiltPayloadReveal,
  revealSelfBuiltPayload,
} from "../../../../src/chain/blocks/revealSelfBuiltPayload.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {BlockType, ProduceFullGloas, ProduceResult} from "../../../../src/chain/produceBlock/index.js";
import {OpSource} from "../../../../src/chain/validatorMonitor.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("chain / blocks / revealSelfBuiltPayload", () => {
  const slot = 5;
  const parentBlockRoot = Buffer.alloc(32, 0x11);

  let blockProductionCache: Map<RootHex, ProduceResult>;
  let payloadInputs: Map<RootHex, PayloadEnvelopeInput>;
  let blocks: Map<RootHex, gloas.SignedBeaconBlock>;
  /** Roots of blocks in fork choice, and of those whose payload is imported */
  let importedBlocks: Set<RootHex>;
  let importedPayloads: Set<RootHex>;
  let emitter: ChainEventEmitter;
  let onPublishEnvelope: Mock<
    (
      envelope: gloas.ExecutionPayloadEnvelope | null,
      sidecars: gloas.DataColumnSidecar[],
      onPublished: (result: PublishExecutionPayloadEnvelopeResult) => void
    ) => void
  >;
  /**
   * Outcomes the network reports for the publishes, in order: `pending` leaves a publish unanswered. A publish
   * beyond the list succeeds
   */
  let publishOutcomes: (PublishOutcome | "pending")[];
  let selfBuiltPayloadReveals: SelfBuiltPayloadReveals;
  let logger: ReturnType<typeof getMockedLogger>;
  let clock: {currentSlot: number};
  let registerExecutionPayloadEnvelope: ReturnType<typeof vi.fn>;
  let onExecutionPayloadGossip: Mock<
    (data: routes.events.EventData[routes.events.EventType.executionPayloadGossip]) => void
  >;
  let processExecutionPayload: ReturnType<typeof vi.fn>;
  let persistExecutionPayloadEnvelope: ReturnType<typeof vi.fn>;
  let chain: BeaconChain;

  beforeEach(() => {
    blockProductionCache = new Map();
    payloadInputs = new Map();
    blocks = new Map();
    importedBlocks = new Set();
    importedPayloads = new Set();
    emitter = new ChainEventEmitter();
    vi.useFakeTimers();
    publishOutcomes = [];
    onPublishEnvelope = vi.fn((_envelope, sidecars, onPublished) => {
      const outcome = publishOutcomes.shift() ?? {};
      if (outcome !== "pending") onPublished(publishResult(sidecars, outcome));
    });
    selfBuiltPayloadReveals = new SelfBuiltPayloadReveals();
    logger = getMockedLogger();
    clock = {currentSlot: slot};
    registerExecutionPayloadEnvelope = vi.fn();
    onExecutionPayloadGossip = vi.fn();
    emitter.on(ChainEvent.publishExecutionPayloadEnvelope, onPublishEnvelope);
    emitter.on(routes.events.EventType.executionPayloadGossip, onExecutionPayloadGossip);
    processExecutionPayload = vi.fn().mockResolvedValue(undefined);
    persistExecutionPayloadEnvelope = vi.fn();

    chain = {
      blockProductionCache,
      selfBuiltPayloadReveals,
      config,
      genesisTime: 0,
      clock,
      metrics: null,
      validatorMonitor: {registerExecutionPayloadEnvelope},
      seenPayloadEnvelopeInputCache: {get: (rootHex: RootHex) => payloadInputs.get(rootHex)},
      forkChoice: {
        hasBlockHex: (rootHex: RootHex) => importedBlocks.has(rootHex),
        getBlockHex: (rootHex: RootHex, payloadStatus: PayloadStatus) =>
          payloadStatus === PayloadStatus.FULL && importedPayloads.has(rootHex) ? {} : null,
      },
      emitter,
      logger,
      opts: {},
      processExecutionPayload,
      persistExecutionPayloadEnvelope,
    } as unknown as BeaconChain;
  });

  afterEach(() => {
    selfBuiltPayloadReveals.close();
    vi.useRealTimers();
  });

  /** What the network fails to publish: the envelope, and the data columns with the given indices or all of them */
  type PublishOutcome = {envelope?: Error; columns?: {error: Error; indices?: number[]}};

  function publishResult(
    sidecars: gloas.DataColumnSidecar[],
    {envelope, columns}: PublishOutcome
  ): PublishExecutionPayloadEnvelopeResult {
    const columnErrors = new Map<number, Error>();
    if (columns !== undefined) {
      for (const {index} of sidecars) {
        if (columns.indices === undefined || columns.indices.includes(index)) columnErrors.set(index, columns.error);
      }
    }
    return {envelopeError: envelope ?? null, columnErrors};
  }

  const noPeersError = new Error("PublishError.NoPeersSubscribedToTopic");
  const everythingFails: PublishOutcome = {envelope: noPeersError, columns: {error: noPeersError}};

  /** Warnings logged for the block, with slot and block root */
  function warnings(blockRootHex: RootHex): unknown[][] {
    return logger.warn.mock.calls.filter(([, context]) => {
      const {slot: logSlot, blockRoot} = context as {slot?: number; blockRoot?: RootHex};
      return logSlot === slot && blockRoot === blockRootHex;
    });
  }

  function createPayloadInput(blockRootHex: RootHex, block: gloas.SignedBeaconBlock): PayloadEnvelopeInput {
    return PayloadEnvelopeInput.createFromBlock({
      blockRootHex,
      block,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      seenTimestampSec: 0,
      source: PayloadEnvelopeInputSource.gossip,
      daOutOfRange: false,
    });
  }

  /**
   * A block as it is known to the node once it was published through the API or received on gossip: its
   * PayloadEnvelopeInput is seeded. If `selfBuilt`, the node also holds the payload it produced for it.
   */
  function addBlock({
    selfBuilt,
    blobs = 0,
    parentRoot = parentBlockRoot,
  }: {
    selfBuilt: boolean;
    blobs?: number;
    parentRoot?: Uint8Array;
  }): {
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
    block.message.parentRoot = parentRoot;
    const bid = block.message.body.signedExecutionPayloadBid.message;
    bid.slot = slot;
    bid.builderIndex = selfBuilt ? BUILDER_INDEX_SELF_BUILD : 7;
    bid.blockHash = payload.blockHash;
    bid.payloadRoot = ssz.gloas.ExecutionPayload.hashTreeRoot(payload);
    bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(executionRequests);
    bid.blobKzgCommitments = blobsBundle.commitments;
    const blockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));

    const payloadInput = createPayloadInput(blockRootHex, block);
    payloadInputs.set(blockRootHex, payloadInput);
    blocks.set(blockRootHex, block);

    const produceResult: ProduceFullGloas = {
      type: BlockType.Full,
      fork: ForkName.gloas,
      executionPayload: payload,
      executionRequests,
      blobsBundle,
      cells,
      parentBlockRoot: parentRoot,
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

    expect(onPublishEnvelope).toHaveBeenCalledExactlyOnceWith(
      expectedEnvelope(blockRootHex, produceResult),
      [],
      expect.any(Function)
    );
    expect(payloadInput.getPayloadEnvelope()).toEqual(expectedEnvelope(blockRootHex, produceResult));
    expect(onExecutionPayloadGossip).toHaveBeenCalledExactlyOnceWith({
      slot,
      builderIndex: BUILDER_INDEX_SELF_BUILD,
      blockHash: toRootHex(produceResult.executionPayload.blockHash),
      payloadRoot: toRootHex(ssz.gloas.ExecutionPayload.hashTreeRoot(produceResult.executionPayload)),
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

    expect(onPublishEnvelope).toHaveBeenCalledExactlyOnceWith(
      expectedEnvelope(blockRootHex, produceResult),
      [],
      expect.any(Function)
    );
    expect(processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput, {validEnvelope: false});
  });

  it("broadcasts the data columns of the cached blobs with the envelope", () => {
    const {blockRootHex, payloadInput} = addBlock({selfBuilt: true, blobs: 2});

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    expect(onPublishEnvelope).toHaveBeenCalledOnce();
    const sidecars = onPublishEnvelope.mock.calls[0][1];
    expect(sidecars).toHaveLength(NUMBER_OF_COLUMNS);
    for (const [index, sidecar] of sidecars.entries()) {
      expect(sidecar.index).toBe(index);
      expect(sidecar.slot).toBe(slot);
      expect(toRootHex(sidecar.beaconBlockRoot)).toBe(blockRootHex);
      expect(sidecar.column).toHaveLength(2);
      expect(sidecar.kzgProofs).toHaveLength(2);
    }
    expect(payloadInput.getAllColumns()).toHaveLength(NUMBER_OF_COLUMNS);
  });

  it("does nothing for a block this node did not build", () => {
    const {blockRootHex, payloadInput} = addBlock({selfBuilt: false});
    importedBlocks.add(blockRootHex);

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(onPublishEnvelope).not.toHaveBeenCalled();
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
    expect(onExecutionPayloadGossip).toHaveBeenCalledOnce();
    expect(registerExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    // The payload import is requested on every call until the payload is in fork choice, the
    // PayloadEnvelopeProcessor shares the in-flight import between callers
    expect(processExecutionPayload).toHaveBeenCalledTimes(2);
    expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput, {validEnvelope: false});
  });

  it("does not broadcast an envelope that was already received on gossip or published through the API", () => {
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
    // Whoever added the envelope imports it
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

  it("registers the revealed envelope with the validator monitor, as the publish API does", () => {
    const {blockRootHex, produceResult} = addBlock({selfBuilt: true});

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    expect(registerExecutionPayloadEnvelope).toHaveBeenCalledExactlyOnceWith(
      OpSource.api,
      expect.any(Number),
      expectedEnvelope(blockRootHex, produceResult)
    );
  });

  it("adds and imports the payload before its broadcast is done, and does not broadcast it again meanwhile", () => {
    const {blockRootHex, payloadInput} = addBlock({selfBuilt: true, blobs: 1});
    publishOutcomes = ["pending"];
    importedBlocks.add(blockRootHex);

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(onPublishEnvelope).toHaveBeenCalledOnce();
    // This node built the payload, it does not wait for the network to know it
    expect(payloadInput.hasPayloadEnvelope()).toBe(true);
    expect(payloadInput.getAllColumns()).toHaveLength(NUMBER_OF_COLUMNS);
    expect(processExecutionPayload).toHaveBeenCalledWith(payloadInput, {validEnvelope: false});
    expect(onExecutionPayloadGossip).not.toHaveBeenCalled();

    // The network reports the broadcast
    onPublishEnvelope.mock.calls[0][2]({envelopeError: null, columnErrors: new Map()});
    // And cannot report it twice
    onPublishEnvelope.mock.calls[0][2]({envelopeError: null, columnErrors: new Map()});

    expect(onExecutionPayloadGossip).toHaveBeenCalledOnce();
    expect(registerExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes the envelope again if its broadcast failed, and not the data columns that were broadcast", () => {
    const {blockRootHex, payloadInput, produceResult} = addBlock({selfBuilt: true, blobs: 1});
    publishOutcomes = [{envelope: noPeersError}];

    // publishBlockV2 calls it, the broadcast of the envelope fails
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    expect(onPublishEnvelope).toHaveBeenCalledOnce();
    expect(onPublishEnvelope.mock.calls[0][1]).toHaveLength(NUMBER_OF_COLUMNS);
    expect(onExecutionPayloadGossip).not.toHaveBeenCalled();
    expect(registerExecutionPayloadEnvelope).not.toHaveBeenCalled();
    // The failure is logged once, with the slot and the block root
    expect(warnings(blockRootHex)).toHaveLength(1);
    expect(warnings(blockRootHex)[0][2]).toBe(noPeersError);

    // importBlock calls it meanwhile, which is not what publishes the envelope again
    importedBlocks.add(blockRootHex);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);
    expect(onPublishEnvelope).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS - 1);
    expect(onPublishEnvelope).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);

    expect(onPublishEnvelope).toHaveBeenCalledTimes(2);
    expect(onPublishEnvelope.mock.calls[1][0]).toEqual(expectedEnvelope(blockRootHex, produceResult));
    expect(onPublishEnvelope.mock.calls[1][1]).toHaveLength(0);
    expect(onExecutionPayloadGossip).toHaveBeenCalledOnce();
    expect(registerExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    expect(payloadInput.getPayloadEnvelope()).toEqual(expectedEnvelope(blockRootHex, produceResult));
    expect(warnings(blockRootHex)).toHaveLength(1);

    // Nothing is left to publish
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS);
    expect(onPublishEnvelope).toHaveBeenCalledTimes(2);
  });

  it("publishes the data columns that failed again, and not the envelope that was broadcast", () => {
    const {blockRootHex} = addBlock({selfBuilt: true, blobs: 1});
    const failedIndices = [3, 70];
    publishOutcomes = [
      {columns: {error: noPeersError, indices: failedIndices}},
      {columns: {error: noPeersError, indices: [70]}},
    ];

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    // The envelope went out, a failed data column does not undo that
    expect(onExecutionPayloadGossip).toHaveBeenCalledOnce();
    expect(registerExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    expect(warnings(blockRootHex)).toHaveLength(1);

    vi.advanceTimersByTime(SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS);
    expect(onPublishEnvelope).toHaveBeenCalledTimes(2);
    expect(onPublishEnvelope.mock.calls[1][0]).toBeNull();
    expect(onPublishEnvelope.mock.calls[1][1].map(({index}) => index)).toEqual(failedIndices);

    vi.advanceTimersByTime(SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS);
    expect(onPublishEnvelope).toHaveBeenCalledTimes(3);
    expect(onPublishEnvelope.mock.calls[2][0]).toBeNull();
    expect(onPublishEnvelope.mock.calls[2][1].map(({index}) => index)).toEqual([70]);

    expect(onExecutionPayloadGossip).toHaveBeenCalledOnce();
    expect(registerExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    expect(warnings(blockRootHex)).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("imports the payload even if every broadcast fails, and gives up after the maximum number of attempts", () => {
    const {blockRootHex, payloadInput, produceResult} = addBlock({selfBuilt: true, blobs: 1});
    publishOutcomes = Array.from({length: 2 * SELF_BUILT_PAYLOAD_REVEAL_MAX_ATTEMPTS}, () => everythingFails);

    // The block was published through the API, and is then imported
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);
    importedBlocks.add(blockRootHex);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(payloadInput.getPayloadEnvelope()).toEqual(expectedEnvelope(blockRootHex, produceResult));
    expect(payloadInput.getAllColumns()).toHaveLength(NUMBER_OF_COLUMNS);
    expect(processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput, {validEnvelope: false});

    vi.advanceTimersByTime(10 * SELF_BUILT_PAYLOAD_REVEAL_MAX_ATTEMPTS * SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS);

    expect(onPublishEnvelope).toHaveBeenCalledTimes(SELF_BUILT_PAYLOAD_REVEAL_MAX_ATTEMPTS);
    for (const [envelope, sidecars] of onPublishEnvelope.mock.calls) {
      expect(envelope).toEqual(expectedEnvelope(blockRootHex, produceResult));
      expect(sidecars).toHaveLength(NUMBER_OF_COLUMNS);
    }
    // One warning for the envelope and one for the data columns per attempt
    expect(warnings(blockRootHex)).toHaveLength(2 * SELF_BUILT_PAYLOAD_REVEAL_MAX_ATTEMPTS);
    expect(onExecutionPayloadGossip).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("imports the payload from the import path alone if every broadcast fails", () => {
    const {blockRootHex, payloadInput} = addBlock({selfBuilt: true});
    publishOutcomes = [everythingFails];

    // The block arrived on gossip, importBlock is the only caller
    importedBlocks.add(blockRootHex);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    expect(processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput, {validEnvelope: false});
  });

  it("does not publish again once the slot of the block has passed", () => {
    const {blockRootHex} = addBlock({selfBuilt: true, blobs: 1});
    publishOutcomes = [everythingFails, everythingFails, everythingFails];

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);
    vi.advanceTimersByTime(SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS);
    expect(onPublishEnvelope).toHaveBeenCalledTimes(2);

    // The slot ends while the next attempt is pending
    clock.currentSlot = slot + 1;
    vi.advanceTimersByTime(10 * SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS);

    expect(onPublishEnvelope).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not schedule another attempt if the broadcast fails after the slot of the block", () => {
    const {blockRootHex} = addBlock({selfBuilt: true});
    publishOutcomes = ["pending"];

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);
    clock.currentSlot = slot + 1;
    onPublishEnvelope.mock.calls[0][2]({envelopeError: noPeersError, columnErrors: new Map()});

    expect(warnings(blockRootHex)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the pending attempts when the chain is closed", () => {
    const first = addBlock({selfBuilt: true, blobs: 1});
    publishOutcomes = [everythingFails, "pending"];
    expect(revealSelfBuiltPayload.call(chain, first.blockRootHex)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    // A broadcast is in flight for another block
    const second = addBlock({selfBuilt: true, parentRoot: Buffer.alloc(32, 0x33)});
    expect(revealSelfBuiltPayload.call(chain, second.blockRootHex)).toBe(true);
    expect(onPublishEnvelope).toHaveBeenCalledTimes(2);

    selfBuiltPayloadReveals.close();

    expect(vi.getTimerCount()).toBe(0);
    // The broadcast in flight fails after the chain was closed
    onPublishEnvelope.mock.calls[1][2]({envelopeError: noPeersError, columnErrors: new Map()});
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS);
    expect(onPublishEnvelope).toHaveBeenCalledTimes(2);

    // Nothing is revealed after the chain was closed
    const third = addBlock({selfBuilt: true, parentRoot: Buffer.alloc(32, 0x44)});
    expect(revealSelfBuiltPayload.call(chain, third.blockRootHex)).toBe(false);
    expect(onPublishEnvelope).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the pending attempt of a reveal that is pruned", () => {
    const {blockRootHex} = addBlock({selfBuilt: true});
    publishOutcomes = [everythingFails];
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    selfBuiltPayloadReveals.prune(() => false);

    expect(selfBuiltPayloadReveals.has(blockRootHex)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("completeSelfBuiltPayloadReveal", () => {
    it("returns null for a block whose payload this node does not reveal", () => {
      const {blockRootHex} = addBlock({selfBuilt: false});

      expect(completeSelfBuiltPayloadReveal.call(chain, blockRootHex)).toBeNull();
    });

    it("waits for a broadcast in flight and does not broadcast anything twice", async () => {
      const {blockRootHex} = addBlock({selfBuilt: true, blobs: 1});
      publishOutcomes = ["pending"];
      expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

      // The validator client publishes the envelope through the API while the node broadcasts it
      const completion = completeSelfBuiltPayloadReveal.call(chain, blockRootHex);
      const onCompleted = vi.fn();
      completion?.then(onCompleted);
      await vi.advanceTimersByTimeAsync(SELF_BUILT_PAYLOAD_REVEAL_WAIT_MS / 2);
      expect(onCompleted).not.toHaveBeenCalled();

      onPublishEnvelope.mock.calls[0][2]({envelopeError: null, columnErrors: new Map()});

      await expect(completion).resolves.toEqual({envelopePublished: true, unpublishedColumns: 0, inFlight: false});
      expect(onPublishEnvelope).toHaveBeenCalledOnce();
      expect(onExecutionPayloadGossip).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("broadcasts what is still missing once the broadcast in flight failed", async () => {
      const {blockRootHex} = addBlock({selfBuilt: true, blobs: 1});
      publishOutcomes = ["pending"];
      expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

      const completion = completeSelfBuiltPayloadReveal.call(chain, blockRootHex);
      onPublishEnvelope.mock.calls[0][2]({envelopeError: null, columnErrors: new Map([[5, noPeersError]])});

      await expect(completion).resolves.toEqual({envelopePublished: true, unpublishedColumns: 0, inFlight: false});
      expect(onPublishEnvelope).toHaveBeenCalledTimes(2);
      expect(onPublishEnvelope.mock.calls[1][0]).toBeNull();
      expect(onPublishEnvelope.mock.calls[1][1].map(({index}) => index)).toEqual([5]);
      expect(onExecutionPayloadGossip).toHaveBeenCalledOnce();
      // The retry of the failed broadcast is not left pending
      expect(vi.getTimerCount()).toBe(0);
    });

    it("reports what could not be broadcast", async () => {
      const {blockRootHex} = addBlock({selfBuilt: true, blobs: 1});
      publishOutcomes = [everythingFails, {envelope: noPeersError}];
      expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

      await expect(completeSelfBuiltPayloadReveal.call(chain, blockRootHex)).resolves.toEqual({
        envelopePublished: false,
        unpublishedColumns: 0,
        inFlight: false,
      });
      expect(onPublishEnvelope).toHaveBeenCalledTimes(2);
      expect(onExecutionPayloadGossip).not.toHaveBeenCalled();
    });

    it("does not wait for a broadcast in flight beyond the timeout, nor once the chain is closed", async () => {
      const {blockRootHex} = addBlock({selfBuilt: true});
      publishOutcomes = ["pending"];
      expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

      const completion = completeSelfBuiltPayloadReveal.call(chain, blockRootHex);
      await vi.advanceTimersByTimeAsync(SELF_BUILT_PAYLOAD_REVEAL_WAIT_MS);
      await expect(completion).resolves.toEqual({envelopePublished: false, unpublishedColumns: 0, inFlight: true});
      expect(onPublishEnvelope).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);

      const closedCompletion = completeSelfBuiltPayloadReveal.call(chain, blockRootHex);
      selfBuiltPayloadReveals.close();
      await expect(closedCompletion).resolves.toMatchObject({envelopePublished: false});
      expect(onPublishEnvelope).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("does not record the payload as revealed if nothing can publish it", () => {
    const {blockRootHex, payloadInput} = addBlock({selfBuilt: true});
    emitter.off(ChainEvent.publishExecutionPayloadEnvelope, onPublishEnvelope);

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(selfBuiltPayloadReveals.has(blockRootHex)).toBe(false);
    expect(payloadInput.hasPayloadEnvelope()).toBe(false);
  });

  it("does not throw, so that neither the block import nor the block publish fails", () => {
    const {blockRootHex} = addBlock({selfBuilt: true});
    onPublishEnvelope.mockImplementationOnce(() => {
      throw new Error("publish failed");
    });

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);
    // The publish that threw is a failed attempt, which is tried again
    expect(warnings(blockRootHex)).toHaveLength(1);
    vi.advanceTimersByTime(SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS);
    expect(onPublishEnvelope).toHaveBeenCalledTimes(2);
    expect(onExecutionPayloadGossip).toHaveBeenCalledOnce();

    // Nor if the import of the revealed payload throws
    processExecutionPayload.mockImplementation(() => {
      throw new Error("import failed");
    });
    importedBlocks.add(blockRootHex);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);
  });

  it("does not reveal the payload of a block from a past slot", () => {
    const {blockRootHex, payloadInput} = addBlock({selfBuilt: true, blobs: 1});
    clock.currentSlot = slot + 1;
    importedBlocks.add(blockRootHex);

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(onPublishEnvelope).not.toHaveBeenCalled();
    expect(onExecutionPayloadGossip).not.toHaveBeenCalled();
    expect(processExecutionPayload).not.toHaveBeenCalled();
    expect(payloadInput.hasPayloadEnvelope()).toBe(false);
    expect(selfBuiltPayloadReveals.has(blockRootHex)).toBe(false);
  });

  it("still imports a payload it revealed in its slot once the slot has passed", () => {
    const {blockRootHex, payloadInput} = addBlock({selfBuilt: true});

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    // The block is imported in the next slot
    clock.currentSlot = slot + 1;
    importedBlocks.add(blockRootHex);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(onPublishEnvelope).toHaveBeenCalledOnce();
    expect(processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput, {validEnvelope: false});
  });

  it("imports the payload if its PayloadEnvelopeInput was pruned and created again after the reveal", () => {
    const {blockRootHex, produceResult} = addBlock({selfBuilt: true, blobs: 1});

    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(true);

    // The block is seen again, e.g. on gossip, and seeds a new PayloadEnvelopeInput
    const recreatedPayloadInput = createPayloadInput(blockRootHex, blocks.get(blockRootHex) as gloas.SignedBeaconBlock);
    payloadInputs.set(blockRootHex, recreatedPayloadInput);
    importedBlocks.add(blockRootHex);
    expect(revealSelfBuiltPayload.call(chain, blockRootHex)).toBe(false);

    expect(onPublishEnvelope).toHaveBeenCalledOnce();
    expect(recreatedPayloadInput.getPayloadEnvelope()).toEqual(expectedEnvelope(blockRootHex, produceResult));
    expect(recreatedPayloadInput.getAllColumns()).toHaveLength(NUMBER_OF_COLUMNS);
    expect(processExecutionPayload).toHaveBeenCalledExactlyOnceWith(recreatedPayloadInput, {validEnvelope: false});
  });
});
