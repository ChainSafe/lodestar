import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {routes} from "@lodestar/api";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH, ZERO_HASH_HEX} from "@lodestar/params";
import {
  BeaconStateView,
  G2_POINT_AT_INFINITY,
  computeTimeAtSlot,
  createCachedBeaconState,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {BeaconEngineCore} from "../../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BlockType, produceBlockBody} from "../../../../../src/chain/produceBlock/index.js";
import {BuilderStatus} from "../../../../../src/execution/builder/http.js";
import {PayloadIdCache} from "../../../../../src/execution/index.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {toGraffitiBytes} from "../../../../../src/util/graffiti.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {generateCachedBellatrixState, zeroProtoBlock} from "../../../../utils/state.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";

describe("api/validator - produceBlockV3", () => {
  let state: BeaconStateView;
  const produceFull =
    vi.fn<() => Promise<Omit<Awaited<ReturnType<BeaconEngineCore["produceBlockWrapper"]>>, "produceResult">>>();
  const produceBlinded =
    vi.fn<() => Promise<Omit<Awaited<ReturnType<BeaconEngineCore["produceBlockWrapper"]>>, "produceResult">>>();
  const produceCommon = vi.fn<BeaconEngineCore["produceCommonBlockBody"]>();
  let modules: ApiTestModules;
  let api: ReturnType<typeof getValidatorApi>;

  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 1,
  });
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

  beforeEach(() => {
    modules = getApiTestModules({config});
    state = new BeaconStateView(generateCachedBellatrixState());
    produceFull.mockReset();
    produceBlinded.mockReset();
    produceCommon.mockReset();
    modules.chain.produceBlockWrapper.mockImplementation(async (type) => {
      const result = await (type === BlockType.Full ? produceFull() : produceBlinded());
      return {
        ...result,
        produceResult:
          type === BlockType.Full
            ? {
                type: BlockType.Full,
                fork: ForkName.bellatrix,
                executionPayload: ssz.bellatrix.ExecutionPayload.defaultValue(),
              }
            : {
                type: BlockType.Blinded,
                fork: ForkName.bellatrix,
                executionPayloadHeader: ssz.bellatrix.ExecutionPayloadHeader.defaultValue(),
              },
      };
    });
    api = getValidatorApi(defaultApiOptions, {...modules, config});

    vi.spyOn(modules.chain.clock, "msFromSlot").mockReturnValue(0);
    modules.chain.executionBuilder.status = BuilderStatus.enabled;
    modules.forkChoice.getConfirmedBlock.mockReturnValue(null);
    modules.chain.beaconEngine.produceBlock = vi.fn(
      BeaconEngineCore.prototype.produceBlock.bind(modules.chain.beaconEngine)
    );
    modules.chain.beaconEngine.produceCommonBlockBody = produceCommon;
    produceCommon.mockResolvedValue({} as Awaited<ReturnType<BeaconEngineCore["produceCommonBlockBody"]>>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const testCases: [routes.validator.BuilderSelection, number | null, number | null, number, boolean, string][] = [
    [routes.validator.BuilderSelection.MaxProfit, 1, 0, 0, false, "builder"],
    [routes.validator.BuilderSelection.MaxProfit, 1, 2, 1, false, "engine"],
    [routes.validator.BuilderSelection.MaxProfit, null, 0, 0, false, "engine"],
    [routes.validator.BuilderSelection.MaxProfit, 0, null, 1, false, "builder"],
    [routes.validator.BuilderSelection.MaxProfit, 0, null, 1, true, "builder"],
    [routes.validator.BuilderSelection.MaxProfit, 1, 1, 1, true, "engine"],
    [routes.validator.BuilderSelection.MaxProfit, 2, 1, 1, true, "engine"],

    [routes.validator.BuilderSelection.BuilderAlways, 1, 2, 0, false, "builder"],
    [routes.validator.BuilderSelection.BuilderAlways, 1, 0, 1, false, "builder"],
    [routes.validator.BuilderSelection.BuilderAlways, null, 0, 0, false, "engine"],
    [routes.validator.BuilderSelection.BuilderAlways, 0, null, 1, false, "builder"],
    [routes.validator.BuilderSelection.BuilderAlways, 0, 1, 1, true, "engine"],
    [routes.validator.BuilderSelection.BuilderAlways, 1, 1, 1, true, "engine"],
    [routes.validator.BuilderSelection.BuilderAlways, 1, null, 1, true, "builder"],

    [routes.validator.BuilderSelection.ExecutionAlways, 2, 1, 0, false, "engine"],
    [routes.validator.BuilderSelection.ExecutionAlways, 0, 1, 1, false, "engine"],
    [routes.validator.BuilderSelection.ExecutionAlways, 0, null, 0, false, "builder"],
    [routes.validator.BuilderSelection.ExecutionAlways, null, 0, 1, false, "engine"],
    [routes.validator.BuilderSelection.ExecutionAlways, 1, 1, 1, true, "engine"],

    [routes.validator.BuilderSelection.ExecutionOnly, 2, 0, 1, false, "engine"],
    [routes.validator.BuilderSelection.ExecutionOnly, 1, 1, 1, true, "engine"],
  ];

  for (const [
    builderSelection,
    builderPayloadValue,
    enginePayloadValue,
    consensusBlockValue,
    shouldOverrideBuilder,
    finalSelection,
  ] of testCases) {
    it(`produceBlockV3  - ${finalSelection} produces block`, async () => {
      const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
      fullBlock.slot = SLOTS_PER_EPOCH;
      const blindedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
      blindedBlock.slot = SLOTS_PER_EPOCH;

      const slot = 1 * SLOTS_PER_EPOCH;
      const randaoReveal = fullBlock.body.randaoReveal;
      const graffiti = "a".repeat(32);
      const feeRecipient = "0xccccccccccccccccccccccccccccccccccccccaa";
      const currentSlot = 1 * SLOTS_PER_EPOCH;

      vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(currentSlot);
      vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
      modules.chain.forkChoice.getHead.mockReturnValue({
        blockRoot: toRootHex(fullBlock.parentRoot),
      } as ProtoBlock);
      modules.chain.getProposerHead.mockReturnValue({blockRoot: toRootHex(fullBlock.parentRoot)} as ProtoBlock);
      modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(zeroProtoBlock);
      produceCommon.mockResolvedValue({
        attestations: fullBlock.body.attestations,
        attesterSlashings: fullBlock.body.attesterSlashings,
        deposits: fullBlock.body.deposits,
        proposerSlashings: fullBlock.body.proposerSlashings,
        eth1Data: fullBlock.body.eth1Data,
        graffiti: fullBlock.body.graffiti,
        randaoReveal: fullBlock.body.randaoReveal,
        voluntaryExits: fullBlock.body.voluntaryExits,
        blsToExecutionChanges: [],
        syncAggregate: fullBlock.body.syncAggregate,
      });

      if (enginePayloadValue !== null) {
        produceFull.mockResolvedValue({
          block: fullBlock,
          executionPayloadValue: BigInt(enginePayloadValue),
          consensusBlockValue: BigInt(consensusBlockValue),
          shouldOverrideBuilder,
        });
      } else {
        produceFull.mockRejectedValue(Error("not produced"));
      }

      if (builderPayloadValue !== null) {
        produceBlinded.mockResolvedValue({
          block: blindedBlock,
          executionPayloadValue: BigInt(builderPayloadValue),
          consensusBlockValue: BigInt(consensusBlockValue),
        });
      } else {
        produceBlinded.mockRejectedValue(Error("not produced"));
      }
      const _skipRandaoVerification = false;
      const produceBlockOpts = {
        strictFeeRecipientCheck: false,
        builderSelection,
        feeRecipient,
      };

      const {data: block, meta} = await api.produceBlockV3({
        slot,
        randaoReveal,
        graffiti,
        skipRandaoVerification: _skipRandaoVerification,
        ...produceBlockOpts,
      });

      const expectedBlock = finalSelection === "builder" ? blindedBlock : {block: fullBlock};
      const expectedExecution = finalSelection === "builder";

      expect(block).toEqual(expectedBlock);
      expect(meta.executionPayloadBlinded).toEqual(expectedExecution);

      // check call counts
      if (builderSelection === routes.validator.BuilderSelection.ExecutionOnly) {
        expect(produceBlinded).toBeCalledTimes(0);
      } else {
        expect(produceBlinded).toBeCalledTimes(1);
      }

      expect(produceFull).toBeCalledTimes(1);
    });
  }

  it("treats deprecated builderonly selection as builderalways", async () => {
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
    fullBlock.slot = SLOTS_PER_EPOCH;
    const blindedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();
    blindedBlock.slot = SLOTS_PER_EPOCH;
    const slot = 1 * SLOTS_PER_EPOCH;

    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(slot);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
    modules.chain.forkChoice.getHead.mockReturnValue({blockRoot: toRootHex(fullBlock.parentRoot)} as ProtoBlock);
    modules.chain.getProposerHead.mockReturnValue({blockRoot: toRootHex(fullBlock.parentRoot)} as ProtoBlock);
    modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(zeroProtoBlock);
    produceCommon.mockResolvedValue({
      attestations: fullBlock.body.attestations,
      attesterSlashings: fullBlock.body.attesterSlashings,
      deposits: fullBlock.body.deposits,
      proposerSlashings: fullBlock.body.proposerSlashings,
      eth1Data: fullBlock.body.eth1Data,
      graffiti: fullBlock.body.graffiti,
      randaoReveal: fullBlock.body.randaoReveal,
      voluntaryExits: fullBlock.body.voluntaryExits,
      blsToExecutionChanges: [],
      syncAggregate: fullBlock.body.syncAggregate,
    });
    // Local payload value (2) exceeds the builder value (1), builderalways still selects the builder block
    produceFull.mockResolvedValue({
      block: fullBlock,
      executionPayloadValue: BigInt(2),
      consensusBlockValue: BigInt(0),
      shouldOverrideBuilder: false,
    });
    produceBlinded.mockResolvedValue({
      block: blindedBlock,
      executionPayloadValue: BigInt(1),
      consensusBlockValue: BigInt(0),
    });

    const {data: block, meta} = await api.produceBlockV3({
      slot,
      randaoReveal: fullBlock.body.randaoReveal,
      graffiti: "a".repeat(32),
      skipRandaoVerification: false,
      builderSelection: routes.validator.BuilderSelection.BuilderOnly,
    });

    expect(modules.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Builder selection builderonly is no longer supported")
    );
    expect(block).toEqual(blindedBlock);
    expect(meta.executionPayloadBlinded).toBe(true);
  });

  it("rejects block production if parent block is optimistic", async () => {
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
    fullBlock.slot = SLOTS_PER_EPOCH;
    const slot = 1 * SLOTS_PER_EPOCH;

    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(slot);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
    modules.chain.getProposerHead.mockReturnValue({
      blockRoot: toRootHex(fullBlock.parentRoot),
      executionStatus: ExecutionStatus.Syncing,
    } as ProtoBlock);

    await expect(
      api.produceBlockV3({
        slot,
        randaoReveal: fullBlock.body.randaoReveal,
        graffiti: "a".repeat(32),
        skipRandaoVerification: false,
      })
    ).rejects.toThrow("Node is syncing");

    expect(produceFull).not.toHaveBeenCalled();
    expect(produceBlinded).not.toHaveBeenCalled();
  });

  it("correctly pass feeRecipient to produceBlock", async () => {
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
    fullBlock.slot = SLOTS_PER_EPOCH;
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
    modules.chain.forkChoice.getHead.mockReturnValue(parentBlock);
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
    const capellaConfig = createBeaconConfig(getConfig(ForkName.capella), genesisValidatorsRoot);
    Object.defineProperty(modules.chain, "config", {value: capellaConfig});
    state = new BeaconStateView(
      createCachedBeaconState(
        ssz.capella.BeaconState.toViewDU({
          ...ssz.capella.BeaconState.defaultValue(),
          ...generateCachedBellatrixState().toValue(),
          latestExecutionPayloadHeader: ssz.capella.ExecutionPayloadHeader.defaultValue(),
        }),
        {config: capellaConfig, pubkeyCache}
      )
    );
    const fullBlock = ssz.capella.BeaconBlock.defaultValue();
    fullBlock.slot = SLOTS_PER_EPOCH;
    const executionPayloadValue = ssz.Wei.defaultValue();
    const slot = 100000;
    fullBlock.slot = slot;
    const randaoReveal = fullBlock.body.randaoReveal;
    const graffiti = "a".repeat(32);
    const feeRecipient = "0xccccccccccccccccccccccccccccccccccccccaa";

    const headSlot = 0;
    modules.chain.getProposerHead.mockReturnValue(generateProtoBlock({slot: headSlot}));

    modules.chain.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: headSlot}));
    modules.chain["opPool"].getSlashingsAndExits.mockReturnValue([[], [], [], []]);
    modules.chain["aggregatedAttestationPool"].getAttestationsForBlock.mockReturnValue([]);
    modules.chain["syncContributionAndProofPool"].getAggregate.mockReturnValue({
      syncCommitteeBits: ssz.altair.SyncCommitteeBits.defaultValue(),
      syncCommitteeSignature: G2_POINT_AT_INFINITY,
    });
    modules.forkChoice.getJustifiedBlock.mockReturnValue({} as ProtoBlock);
    modules.forkChoice.getFinalizedBlock.mockReturnValue(zeroProtoBlock);

    modules.chain["executionEngine"].payloadIdCache = new PayloadIdCache();
    modules.chain["executionEngine"].notifyForkchoiceUpdate.mockResolvedValue("0x");
    modules.chain["executionEngine"].getPayload.mockResolvedValue({
      executionPayload: ssz.capella.ExecutionPayload.defaultValue(),
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
      ForkName.capella,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      {
        timestamp: computeTimeAtSlot(modules.config, state.slot, state.genesisTime),
        prevRandao: new Uint8Array(32),
        withdrawals: [],
        parentBeaconBlockRoot: new Uint8Array(32),
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
      ForkName.capella,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      {
        timestamp: computeTimeAtSlot(modules.config, state.slot, state.genesisTime),
        prevRandao: new Uint8Array(32),
        withdrawals: [],
        parentBeaconBlockRoot: new Uint8Array(32),
        suggestedFeeRecipient: "0x fee recipient address",
      }
    );
  });
});
