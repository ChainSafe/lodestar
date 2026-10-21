import {beforeEach, describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {GossipBlockResult} from "../../../../src/chain/beaconEngine/gossipValidation/block.js";
import {
  GossipValidationStatus,
  runGossipValidation,
} from "../../../../src/chain/beaconEngine/gossipValidationResult.js";
import {BlockInputBlobs} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {BlockSerializedCache} from "../../../../src/chain/blocks/blockSerializedCache.js";
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
      const blockSerializedCache = new BlockSerializedCache(config);
      const chain = {
        hasBlockHex,
        blockSerializedCache,
        clock: new ClockStopped(1),
        custodyConfig: {sampledColumns: [], custodyColumns: []},
        seenBlockInputCache: {getByBlock},
        seenPayloadEnvelopeInputCache: {add: addPayloadInput},
        beaconEngine: {validateGossipBlock: validateEngineBlock},
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
      expect(blockSerializedCache.get(blockRootHex)).toBeUndefined();
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

  it.each(["INVALID_BLOCK_SSZ", "BLOCK_ROOT_MISMATCH", "UNEXPECTED_ERROR"])(
    "handles the plain engine verdict %s without an error instance",
    async (code) => {
      const config = denebConfig;
      const signedBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
      const root = toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(signedBlock.message));
      const status = code === "UNEXPECTED_ERROR" ? GossipValidationStatus.Ignore : GossipValidationStatus.Reject;
      const persistInvalidSszValue = vi.fn();
      const remove = vi.fn();
      const blockSerializedCache = new BlockSerializedCache(config);
      const chain = {
        hasBlockHex: () => false,
        blockSerializedCache,
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
      expect(blockSerializedCache.get(root)).toBeUndefined();
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
    const blockSerializedCache = new BlockSerializedCache(config);
    blockSerializedCache.set(blockRootHex, signedBlock, bytes);
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
      serializedCache: new SerializedCache(),
      blockSerializedCache,
      metrics: null,
    });
    const addPayloadInput = vi.fn();
    const parentRoot = toRootHex(signedBlock.message.parentRoot);
    const blockErrorType: BlockErrorType =
      code === BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
        ? {code, parentRoot, parentBlockHash: toRootHex(Buffer.alloc(32))}
        : {code, parentRoot};
    const chain = {
      hasBlockHex: () => false,
      blockSerializedCache,
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
      seenBlockInputCache.remove(blockRootHex);
      expect(blockSerializedCache.get(blockRootHex)).toBeUndefined();
      expect(blockInput?.getBlock()).toBe(signedBlock);
      if (fork === ForkName.gloas) {
        expect(addPayloadInput).toHaveBeenCalledOnce();
        expect(addPayloadInput.mock.calls[0][0].block).toBe(signedBlock);
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
    blockSerializedCache: new BlockSerializedCache(config),
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
    hasBlockHex: vi.fn().mockReturnValue(false),
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
    blockSerializedCache: new BlockSerializedCache(config),
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

  const processBlock = vi.fn().mockResolvedValue(undefined);
  const getByBlock = vi.fn().mockReturnValue(blockInput);
  const blockErrorType: BlockErrorType = {
    code: reject ? BlockErrorCode.INCORRECT_PROPOSER : BlockErrorCode.REPEAT_PROPOSAL,
    slot: signedBlock.message.slot,
    proposerIndex: signedBlock.message.proposerIndex,
    root: blockRootHex,
  };
  const chain = {
    hasBlockHex: vi.fn().mockReturnValue(false),
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
        shouldProcessRepeatProposalBlock: !reject && recorded && parentKnown,
      } satisfies GossipBlockResult),
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
    blockSerializedCache: new BlockSerializedCache(config),
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
    gossipData: {serializedData: ssz.deneb.SignedBeaconBlock.serialize(signedBlock)},
    peerIdStr,
    seenTimestampSec: 0,
    topic: {
      boundary: {fork: ForkName.deneb, epoch: 0},
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
    shouldProcessRepeatProposalBlock: !reject && recorded && parentKnown,
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
