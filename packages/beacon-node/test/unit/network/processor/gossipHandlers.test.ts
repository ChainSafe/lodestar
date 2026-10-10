import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputBlobs} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {PayloadError, PayloadErrorCode, PayloadErrorType} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/blockError.js";
import {BlockGossipError, GossipAction} from "../../../../src/chain/errors/index.js";
import {ChainEvent, ChainEventEmitter, IBeaconChain} from "../../../../src/chain/index.js";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/seenBlockProposers.js";
import {SeenBlockInput} from "../../../../src/chain/seenCache/seenGossipBlockInput.js";
import {validateGossipBlock} from "../../../../src/chain/validation/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NetworkEventBus} from "../../../../src/network/events.js";
import {GossipType, SequentialGossipHandler} from "../../../../src/network/gossip/interface.js";
import {PeerAction} from "../../../../src/network/peers/index.js";
import {AggregatorTracker} from "../../../../src/network/processor/aggregatorTracker.js";
import {getGossipHandlers} from "../../../../src/network/processor/gossipHandlers.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";
import {PeerIdStr} from "../../../../src/util/peerId.js";
import {ClockStopped} from "../../../mocks/clock.js";

vi.mock("../../../../src/chain/validation/index.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../../src/chain/validation/index.js")>();
  return {
    ...mod,
    validateGossipBlock: vi.fn(),
  };
});

vi.mock("../../../../src/chain/validation/executionPayloadEnvelope.js", () => ({
  validateGossipExecutionPayloadEnvelope: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/chain/validation/dataColumnSidecar.js", async (importActual) => ({
  ...(await importActual<typeof import("../../../../src/chain/validation/dataColumnSidecar.js")>()),
  validateGossipGloasDataColumnSidecar: vi.fn().mockResolvedValue(undefined),
}));

describe("incomplete payload gossip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(blobCount = 1) {
    const config = createBeaconConfig(
      {
        ...defaultConfig,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
        PAYLOAD_DUE_BPS: 7500,
      },
      new Uint8Array(32)
    );
    vi.setSystemTime(config.SLOT_DURATION_MS);
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = Array.from(
      {length: blobCount},
      () => new Uint8Array(48)
    );
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex: toRootHex(blockRoot),
      forkName: ForkName.gloas,
      sampledColumns: [0, 1],
      custodyColumns: [0, 1],
      daOutOfRange: false,
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: Date.now() / 1000,
    });
    const logger = testLogger();
    const peerIdStr = "16Uiu2HAmTestGossipPeer" as PeerIdStr;
    const emitter = new ChainEventEmitter();
    const onIncomplete = vi.fn();
    emitter.on(ChainEvent.incompletePayloadEnvelope, onIncomplete);
    const getPayloadInput = vi.fn().mockReturnValue(payloadInput);
    const chain = {
      config,
      genesisTime: 0,
      clock: new ClockStopped(1),
      logger,
      emitter,
      processExecutionPayload: vi.fn().mockResolvedValue(undefined),
      seenPayloadEnvelopeInputCache: {get: getPayloadInput},
      forkChoice: {getBlockHex: vi.fn().mockReturnValue(null)},
      serializedCache: {set: vi.fn()},
      columnReconstructionTracker: {triggerColumnReconstruction: vi.fn()},
    } as unknown as IBeaconChain;
    const handlers = getGossipHandlers(
      {
        chain,
        config,
        logger,
        metrics: null,
        core: {reportPeer: vi.fn()} as unknown as INetworkCore,
        events: new NetworkEventBus(),
        aggregatorTracker: {} as AggregatorTracker,
      },
      {}
    );
    const envelopeHandler = handlers[
      GossipType.execution_payload
    ] as SequentialGossipHandler<GossipType.execution_payload>;
    const columnHandler = handlers[
      GossipType.data_column_sidecar
    ] as SequentialGossipHandler<GossipType.data_column_sidecar>;

    async function sendEnvelope(): Promise<void> {
      const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      envelope.message.beaconBlockRoot = blockRoot;
      envelope.message.payload.slotNumber = 1;
      await envelopeHandler({
        gossipData: {serializedData: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope)},
        topic: {boundary: {fork: ForkName.gloas, epoch: 0}, type: GossipType.execution_payload},
        peerIdStr,
        seenTimestampSec: Date.now() / 1000,
      });
      await vi.advanceTimersByTimeAsync(0);
    }

    async function sendColumn(index: number): Promise<void> {
      const column = ssz.gloas.DataColumnSidecar.defaultValue();
      column.beaconBlockRoot = blockRoot;
      column.slot = 1;
      column.index = index;
      await columnHandler({
        gossipData: {serializedData: ssz.gloas.DataColumnSidecar.serialize(column)},
        topic: {boundary: {fork: ForkName.gloas, epoch: 0}, type: GossipType.data_column_sidecar, subnet: 0},
        peerIdStr,
        seenTimestampSec: Date.now() / 1000,
      });
      await vi.advanceTimersByTimeAsync(0);
    }

    return {config, payloadInput, onIncomplete, getPayloadInput, peerIdStr, sendEnvelope, sendColumn};
  }

  it("requests missing columns at the configured payload deadline when only the envelope arrives", async () => {
    const {config, payloadInput, onIncomplete, peerIdStr, sendEnvelope} = setup();
    await sendEnvelope();
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs() - 1);
    expect(onIncomplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onIncomplete).toHaveBeenCalledExactlyOnceWith({
      payloadInput,
      peer: peerIdStr,
      source: BlockInputSource.gossip,
    });
  });

  it("emits once for multiple columns, including arrivals after the deadline", async () => {
    const {config, onIncomplete, sendColumn} = setup();
    await sendColumn(0);
    await sendColumn(1);
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs() - 1);
    expect(onIncomplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onIncomplete).toHaveBeenCalledOnce();
    await sendColumn(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(onIncomplete).toHaveBeenCalledOnce();
  });

  it.each(["envelope", "column"])("shares one deadline when %s arrives first", async (first) => {
    const {config, onIncomplete, sendEnvelope, sendColumn} = setup();
    if (first === "envelope") {
      await sendEnvelope();
      await sendColumn(0);
    } else {
      await sendColumn(0);
      await sendEnvelope();
    }
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs());
    expect(onIncomplete).toHaveBeenCalledOnce();
  });

  it("does not emit if gossip completes the payload before the deadline", async () => {
    const {config, payloadInput, onIncomplete, sendEnvelope, sendColumn} = setup();
    await sendEnvelope();
    await sendColumn(0);
    await sendColumn(1);
    expect(payloadInput.isComplete()).toBe(true);
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs());
    expect(onIncomplete).not.toHaveBeenCalled();
  });

  it("does not arm a timeout for an envelope without blobs", async () => {
    const {config, payloadInput, onIncomplete, sendEnvelope} = setup(0);
    await sendEnvelope();
    expect(payloadInput.isComplete()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs());
    expect(onIncomplete).not.toHaveBeenCalled();
  });

  it("emits once when the first message arrives after the deadline", async () => {
    const {config, onIncomplete, sendEnvelope, sendColumn} = setup();
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs() + 1);
    await sendEnvelope();
    await vi.advanceTimersByTimeAsync(1);
    expect(onIncomplete).toHaveBeenCalledOnce();
    await sendColumn(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(onIncomplete).toHaveBeenCalledOnce();
  });

  it("does not enqueue an input removed from the cache while waiting", async () => {
    const {config, onIncomplete, getPayloadInput, sendColumn} = setup();
    await sendColumn(0);
    getPayloadInput.mockReturnValue(undefined);
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs());
    expect(onIncomplete).not.toHaveBeenCalled();
  });
});

describe("getGossipHandlers", () => {
  const denebConfig = createBeaconConfig(
    {
      ...defaultConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: Infinity,
      FULU_FORK_EPOCH: Infinity,
      GLOAS_FORK_EPOCH: Infinity,
    },
    Buffer.alloc(32, 0)
  );

  beforeEach(() => {
    vi.mocked(validateGossipBlock).mockResolvedValue({skippedSlots: 0});
  });

  it("does not report the gossip peer when block processing hits an execution engine error", async () => {
    const {core} = await runBeaconBlockProcessingError(denebConfig, BlockErrorCode.EXECUTION_ENGINE_ERROR);

    expect(core.reportPeer).not.toHaveBeenCalled();
  });

  it("reports the gossip peer when block processing gets a definitive execution INVALID verdict", async () => {
    const {core, peerIdStr} = await runBeaconBlockProcessingError(denebConfig, BlockErrorCode.EXECUTION_ENGINE_INVALID);

    expect(core.reportPeer).toHaveBeenCalledOnce();
    expect(core.reportPeer).toHaveBeenCalledWith(peerIdStr, PeerAction.LowToleranceError, "ExecutionEngineInvalid");
  });

  it("imports a signature-verified REPEAT_PROPOSAL (equivocating) block into fork choice but keeps IGNORE", async () => {
    const {processBlock, threw, getByBlock} = await runBeaconBlockRepeatProposal(denebConfig, {recorded: true});
    expect(getByBlock).toHaveBeenCalledOnce();

    // imported so LMD-GHOST can weigh it ...
    expect(processBlock).toHaveBeenCalledOnce();
    // ... but the gossip result stays IGNORE (handler re-throws), so the message is not forwarded
    expect(threw).toBe(true);
  });

  it("does not cache a block rejected by gossip validation", async () => {
    const {processBlock, threw, getByBlock} = await runBeaconBlockRepeatProposal(denebConfig, {
      recorded: false,
      reject: true,
    });
    expect(threw).toBe(true);
    expect(processBlock).not.toHaveBeenCalled();
    expect(getByBlock).not.toHaveBeenCalled();
  });

  it("does not import a REPEAT_PROPOSAL block whose root was not recorded (unverified 3rd+ proposal)", async () => {
    const {processBlock, threw, getByBlock} = await runBeaconBlockRepeatProposal(denebConfig, {
      recorded: false,
    });
    // the block is not kept around, sync re-downloads it if it ever becomes relevant
    expect(getByBlock).not.toHaveBeenCalled();

    expect(processBlock).not.toHaveBeenCalled();
    expect(threw).toBe(true);
  });

  it("does not import a signature-verified REPEAT_PROPOSAL block whose parent is unknown", async () => {
    const {processBlock, threw, getByBlock} = await runBeaconBlockRepeatProposal(denebConfig, {
      recorded: true,
      parentKnown: false,
    });
    expect(getByBlock).not.toHaveBeenCalled();

    expect(processBlock).not.toHaveBeenCalled();
    expect(threw).toBe(true);
  });

  it.each<PayloadErrorType>([
    {code: PayloadErrorCode.INVALID_SIGNATURE},
    {code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR, message: "parent_beacon_block_root mismatch"},
    {
      code: PayloadErrorCode.EXECUTION_ENGINE_INVALID,
      execStatus: ExecutionPayloadStatus.INVALID,
      errorMessage: "invalid payload",
    },
  ])("evicts the cached envelope when payload processing fails with $code", async (errorType) => {
    const {removeInvalid, payloadInput} = await runExecutionPayloadProcessingError(errorType);

    expect(removeInvalid).toHaveBeenCalledExactlyOnceWith(payloadInput);
  });

  it("keeps the cached envelope when payload processing hits an execution engine error", async () => {
    const {removeInvalid} = await runExecutionPayloadProcessingError({
      code: PayloadErrorCode.EXECUTION_ENGINE_ERROR,
      execStatus: ExecutionPayloadStatus.ELERROR,
      errorMessage: "execution engine offline",
    });

    expect(removeInvalid).not.toHaveBeenCalled();
  });
});

async function runExecutionPayloadProcessingError(errorType: PayloadErrorType): Promise<{
  removeInvalid: ReturnType<typeof vi.fn>;
  payloadInput: PayloadEnvelopeInput;
}> {
  const config = createBeaconConfig(
    {
      ...defaultConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    },
    Buffer.alloc(32, 0)
  );
  const logger = testLogger();
  const peerIdStr = "16Uiu2HAmTestGossipPeer" as PeerIdStr;
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = 1;
  const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
  const payloadInput = PayloadEnvelopeInput.createFromBlock({
    block,
    blockRootHex: toRootHex(blockRoot),
    forkName: ForkName.gloas,
    sampledColumns: [],
    custodyColumns: [],
    daOutOfRange: false,
    source: PayloadEnvelopeInputSource.gossip,
    seenTimestampSec: 0,
  });
  const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  signedEnvelope.message.beaconBlockRoot = blockRoot;
  signedEnvelope.message.payload.slotNumber = 1;

  const removeInvalid = vi.fn();
  const chain = {
    clock: new ClockStopped(1),
    emitter: new ChainEventEmitter(),
    logger,
    processExecutionPayload: vi.fn().mockRejectedValue(new PayloadError(payloadInput, errorType)),
    seenPayloadEnvelopeInputCache: {
      get: vi.fn().mockReturnValue(payloadInput),
      removeInvalid,
    } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
    serializedCache: {set: vi.fn()},
  } as unknown as IBeaconChain;

  const handlers = getGossipHandlers(
    {
      aggregatorTracker: {} as AggregatorTracker,
      chain,
      config,
      core: {reportPeer: vi.fn()} as unknown as INetworkCore,
      events: new NetworkEventBus(),
      logger,
      metrics: null,
    },
    {}
  );
  const executionPayloadHandler = handlers[
    GossipType.execution_payload
  ] as SequentialGossipHandler<GossipType.execution_payload>;

  await executionPayloadHandler({
    gossipData: {serializedData: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(signedEnvelope)},
    peerIdStr,
    seenTimestampSec: 0,
    topic: {
      boundary: {fork: ForkName.gloas, epoch: 0},
      type: GossipType.execution_payload,
    },
  });
  // The import is deferred via callInNextEventLoop and its catch handler is a further hop, see above
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {removeInvalid, payloadInput};
}

async function runBeaconBlockProcessingError(
  config: BeaconConfig,
  code: BlockErrorCode.EXECUTION_ENGINE_ERROR | BlockErrorCode.EXECUTION_ENGINE_INVALID
): Promise<{
  core: Pick<INetworkCore, "reportPeer">;
  peerIdStr: PeerIdStr;
}> {
  const logger = testLogger();
  const peerIdStr = "16Uiu2HAmTestGossipPeer" as PeerIdStr;
  const signedBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
  signedBlock.message.slot = 1;
  const blockRootHex = toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(signedBlock.message));
  const blockInput = BlockInputBlobs.createFromBlock({
    block: signedBlock,
    blockRootHex,
    forkName: ForkName.deneb,
    daOutOfRange: false,
    source: BlockInputSource.gossip,
    seenTimestampSec: 0,
    peerIdStr,
  });
  const error = getExecutionBlockError(signedBlock, code);
  const core = {reportPeer: vi.fn()} as Pick<INetworkCore, "reportPeer">;
  const chain = {
    clock: new ClockStopped(1),
    custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
    emitter: new ChainEventEmitter(),
    getBlobsTracker: {triggerGetBlobs: vi.fn()},
    logger,
    processBlock: vi.fn().mockRejectedValue(error),
    processProposerEquivocation: vi.fn(),
    seenBlockProposers: new SeenBlockProposers(),
    seenBlockInputCache: {
      getByBlock: vi.fn().mockReturnValue(blockInput),
      markValidatingBlock: vi.fn(),
      unmarkValidatingBlock: vi.fn(),
      prune: vi.fn(),
    } as unknown as SeenBlockInput,
    seenPayloadEnvelopeInputCache: {
      add: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      remove: vi.fn(),
    } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
    serializedCache: {set: vi.fn()},
  } as unknown as IBeaconChain;

  const handlers = getGossipHandlers(
    {
      aggregatorTracker: {} as AggregatorTracker,
      chain,
      config,
      core: core as INetworkCore,
      events: new NetworkEventBus(),
      logger,
      metrics: null,
    },
    {}
  );
  const beaconBlockHandler = handlers[GossipType.beacon_block] as SequentialGossipHandler<GossipType.beacon_block>;

  await beaconBlockHandler({
    gossipData: {
      serializedData: ssz.deneb.SignedBeaconBlock.serialize(signedBlock),
    },
    peerIdStr,
    seenTimestampSec: 0,
    topic: {
      boundary: {fork: ForkName.deneb, epoch: 0},
      type: GossipType.beacon_block,
    },
  });
  // The handler is now deferred via callInNextEventLoop (setTimeout 0), and it kicks off
  // processBlock (whose .then/.catch is a further hop). Flush two macrotask ticks so the deferred
  // import and its result handlers complete before assertions.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {core, peerIdStr};
}

async function runBeaconBlockRepeatProposal(
  config: BeaconConfig,
  {recorded, reject = false, parentKnown = true}: {recorded: boolean; reject?: boolean; parentKnown?: boolean}
): Promise<{
  processBlock: ReturnType<typeof vi.fn>;
  threw: boolean;
  getByBlock: ReturnType<typeof vi.fn>;
}> {
  const logger = testLogger();
  const peerIdStr = "16Uiu2HAmTestGossipPeer" as PeerIdStr;
  const signedBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
  signedBlock.message.slot = 1;
  signedBlock.message.proposerIndex = 3;
  const blockRootHex = toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(signedBlock.message));
  const blockInput = BlockInputBlobs.createFromBlock({
    block: signedBlock,
    blockRootHex,
    forkName: ForkName.deneb,
    daOutOfRange: false,
    source: BlockInputSource.gossip,
    seenTimestampSec: 0,
    peerIdStr,
  });

  // gossip validation rejects the 2nd distinct block for this (proposer, slot) with REPEAT_PROPOSAL,
  // or the block outright when `reject` is set
  vi.mocked(validateGossipBlock).mockRejectedValue(
    reject
      ? new BlockGossipError(GossipAction.REJECT, {
          code: BlockErrorCode.INCORRECT_PROPOSER,
          slot: signedBlock.message.slot,
          root: blockRootHex,
          proposerIndex: signedBlock.message.proposerIndex,
        })
      : new BlockGossipError(GossipAction.IGNORE, {
          code: BlockErrorCode.REPEAT_PROPOSAL,
          proposerIndex: signedBlock.message.proposerIndex,
          root: blockRootHex,
        })
  );

  const seenBlockProposers = new SeenBlockProposers();
  if (recorded) {
    // observeBlockRoot runs only after the proposer signature is verified, so hasBlockRoot(root)
    // being true is the handler's proof the signature was checked (the 2nd distinct block)
    seenBlockProposers.observeBlockRoot(
      signedBlock.message.slot,
      signedBlock.message.proposerIndex,
      blockRootHex,
      ssz.phase0.SignedBeaconBlockHeader.defaultValue()
    );
  }

  const processBlock = vi.fn().mockResolvedValue(undefined);
  const getByBlock = vi.fn().mockReturnValue(blockInput);
  const chain = {
    clock: new ClockStopped(1),
    custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
    emitter: new ChainEventEmitter(),
    forkChoice: {getBlockHexDefaultStatus: vi.fn().mockReturnValue(parentKnown ? {} : null)},
    getBlobsTracker: {triggerGetBlobs: vi.fn()},
    logger,
    persistInvalidSszValue: vi.fn(),
    processBlock,
    processProposerEquivocation: vi.fn(),
    seenBlockProposers,
    seenBlockInputCache: {
      getByBlock,
      markValidatingBlock: vi.fn(),
      unmarkValidatingBlock: vi.fn(),
      prune: vi.fn(),
    } as unknown as SeenBlockInput,
    seenPayloadEnvelopeInputCache: {
      add: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      remove: vi.fn(),
    } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
    serializedCache: {set: vi.fn()},
  } as unknown as IBeaconChain;

  const handlers = getGossipHandlers(
    {
      aggregatorTracker: {} as AggregatorTracker,
      chain,
      config,
      core: {reportPeer: vi.fn()} as unknown as INetworkCore,
      events: new NetworkEventBus(),
      logger,
      metrics: null,
    },
    {}
  );
  const beaconBlockHandler = handlers[GossipType.beacon_block] as SequentialGossipHandler<GossipType.beacon_block>;

  let threw = false;
  try {
    await beaconBlockHandler({
      gossipData: {serializedData: ssz.deneb.SignedBeaconBlock.serialize(signedBlock)},
      peerIdStr,
      seenTimestampSec: 0,
      topic: {
        boundary: {fork: ForkName.deneb, epoch: 0},
        type: GossipType.beacon_block,
      },
    });
  } catch {
    threw = true;
  }
  // The handler is now deferred via callInNextEventLoop (setTimeout 0), and it kicks off
  // processBlock (whose .then/.catch is a further hop). Flush two macrotask ticks so the deferred
  // import and its result handlers complete before assertions.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {processBlock, threw, getByBlock};
}

function getExecutionBlockError(
  signedBlock: SignedBeaconBlock<typeof ForkName.deneb>,
  code: BlockErrorCode.EXECUTION_ENGINE_ERROR | BlockErrorCode.EXECUTION_ENGINE_INVALID
): BlockError {
  if (code === BlockErrorCode.EXECUTION_ENGINE_ERROR) {
    return new BlockError(signedBlock, {
      code,
      execStatus: ExecutionPayloadStatus.ELERROR,
      errorMessage: "execution engine offline",
    });
  }

  return new BlockError(signedBlock, {
    code,
    execStatus: ExecutionPayloadStatus.INVALID,
    errorMessage: "invalid payload",
  });
}
