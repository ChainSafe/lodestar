import {beforeEach, describe, expect, it, vi} from "vitest";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputBlobs} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/blockError.js";
import {BlockGossipError, GossipAction} from "../../../../src/chain/errors/index.js";
import {ChainEventEmitter, IBeaconChain} from "../../../../src/chain/index.js";
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
    const {processBlock, threw} = await runBeaconBlockRepeatProposal(denebConfig, {recorded: true});

    // imported so LMD-GHOST can weigh it ...
    expect(processBlock).toHaveBeenCalledOnce();
    // ... but the gossip result stays IGNORE (handler re-throws), so the message is not forwarded
    expect(threw).toBe(true);
  });

  it("does not import a REPEAT_PROPOSAL block whose root was not recorded (unverified 3rd+ proposal)", async () => {
    const {processBlock, threw} = await runBeaconBlockRepeatProposal(denebConfig, {recorded: false});

    expect(processBlock).not.toHaveBeenCalled();
    expect(threw).toBe(true);
  });
});

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
      prune: vi.fn(),
    } as unknown as SeenBlockInput,
    seenPayloadEnvelopeInputCache: {
      add: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      prune: vi.fn(),
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
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {core, peerIdStr};
}

async function runBeaconBlockRepeatProposal(
  config: BeaconConfig,
  {recorded}: {recorded: boolean}
): Promise<{processBlock: ReturnType<typeof vi.fn>; threw: boolean}> {
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

  // gossip validation rejects the 2nd distinct block for this (proposer, slot) with REPEAT_PROPOSAL
  vi.mocked(validateGossipBlock).mockRejectedValue(
    new BlockGossipError(GossipAction.IGNORE, {
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
  const chain = {
    clock: new ClockStopped(1),
    custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
    emitter: new ChainEventEmitter(),
    getBlobsTracker: {triggerGetBlobs: vi.fn()},
    logger,
    processBlock,
    processProposerEquivocation: vi.fn(),
    seenBlockProposers,
    seenBlockInputCache: {
      getByBlock: vi.fn().mockReturnValue(blockInput),
      get: vi.fn().mockReturnValue(blockInput),
      prune: vi.fn(),
    } as unknown as SeenBlockInput,
    seenPayloadEnvelopeInputCache: {
      add: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      prune: vi.fn(),
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
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {processBlock, threw};
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
