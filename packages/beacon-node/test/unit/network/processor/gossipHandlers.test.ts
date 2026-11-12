import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, gloas, ssz, sszTypesFor} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputNoData, BlockInputPreData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {PayloadError, PayloadErrorCode, PayloadErrorType} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/blockError.js";
import {
  BlockGossipError,
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
  GossipAction,
} from "../../../../src/chain/errors/index.js";
import {ChainEvent, ChainEventEmitter, IBeaconChain} from "../../../../src/chain/index.js";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/seenBlockProposers.js";
import {SeenBlockInput} from "../../../../src/chain/seenCache/seenGossipBlockInput.js";
import {validateGossipExecutionPayloadEnvelope} from "../../../../src/chain/validation/executionPayloadEnvelope.js";
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

vi.mock("../../../../src/chain/validation/executionPayloadEnvelope.js", async (importActual) => ({
  ...(await importActual<typeof import("../../../../src/chain/validation/executionPayloadEnvelope.js")>()),
  validateGossipExecutionPayloadEnvelope: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/chain/validation/dataColumnSidecar.js", async (importActual) => ({
  ...(await importActual<typeof import("../../../../src/chain/validation/dataColumnSidecar.js")>()),
  validateGossipGloasDataColumnSidecar: vi.fn().mockResolvedValue(undefined),
}));

describe.each([ForkName.gloas, ForkName.heze] as const)("incomplete payload gossip %s", (fork) => {
  const forkTypes = sszTypesFor(fork);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(blobCount = 1, gasLimit = 0n, parentGasLimit = 0) {
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
        HEZE_FORK_EPOCH: fork === ForkName.heze ? 0 : Infinity,
        PAYLOAD_DUE_BPS: 7500,
      },
      new Uint8Array(32)
    );
    vi.setSystemTime(config.getSlotDurationMs(fork));
    const block = forkTypes.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = Array.from(
      {length: blobCount},
      () => new Uint8Array(48)
    );
    block.message.body.signedExecutionPayloadBid.message.gasLimit = gasLimit;
    const blockRoot = forkTypes.BeaconBlock.hashTreeRoot(block.message);
    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex: toRootHex(blockRoot),
      forkName: fork,
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
      forkChoice: {
        getBlockHex: vi.fn().mockReturnValue(null),
        getBlockHexDefaultStatus: vi
          .fn()
          .mockReturnValue({executionPayloadBlockHash: "0x", executionPayloadGasLimit: parentGasLimit}),
      },
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

    function createEnvelope(transactionCount = 0) {
      const envelope = forkTypes.SignedExecutionPayloadEnvelope.defaultValue();
      envelope.message.beaconBlockRoot = blockRoot;
      envelope.message.payload.slotNumber = 1;
      envelope.message.payload.transactions = SerializedList.fromArray(
        Array.from({length: transactionCount}, () => new Uint8Array(1))
      );
      return envelope;
    }

    // Returns once gossip validation has passed, before the next event loop runs
    async function validateEnvelope(transactionCount = 0): Promise<void> {
      await envelopeHandler({
        gossipData: {
          serializedData: forkTypes.SignedExecutionPayloadEnvelope.serialize(createEnvelope(transactionCount)),
        },
        topic: {boundary: {fork, epoch: 0}, type: GossipType.execution_payload},
        peerIdStr,
        seenTimestampSec: Date.now() / 1000,
      });
    }

    async function sendEnvelope(transactionCount = 0): Promise<void> {
      await validateEnvelope(transactionCount);
      await vi.advanceTimersByTimeAsync(0);
    }

    async function sendColumn(index: number): Promise<void> {
      const column = forkTypes.DataColumnSidecar.defaultValue();
      column.beaconBlockRoot = blockRoot;
      column.slot = 1;
      column.index = index;
      await columnHandler({
        gossipData: {serializedData: forkTypes.DataColumnSidecar.serialize(column)},
        topic: {boundary: {fork, epoch: 0}, type: GossipType.data_column_sidecar, subnet: 0},
        peerIdStr,
        seenTimestampSec: Date.now() / 1000,
      });
      await vi.advanceTimersByTimeAsync(0);
    }

    return {
      chain,
      config,
      createEnvelope,
      emitter,
      payloadInput,
      onIncomplete,
      getPayloadInput,
      peerIdStr,
      sendEnvelope,
      sendColumn,
      validateEnvelope,
    };
  }

  // What BlockInputSync does when a by-root response lands, see toPendingPayloadInput
  function addByRootIfMissing(
    payloadInput: PayloadEnvelopeInput,
    envelope: gloas.SignedExecutionPayloadEnvelope
  ): void {
    if (!payloadInput.hasPayloadEnvelope()) {
      payloadInput.addPayloadEnvelope({
        envelope,
        source: PayloadEnvelopeInputSource.byRoot,
        seenTimestampSec: Date.now() / 1000,
      });
    }
  }

  it("adds a validated gossip envelope before the next event loop, so a by-root response cannot add it first", async () => {
    const {chain, createEnvelope, emitter, payloadInput, validateEnvelope} = setup();
    const onGossip = vi.fn();
    emitter.on(routes.events.EventType.executionPayloadGossip, onGossip);

    await validateEnvelope();
    expect(payloadInput.hasPayloadEnvelope()).toBe(true);
    expect(payloadInput.getPayloadEnvelopeSource().source).toBe(PayloadEnvelopeInputSource.gossip);

    addByRootIfMissing(payloadInput, createEnvelope());
    await vi.advanceTimersByTimeAsync(0);

    expect(onGossip).toHaveBeenCalledOnce();
    expect(chain.processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput, {validSignature: true});
  });

  it("still emits and imports if another source added the envelope while gossip validation was running", async () => {
    const {chain, createEnvelope, emitter, payloadInput, sendEnvelope} = setup();
    const onGossip = vi.fn();
    emitter.on(routes.events.EventType.executionPayloadGossip, onGossip);
    const byRootEnvelope = createEnvelope();
    addByRootIfMissing(payloadInput, byRootEnvelope);

    await sendEnvelope();

    expect(payloadInput.getPayloadEnvelope()).toBe(byRootEnvelope);
    expect(onGossip).toHaveBeenCalledOnce();
    // The stored envelope is not the one gossip validated, so its signature must be verified at import
    expect(chain.processExecutionPayload).toHaveBeenCalledExactlyOnceWith(payloadInput, {validSignature: false});
  });

  it("requests missing columns at the configured payload deadline when only the envelope arrives", async () => {
    const {config, payloadInput, onIncomplete, peerIdStr, sendEnvelope} = setup();
    await sendEnvelope();
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs(fork) - 1);
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
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs(fork) - 1);
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
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs(fork));
    expect(onIncomplete).toHaveBeenCalledOnce();
  });

  it("does not emit if gossip completes the payload before the deadline", async () => {
    const {config, payloadInput, onIncomplete, sendEnvelope, sendColumn} = setup();
    await sendEnvelope();
    await sendColumn(0);
    await sendColumn(1);
    expect(payloadInput.isComplete()).toBe(true);
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs(fork));
    expect(onIncomplete).not.toHaveBeenCalled();
  });

  it("does not arm a timeout for an envelope without blobs", async () => {
    const {config, payloadInput, onIncomplete, sendEnvelope} = setup(0);
    await sendEnvelope();
    expect(payloadInput.isComplete()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs(fork));
    expect(onIncomplete).not.toHaveBeenCalled();
  });

  it("emits once when the first message arrives after the deadline", async () => {
    const {config, onIncomplete, sendEnvelope, sendColumn} = setup();
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs(fork) + 1);
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
    await vi.advanceTimersByTimeAsync(config.getPayloadDueMs(fork));
    expect(onIncomplete).not.toHaveBeenCalled();
  });

  it("ignores an envelope with more transactions than the parent payload's gas limit allows before deserializing", async () => {
    const {config, payloadInput, sendEnvelope} = setup(0, 2n ** 62n, 30_000_000);
    vi.mocked(validateGossipExecutionPayloadEnvelope).mockClear();
    const maxTransactionCount = Math.floor(
      (30_000_000 + Math.floor(30_000_000 / 1024) - 1) / config.MIN_TRANSACTION_GAS
    );

    await expect(sendEnvelope(maxTransactionCount + 1)).rejects.toThrow(
      new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.TOO_MANY_TRANSACTIONS,
        slot: 1,
        root: payloadInput.blockRootHex,
        transactionCount: maxTransactionCount + 1,
        maxTransactionCount,
      })
    );
    expect(validateGossipExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(payloadInput.hasPayloadEnvelope()).toBe(false);

    await sendEnvelope(maxTransactionCount);
    expect(validateGossipExecutionPayloadEnvelope).toHaveBeenCalledOnce();
    expect(payloadInput.hasPayloadEnvelope()).toBe(true);
  });

  it("bounds the transaction count by the bid's gas limit if the parent payload's gas limit is unknown", async () => {
    const {config, payloadInput, sendEnvelope} = setup(0, 30_000_000n, 0);
    const maxTransactionCount = Math.floor(30_000_000 / config.MIN_TRANSACTION_GAS);

    await expect(sendEnvelope(maxTransactionCount + 1)).rejects.toThrow(
      new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.TOO_MANY_TRANSACTIONS,
        slot: 1,
        root: payloadInput.blockRootHex,
        transactionCount: maxTransactionCount + 1,
        maxTransactionCount,
      })
    );
    expect(payloadInput.hasPayloadEnvelope()).toBe(false);

    await sendEnvelope(maxTransactionCount);
    expect(payloadInput.hasPayloadEnvelope()).toBe(true);
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
  const gloasConfig = createBeaconConfig(
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

  beforeEach(() => {
    vi.mocked(validateGossipBlock).mockResolvedValue({skippedSlots: 0});
  });

  it("does not report the gossip peer when block processing hits an execution engine error", async () => {
    const {core} = await runBeaconBlockProcessingError(denebConfig, BlockErrorCode.EXECUTION_ENGINE_ERROR);

    expect(core.reportPeer).not.toHaveBeenCalled();
  });

  it("does not report the gossip peer when block data is unavailable", async () => {
    const {core} = await runBeaconBlockProcessingError(denebConfig, BlockErrorCode.DATA_UNAVAILABLE);

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

  it("imports a signature-verified REPEAT_PROPOSAL gloas block whose parent payload is known", async () => {
    const {processBlock, threw, getBlockHexAndBlockHash} = await runBeaconBlockRepeatProposal(gloasConfig, {
      recorded: true,
    });
    expect(getBlockHexAndBlockHash).toHaveBeenCalledExactlyOnceWith(
      toRootHex(Buffer.alloc(32, 0)),
      toRootHex(Buffer.alloc(32, 0xaa))
    );

    expect(processBlock).toHaveBeenCalledOnce();
    expect(threw).toBe(true);
  });

  it("does not import a signature-verified REPEAT_PROPOSAL gloas block whose parent conflicts with finalization", async () => {
    const {processBlock, threw, getByBlock, getBlockHexAndBlockHash} = await runBeaconBlockRepeatProposal(gloasConfig, {
      recorded: true,
      parentKnown: false,
    });
    expect(getBlockHexAndBlockHash).not.toHaveBeenCalled();
    expect(getByBlock).not.toHaveBeenCalled();

    expect(processBlock).not.toHaveBeenCalled();
    expect(threw).toBe(true);
  });

  it("does not import a signature-verified REPEAT_PROPOSAL gloas block whose parent payload is unknown", async () => {
    const {processBlock, threw, getByBlock} = await runBeaconBlockRepeatProposal(gloasConfig, {
      recorded: true,
      parentPayloadKnown: false,
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
  ])("evicts the cached envelope and reports the peer when payload processing fails with $code", async (errorType) => {
    const {removeInvalid, payloadInput, reportPeer, peerIdStr} = await runExecutionPayloadProcessingError(errorType);

    expect(removeInvalid).toHaveBeenCalledExactlyOnceWith(payloadInput);
    expect(reportPeer).toHaveBeenCalledExactlyOnceWith(peerIdStr, PeerAction.LowToleranceError, "BadGossipPayload");
  });

  it.each<PayloadErrorType>([
    {code: PayloadErrorCode.INVALID_SIGNATURE},
    {code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR, message: "parent_beacon_block_root mismatch"},
    {
      code: PayloadErrorCode.EXECUTION_ENGINE_INVALID,
      execStatus: ExecutionPayloadStatus.INVALID,
      errorMessage: "invalid payload",
    },
  ])("does not report the gossip peer when an envelope added by another source fails with $code", async (errorType) => {
    const {removeInvalid, payloadInput, reportPeer} = await runExecutionPayloadProcessingError(errorType, {
      addedByAnotherSource: true,
    });

    expect(removeInvalid).toHaveBeenCalledExactlyOnceWith(payloadInput);
    expect(reportPeer).not.toHaveBeenCalled();
  });

  it("keeps the cached envelope when payload data is unavailable", async () => {
    const {removeInvalid} = await runExecutionPayloadProcessingError({code: PayloadErrorCode.DATA_UNAVAILABLE});

    expect(removeInvalid).not.toHaveBeenCalled();
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

async function runExecutionPayloadProcessingError(
  errorType: PayloadErrorType,
  opts: {addedByAnotherSource?: boolean} = {}
): Promise<{
  removeInvalid: ReturnType<typeof vi.fn>;
  payloadInput: PayloadEnvelopeInput;
  reportPeer: ReturnType<typeof vi.fn>;
  peerIdStr: PeerIdStr;
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

  if (opts.addedByAnotherSource) {
    const byRootEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.clone(signedEnvelope);
    payloadInput.addPayloadEnvelope({
      envelope: byRootEnvelope,
      source: PayloadEnvelopeInputSource.byRoot,
      seenTimestampSec: 0,
    });
  }

  const removeInvalid = vi.fn();
  const reportPeer = vi.fn();
  const chain = {
    config,
    clock: new ClockStopped(1),
    emitter: new ChainEventEmitter(),
    logger,
    processExecutionPayload: vi.fn().mockRejectedValue(new PayloadError(payloadInput, errorType)),
    forkChoice: {getBlockHexDefaultStatus: vi.fn().mockReturnValue(null)},
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
      core: {reportPeer} as unknown as INetworkCore,
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

  return {removeInvalid, payloadInput, reportPeer, peerIdStr};
}

async function runBeaconBlockProcessingError(
  config: BeaconConfig,
  code:
    | BlockErrorCode.EXECUTION_ENGINE_ERROR
    | BlockErrorCode.EXECUTION_ENGINE_INVALID
    | BlockErrorCode.DATA_UNAVAILABLE
): Promise<{
  core: Pick<INetworkCore, "reportPeer">;
  peerIdStr: PeerIdStr;
}> {
  const logger = testLogger();
  const peerIdStr = "16Uiu2HAmTestGossipPeer" as PeerIdStr;
  const signedBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
  signedBlock.message.slot = 1;
  const blockRootHex = toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(signedBlock.message));
  const blockInput = BlockInputPreData.createFromBlock({
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
  {
    recorded,
    reject = false,
    parentKnown = true,
    parentPayloadKnown = true,
  }: {recorded: boolean; reject?: boolean; parentKnown?: boolean; parentPayloadKnown?: boolean}
): Promise<{
  processBlock: ReturnType<typeof vi.fn>;
  threw: boolean;
  getByBlock: ReturnType<typeof vi.fn>;
  getBlockHexAndBlockHash: ReturnType<typeof vi.fn>;
}> {
  const logger = testLogger();
  const peerIdStr = "16Uiu2HAmTestGossipPeer" as PeerIdStr;
  const fork = config.getForkName(1);
  const blockInputMeta = {
    daOutOfRange: false,
    source: BlockInputSource.gossip,
    seenTimestampSec: 0,
    peerIdStr,
  };
  let signedBlock: SignedBeaconBlock;
  let blockRootHex: RootHex;
  let serializedData: Uint8Array;
  let blockInput: BlockInputPreData | BlockInputNoData;
  if (fork === ForkName.gloas) {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.proposerIndex = 3;
    block.message.body.signedExecutionPayloadBid.message.parentBlockHash = Buffer.alloc(32, 0xaa);
    blockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
    serializedData = ssz.gloas.SignedBeaconBlock.serialize(block);
    blockInput = BlockInputNoData.createFromBlock({...blockInputMeta, block, blockRootHex, forkName: ForkName.gloas});
    signedBlock = block;
  } else {
    const block = ssz.deneb.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.proposerIndex = 3;
    blockRootHex = toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(block.message));
    serializedData = ssz.deneb.SignedBeaconBlock.serialize(block);
    blockInput = BlockInputPreData.createFromBlock({...blockInputMeta, block, blockRootHex, forkName: ForkName.deneb});
    signedBlock = block;
  }

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
  const getBlockHexAndBlockHash = vi.fn().mockReturnValue(parentPayloadKnown ? {} : null);
  const chain = {
    clock: new ClockStopped(1),
    custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
    emitter: new ChainEventEmitter(),
    forkChoice: {
      getBlockHexDefaultStatus: vi.fn().mockReturnValue(parentKnown ? {} : null),
      getBlockHexAndBlockHash,
    },
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
      gossipData: {serializedData},
      peerIdStr,
      seenTimestampSec: 0,
      topic: {
        boundary: {fork, epoch: 0},
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

  return {processBlock, threw, getByBlock, getBlockHexAndBlockHash};
}

function getExecutionBlockError(
  signedBlock: SignedBeaconBlock<typeof ForkName.deneb>,
  code:
    | BlockErrorCode.EXECUTION_ENGINE_ERROR
    | BlockErrorCode.EXECUTION_ENGINE_INVALID
    | BlockErrorCode.DATA_UNAVAILABLE
): BlockError {
  if (code === BlockErrorCode.DATA_UNAVAILABLE) {
    return new BlockError(signedBlock, {code});
  }

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
