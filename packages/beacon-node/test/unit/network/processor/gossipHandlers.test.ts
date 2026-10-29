import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, ssz, sszTypesFor} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {GossipBlockResult} from "../../../../src/chain/beaconEngine/gossipValidation/block.js";
import {
  GossipValidationStatus,
  runGossipValidation,
} from "../../../../src/chain/beaconEngine/gossipValidationResult.js";
import {BlockInputBlobs, BlockInputNoData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {PayloadError, PayloadErrorCode, PayloadErrorType} from "../../../../src/chain/blocks/payloadError.js";
import {BlockError, BlockErrorCode, BlockErrorType} from "../../../../src/chain/errors/blockError.js";
import {BlockGossipError, GossipAction} from "../../../../src/chain/errors/index.js";
import {ChainEvent, ChainEventEmitter, IBeaconChain} from "../../../../src/chain/index.js";
import {SeenBlockInput} from "../../../../src/chain/seenCache/seenGossipBlockInput.js";
import {validateGossipBlock} from "../../../../src/chain/validation/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NetworkEventBus} from "../../../../src/network/events.js";
import {GossipType, SequentialGossipHandler} from "../../../../src/network/gossip/interface.js";
import {PeerAction} from "../../../../src/network/peers/index.js";
import {getGossipHandlers} from "../../../../src/network/processor/gossipHandlers.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";
import {PeerIdStr} from "../../../../src/util/peerId.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
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

describe.each([ForkName.gloas, ForkName.heze] as const)("incomplete payload gossip %s", (fork) => {
  const forkTypes = sszTypesFor(fork);

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
      beaconEngine: {
        chainView: {getBlockHex: vi.fn().mockReturnValue(null)},
        validateGossipExecutionPayloadEnvelope: vi.fn().mockResolvedValue({err: null, result: undefined}),
        validateGossipGloasDataColumnSidecar: vi.fn().mockResolvedValue({err: null, result: undefined}),
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
      const envelope = forkTypes.SignedExecutionPayloadEnvelope.defaultValue();
      envelope.message.beaconBlockRoot = blockRoot;
      envelope.message.payload.slotNumber = 1;
      await envelopeHandler({
        gossipData: {serializedData: forkTypes.SignedExecutionPayloadEnvelope.serialize(envelope)},
        topic: {boundary: {fork, epoch: 0}, type: GossipType.execution_payload},
        peerIdStr,
        seenTimestampSec: Date.now() / 1000,
      });
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

    return {config, payloadInput, onIncomplete, getPayloadInput, peerIdStr, sendEnvelope, sendColumn};
  }

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

  it.each([ForkName.deneb, ForkName.electra, ForkName.fulu, ForkName.gloas])(
    "ignores an imported %s block through ChainView before populating caches or calling the engine",
    async (fork) => {
      const config = createBeaconConfig(getConfig(fork), Buffer.alloc(32));
      const forkTypes = config.getForkTypes(1);
      const signedBlock = forkTypes.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = 1;
      const attestation = forkTypes.Attestation.defaultValue();
      attestation.aggregationBits = BitArray.fromSingleBit(9, 8);
      signedBlock.message.body.attestations = [attestation];
      const bytes = forkTypes.SignedBeaconBlock.serialize(signedBlock);
      const originalBytes = Uint8Array.from(bytes);
      const blockRootHex = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));
      const logger = testLogger();
      const hasBlockHex = vi.fn().mockReturnValue(true);
      const getByBlock = vi.fn();
      const addPayloadInput = vi.fn();
      const validateEngineBlock = vi.fn().mockResolvedValue({
        err: {
          status: GossipValidationStatus.Ignore,
          code: BlockErrorCode.ALREADY_KNOWN,
          error: new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRootHex}),
        },
      });
      const serializedCache = new SerializedCache();
      const chain = {
        serializedCache,
        opts: {},
        clock: new ClockStopped(1),
        custodyConfig: {sampledColumns: [], custodyColumns: []},
        seenBlockInputCache: {getByBlock},
        seenPayloadEnvelopeInputCache: {add: addPayloadInput},
        beaconEngine: {
          validateGossipBlock: validateEngineBlock,
          chainView: {
            hasBlockHex,
          },
        },
      } as unknown as IBeaconChain;
      const handlers = getGossipHandlers({
        chain,
        config,
        core: {reportPeer: vi.fn()} as unknown as INetworkCore,
        events: new NetworkEventBus(),
        logger,
        metrics: null,
      });
      const handler = handlers[GossipType.beacon_block] as SequentialGossipHandler<GossipType.beacon_block>;

      const result = await handler({
        gossipData: {serializedData: bytes},
        peerIdStr: "16Uiu2HAmTestGossipPeer",
        seenTimestampSec: 0,
        topic: {boundary: {fork, epoch: 0}, type: GossipType.beacon_block},
      });

      expect(result).toMatchObject({err: {status: GossipValidationStatus.Ignore, code: BlockErrorCode.ALREADY_KNOWN}});
      expect(hasBlockHex).toHaveBeenCalledExactlyOnceWith(blockRootHex);
      expect(serializedCache.get(signedBlock)).toBeUndefined();
      expect(getByBlock).not.toHaveBeenCalled();
      expect(addPayloadInput).not.toHaveBeenCalled();
      expect(validateEngineBlock).not.toHaveBeenCalled();
      expect(bytes).toEqual(originalBytes);
    }
  );

  it("does not report the gossip peer when block processing hits an execution engine error", async () => {
    const {core} = await runBeaconBlockProcessingError(denebConfig, BlockErrorCode.EXECUTION_ENGINE_ERROR);

    expect(core.reportPeer).not.toHaveBeenCalled();
  });

  it("does not report the gossip peer when the local signed candidate was evicted", async () => {
    const {core} = await runBeaconBlockProcessingError(denebConfig, BlockErrorCode.GOSSIP_BLOCK_NOT_CACHED);

    expect(core.reportPeer).not.toHaveBeenCalled();
  });

  it("does not report the gossip peer when block data is unavailable", async () => {
    const {core} = await runBeaconBlockProcessingError(denebConfig, BlockErrorCode.DATA_UNAVAILABLE);

    expect(core.reportPeer).not.toHaveBeenCalled();
  });

  it.each(["INVALID_BLOCK_SSZ", "SIGNED_BLOCK_ROOT_MISMATCH", "UNEXPECTED_ERROR"])(
    "handles the plain engine verdict %s without an error instance",
    async (code) => {
      const config = denebConfig;
      const signedBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
      const root = toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(signedBlock.message));
      const status = code === "UNEXPECTED_ERROR" ? GossipValidationStatus.Ignore : GossipValidationStatus.Reject;
      const persistInvalidSszValue = vi.fn();
      const remove = vi.fn();
      const serializedCache = new SerializedCache();
      const chain = {
        serializedCache,
        opts: {},
        clock: new ClockStopped(0),
        seenBlockInputCache: {
          getByBlock: vi.fn(),
          remove,
          markValidatingBlock: vi.fn(),
          unmarkValidatingBlock: vi.fn(),
        },
        persistInvalidSszValue,
        beaconEngine: {
          validateGossipBlock: vi
            .fn()
            .mockResolvedValue({err: {status, code}, shouldProcessRepeatProposalBlock: false}),
          chainView: {
            hasBlockHex: () => false,
          },
        },
      } as unknown as IBeaconChain;
      const handlers = getGossipHandlers({
        chain,
        config,
        core: {reportPeer: vi.fn()} as unknown as INetworkCore,
        events: new NetworkEventBus(),
        logger: testLogger(),
        metrics: null,
      });
      const handler = handlers[GossipType.beacon_block] as SequentialGossipHandler<GossipType.beacon_block>;

      await expect(
        handler({
          gossipData: {serializedData: ssz.deneb.SignedBeaconBlock.serialize(signedBlock)},
          peerIdStr: "16Uiu2HAmTestGossipPeer",
          seenTimestampSec: 0,
          topic: {boundary: {fork: ForkName.deneb, epoch: 0}, type: GossipType.beacon_block},
        })
      ).resolves.toMatchObject({err: {status, code}});
      expect(chain.beaconEngine.validateGossipBlock).toHaveBeenCalledExactlyOnceWith(
        signedBlock,
        ssz.deneb.SignedBeaconBlock.serialize(signedBlock),
        ForkName.deneb,
        0
      );

      if (status === GossipValidationStatus.Reject) {
        expect(persistInvalidSszValue).toHaveBeenCalledExactlyOnceWith(
          config.getForkTypes(0).SignedBeaconBlock,
          signedBlock,
          "gossip_reject_slot_0",
          root
        );
      } else {
        expect(persistInvalidSszValue).not.toHaveBeenCalled();
      }
      expect(remove).not.toHaveBeenCalled();
      expect(serializedCache.get(signedBlock)).toBeUndefined();
    }
  );

  it.each([
    [ForkName.deneb, BlockErrorCode.PARENT_BLOCK_UNKNOWN],
    [ForkName.gloas, BlockErrorCode.PARENT_BLOCK_UNKNOWN],
    [ForkName.gloas, BlockErrorCode.PARENT_PAYLOAD_UNKNOWN],
  ] as const)("retains the cached %s block for a plain %s verdict", async (fork, code) => {
    const config = createBeaconConfig(getConfig(fork), Buffer.alloc(32));
    const forkTypes = config.getForkTypes(1);
    const signedBlock = forkTypes.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    const blockRootHex = toRootHex(forkTypes.BeaconBlock.hashTreeRoot(signedBlock.message));
    const bytes = forkTypes.SignedBeaconBlock.serialize(signedBlock);
    const serializedCache = new SerializedCache();
    const clock = new ClockStopped(0);
    const emitter = new ChainEventEmitter();
    const unknownParent = vi.fn();
    emitter.on(ChainEvent.blockUnknownParent, unknownParent);
    const controller = new AbortController();
    const custodyConfig = {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig;
    const seenBlockInputCache = new SeenBlockInput({
      config,
      clock,
      chainEvents: emitter,
      signal: controller.signal,
      custodyConfig,
      serializedCache,
      metrics: null,
    });
    const addPayloadInput = vi.fn();
    const parentRoot = toRootHex(signedBlock.message.parentRoot);
    const blockErrorType: BlockErrorType =
      code === BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
        ? {code, parentRoot, parentBlockHash: toRootHex(Buffer.alloc(32))}
        : {code, parentRoot};
    const chain = {
      opts: {},
      serializedCache,
      clock,
      emitter,
      custodyConfig,
      seenBlockInputCache,
      seenPayloadEnvelopeInputCache: {add: addPayloadInput},
      beaconEngine: {
        validateGossipBlock: vi.fn().mockResolvedValue({
          err: {
            status: GossipValidationStatus.Ignore,
            code,
          },
          blockErrorType,
          shouldProcessRepeatProposalBlock: false,
        } satisfies GossipBlockResult),
        chainView: {
          hasBlockHex: () => false,
        },
      },
    } as unknown as IBeaconChain;
    const handlers = getGossipHandlers({
      chain,
      config,
      core: {reportPeer: vi.fn()} as unknown as INetworkCore,
      events: new NetworkEventBus(),
      logger: testLogger(),
      metrics: null,
    });
    const handler = handlers[GossipType.beacon_block] as SequentialGossipHandler<GossipType.beacon_block>;

    try {
      const result = await handler({
        gossipData: {serializedData: Uint8Array.from(bytes)},
        peerIdStr: "16Uiu2HAmTestGossipPeer",
        seenTimestampSec: 0,
        topic: {boundary: {fork, epoch: 0}, type: GossipType.beacon_block},
      });

      expect(result).toMatchObject({
        err: {
          status: GossipValidationStatus.Ignore,
          code,
        },
      });
      expect(result.err?.error).toBeInstanceOf(BlockGossipError);
      expect(result.err?.error).toMatchObject({type: blockErrorType});
      const blockInput = seenBlockInputCache.get(blockRootHex);
      expect(blockInput).toBeDefined();
      expect(unknownParent).toHaveBeenCalledExactlyOnceWith({
        blockInput,
        peer: "16Uiu2HAmTestGossipPeer",
        source: BlockInputSource.gossip,
      });
      if (!blockInput) throw new Error("Missing retained block input");
      expect(serializedCache.get(blockInput.getBlock())).toEqual(bytes);
      seenBlockInputCache.remove(blockRootHex);
      expect(serializedCache.get(blockInput.getBlock())).toBeUndefined();
      expect(forkTypes.SignedBeaconBlock.equals(blockInput.getBlock(), signedBlock)).toBe(true);
      expect(chain.beaconEngine.validateGossipBlock).toHaveBeenCalledExactlyOnceWith(signedBlock, bytes, fork, 0);
      if (fork === ForkName.gloas) {
        expect(addPayloadInput).toHaveBeenCalledOnce();
        expect(addPayloadInput.mock.calls[0][0].block).toBe(blockInput?.getBlock());
      }
    } finally {
      controller.abort();
    }
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
    // ... but the gossip verdict stays IGNORE, so the message is not forwarded
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
    const {processBlock, threw} = await runBeaconBlockRepeatProposal(gloasConfig, {
      recorded: true,
    });

    expect(processBlock).toHaveBeenCalledOnce();
    expect(threw).toBe(true);
  });

  it("does not import a signature-verified REPEAT_PROPOSAL gloas block whose parent conflicts with finalization", async () => {
    const {processBlock, threw, getByBlock} = await runBeaconBlockRepeatProposal(gloasConfig, {
      recorded: true,
      parentKnown: false,
    });
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
  ])("evicts the cached envelope when payload processing fails with $code", async (errorType) => {
    const {removeInvalid, payloadInput} = await runExecutionPayloadProcessingError(errorType);

    expect(removeInvalid).toHaveBeenCalledExactlyOnceWith(payloadInput);
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
    opts: {},
    clock: new ClockStopped(1),
    emitter: new ChainEventEmitter(),
    logger,
    beaconEngine: {
      validateGossipExecutionPayloadEnvelope: vi.fn().mockResolvedValue({err: null, result: undefined}),
    },
    processExecutionPayload: vi.fn().mockRejectedValue(new PayloadError(errorType)),
    seenPayloadEnvelopeInputCache: {
      get: vi.fn().mockReturnValue(payloadInput),
      removeInvalid,
    } as unknown as IBeaconChain["seenPayloadEnvelopeInputCache"],
    serializedCache: {set: vi.fn()},
  } as unknown as IBeaconChain;

  const handlers = getGossipHandlers(
    {
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
  code:
    | BlockErrorCode.EXECUTION_ENGINE_ERROR
    | BlockErrorCode.EXECUTION_ENGINE_INVALID
    | BlockErrorCode.GOSSIP_BLOCK_NOT_CACHED
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
    opts: {},
    clock: new ClockStopped(1),
    custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
    emitter: new ChainEventEmitter(),
    getBlobsTracker: {triggerGetBlobs: vi.fn()},
    logger,
    processBlock: vi.fn().mockRejectedValue(error),
    beaconEngine: {
      validateGossipBlock: async () => ({
        ...(await runGossipValidation(() =>
          validateGossipBlock.call({} as BeaconEngineCore, signedBlock, ForkName.deneb)
        )),
        shouldProcessRepeatProposalBlock: false,
      }),
      chainView: {
        hasBlockHex: vi.fn().mockReturnValue(false),
      },
    },
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
  let blockInput: BlockInputBlobs | BlockInputNoData;
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
    blockInput = BlockInputBlobs.createFromBlock({...blockInputMeta, block, blockRootHex, forkName: ForkName.deneb});
    signedBlock = block;
  }

  const processBlock = vi.fn().mockResolvedValue(undefined);
  const getByBlock = vi.fn().mockReturnValue(blockInput);
  const blockErrorType: BlockErrorType = {
    code: reject ? BlockErrorCode.INCORRECT_PROPOSER : BlockErrorCode.REPEAT_PROPOSAL,
    slot: signedBlock.message.slot,
    proposerIndex: signedBlock.message.proposerIndex,
    root: blockRootHex,
  };
  const chain = {
    opts: {},
    clock: new ClockStopped(1),
    custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
    emitter: new ChainEventEmitter(),
    getBlobsTracker: {triggerGetBlobs: vi.fn()},
    logger,
    persistInvalidSszValue: vi.fn(),
    processBlock,
    beaconEngine: {
      validateGossipBlock: vi.fn().mockResolvedValue({
        err: {
          status: reject ? GossipValidationStatus.Reject : GossipValidationStatus.Ignore,
          code: blockErrorType.code,
        },
        blockErrorType,
        shouldProcessRepeatProposalBlock:
          !reject && recorded && parentKnown && (fork !== ForkName.gloas || parentPayloadKnown),
      } satisfies GossipBlockResult),
      chainView: {
        hasBlockHex: vi.fn().mockReturnValue(false),
      },
    },
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

  const result = await beaconBlockHandler({
    gossipData: {serializedData: serializedData},
    peerIdStr,
    seenTimestampSec: 0,
    topic: {
      boundary: {fork, epoch: 0},
      type: GossipType.beacon_block,
    },
  });
  expect(result).toMatchObject({
    err: {
      status: reject ? GossipValidationStatus.Reject : GossipValidationStatus.Ignore,
      code: reject ? BlockErrorCode.INCORRECT_PROPOSER : BlockErrorCode.REPEAT_PROPOSAL,
    },
  });
  expect(result.err?.error).toBeInstanceOf(BlockGossipError);
  expect(result.err?.error).toMatchObject({
    action: reject ? GossipAction.REJECT : GossipAction.IGNORE,
    type: blockErrorType,
    shouldProcessRepeatProposalBlock:
      !reject && recorded && parentKnown && (fork !== ForkName.gloas || parentPayloadKnown),
  });
  const threw = result.err !== null;
  // The handler is now deferred via callInNextEventLoop (setTimeout 0), and it kicks off
  // processBlock (whose .then/.catch is a further hop). Flush two macrotask ticks so the deferred
  // import and its result handlers complete before assertions.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {processBlock, threw, getByBlock};
}

function getExecutionBlockError(
  signedBlock: SignedBeaconBlock<typeof ForkName.deneb>,
  code:
    | BlockErrorCode.EXECUTION_ENGINE_ERROR
    | BlockErrorCode.EXECUTION_ENGINE_INVALID
    | BlockErrorCode.GOSSIP_BLOCK_NOT_CACHED
    | BlockErrorCode.DATA_UNAVAILABLE
): BlockError {
  if (code === BlockErrorCode.GOSSIP_BLOCK_NOT_CACHED || code === BlockErrorCode.DATA_UNAVAILABLE)
    return new BlockError(signedBlock, {code});
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
