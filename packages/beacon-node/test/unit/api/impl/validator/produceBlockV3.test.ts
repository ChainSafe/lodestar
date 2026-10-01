import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, ZERO_HASH_HEX} from "@lodestar/params";
import {BeaconStateView, G2_POINT_AT_INFINITY, computeTimeAtSlot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {BeaconEngine} from "../../../../../src/chain/beaconEngine/beaconEngine.js";
import {BlockType, produceBlockBody} from "../../../../../src/chain/produceBlock/index.js";
import {BuilderStatus} from "../../../../../src/execution/builder/http.js";
import {PayloadIdCache} from "../../../../../src/execution/index.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {toGraffitiBytes} from "../../../../../src/util/graffiti.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {generateCachedBellatrixState} from "../../../../utils/state.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";

describe("api/validator - produceBlockV3", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getValidatorApi>;
  let state: BeaconStateView;

  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 1,
  });
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

  beforeEach(() => {
    modules = getApiTestModules({config});
    api = getValidatorApi(defaultApiOptions, {...modules, config});
    state = new BeaconStateView(generateCachedBellatrixState());

    vi.spyOn(modules.chain.clock, "msFromSlot").mockReturnValue(0);
    modules.chain.executionBuilder.status = BuilderStatus.enabled;
    modules.chain.beaconEngine.produceBlock = vi.fn(
      BeaconEngine.prototype.produceBlock.bind(modules.chain.beaconEngine)
    );
    modules.chain.beaconEngine.produceCommonBlockBody = vi.fn().mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("correctly pass feeRecipient to produceBlock", async () => {
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
    const executionPayloadValue = ssz.Wei.defaultValue();
    const consensusBlockValue = ssz.Wei.defaultValue();

    const currentSlot = 100000;
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(currentSlot);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);

    // Set the node's state to way back from current slot
    const slot = 100000;
    fullBlock.slot = slot;
    const randaoReveal = fullBlock.body.randaoReveal;
    const parentBlockRoot = fullBlock.parentRoot;
    const parentBlock = generateProtoBlock({blockRoot: toRootHex(parentBlockRoot), slot: currentSlot - 1});
    const graffiti = "a".repeat(32);
    const feeRecipient = "0xcccccccccccccccccccccccccccccccccccccccc";

    modules.chain.getProposerHead.mockReturnValue(parentBlock);
    modules.chain.recomputeForkChoiceHead.mockReturnValue(parentBlock);
    modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(parentBlock);
    modules.chain.produceBlockWrapper.mockResolvedValue({
      block: fullBlock,
      executionPayloadValue,
      consensusBlockValue,
      produceResult: {
        type: BlockType.Full,
        fork: ForkName.bellatrix,
        executionPayload: fullBlock.body.executionPayload,
      },
    });

    // check if expectedFeeRecipient is passed to produceBlock
    await api.produceBlockV3({slot, randaoReveal, graffiti, feeRecipient});
    expect(modules.chain.produceBlockWrapper).toBeCalledWith(BlockType.Full, {
      randaoReveal,
      graffiti: toGraffitiBytes(graffiti),
      slot,
      parentBlock,
      feeRecipient,
      commonBlockBodyPromise: expect.any(Promise),
    });

    // check that no feeRecipient is passed to produceBlock so that produceBlockBody will
    // pick it from beaconProposerCache
    await api.produceBlockV3({slot, randaoReveal, graffiti});
    expect(modules.chain.produceBlockWrapper).toBeCalledWith(BlockType.Full, {
      randaoReveal,
      graffiti: toGraffitiBytes(graffiti),
      slot,
      parentBlock,
      feeRecipient: undefined,
      commonBlockBodyPromise: expect.any(Promise),
    });
  });

  it("correctly use passed feeRecipient in notifyForkchoiceUpdate", async () => {
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
    const executionPayloadValue = ssz.Wei.defaultValue();
    const slot = 100000;
    fullBlock.slot = slot;
    const randaoReveal = fullBlock.body.randaoReveal;
    const graffiti = "a".repeat(32);
    const feeRecipient = "0xccccccccccccccccccccccccccccccccccccccaa";

    const headSlot = 0;
    modules.chain.getProposerHead.mockReturnValue(generateProtoBlock({slot: headSlot}));

    modules.chain.recomputeForkChoiceHead.mockReturnValue(generateProtoBlock({slot: headSlot}));
    modules.chain["opPool"].getSlashingsAndExits.mockReturnValue([[], [], [], []]);
    modules.chain["aggregatedAttestationPool"].getAttestationsForBlock.mockReturnValue([]);
    modules.chain["syncContributionAndProofPool"].getAggregate.mockReturnValue({
      syncCommitteeBits: ssz.altair.SyncCommitteeBits.defaultValue(),
      syncCommitteeSignature: G2_POINT_AT_INFINITY,
    });
    modules.forkChoice.getJustifiedBlock.mockReturnValue({} as ProtoBlock);
    modules.forkChoice.getFinalizedBlock.mockReturnValue({} as ProtoBlock);

    modules.chain["executionEngine"].payloadIdCache = new PayloadIdCache();
    modules.chain["executionEngine"].notifyForkchoiceUpdate.mockResolvedValue("0x");
    modules.chain["executionEngine"].getPayload.mockResolvedValue({
      executionPayload: ssz.bellatrix.ExecutionPayload.defaultValue(),
      executionPayloadValue,
    });

    // Helper function to create a mock common block body promise
    const createCommonBlockBodyPromise = async () => ({
      attestations: [],
      attesterSlashings: [],
      proposerSlashings: [],
      voluntaryExits: [],
      blsToExecutionChanges: [],
      syncAggregate: ssz.altair.SyncAggregate.defaultValue(),
      eth1Data: ssz.phase0.Eth1Data.defaultValue(),
      deposits: [],
      randaoReveal,
      graffiti: toGraffitiBytes(graffiti),
    });

    // use fee recipient passed in produceBlockBody call for payload gen in engine notifyForkchoiceUpdate
    await produceBlockBody.call(modules.chain.beaconEngine, BlockType.Full, state, {
      randaoReveal,
      graffiti: toGraffitiBytes(graffiti),
      slot,
      feeRecipient,
      parentBlock: generateProtoBlock({blockRoot: ZERO_HASH_HEX}),
      proposerIndex: 0,
      proposerPubKey: new Uint8Array(32).fill(1),
      commonBlockBodyPromise: createCommonBlockBodyPromise(),
    });

    expect(modules.chain["executionEngine"].notifyForkchoiceUpdate).toBeCalledWith(
      ForkName.bellatrix,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      {
        timestamp: computeTimeAtSlot(modules.config, state.slot, state.genesisTime),
        prevRandao: new Uint8Array(32),
        suggestedFeeRecipient: feeRecipient,
      }
    );

    modules.chain.beaconProposerCache.getOrDefault.mockReturnValue("0x fee recipient address");

    // No fee recipient passed: use the engine-owned proposer cache.
    await produceBlockBody.call(modules.chain.beaconEngine, BlockType.Full, state, {
      randaoReveal,
      graffiti: toGraffitiBytes(graffiti),
      slot,
      parentBlock: generateProtoBlock({blockRoot: ZERO_HASH_HEX}),
      proposerIndex: 0,
      proposerPubKey: new Uint8Array(32).fill(1),
      commonBlockBodyPromise: createCommonBlockBodyPromise(),
    });

    expect(modules.chain["executionEngine"].notifyForkchoiceUpdate).toBeCalledWith(
      ForkName.bellatrix,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      {
        timestamp: computeTimeAtSlot(modules.config, state.slot, state.genesisTime),
        prevRandao: new Uint8Array(32),
        suggestedFeeRecipient: "0x fee recipient address",
      }
    );
  });
});
