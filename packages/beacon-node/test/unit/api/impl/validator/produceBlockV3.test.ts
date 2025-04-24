import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {debug, when} from "vitest-when";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {
  AssembledBlindedBlockBody,
  AssembledFullBlockBody,
  BlobsResultType,
  BlockType,
  CommonBlockBody,
} from "../../../../../src/chain/interface.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {zeroProtoBlock} from "../../../../utils/state.js";

describe("api/validator - produceBlockV3", () => {
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
    modules = getApiTestModules();
    api = getValidatorApi(defaultApiOptions, {...modules, config});

    modules.chain.executionBuilder.status = true;
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

    [routes.validator.BuilderSelection.BuilderOnly, 0, 2, 0, false, "builder"],
    [routes.validator.BuilderSelection.ExecutionOnly, 2, 0, 1, false, "engine"],
    [routes.validator.BuilderSelection.BuilderOnly, 1, 1, 0, true, "builder"],
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
      const slot = 1 * SLOTS_PER_EPOCH;

      const fullBlock = {...ssz.bellatrix.BeaconBlock.defaultValue(), slot};
      const blindedBlock = {...ssz.bellatrix.BlindedBeaconBlock.defaultValue(), slot};

      const randaoReveal = fullBlock.body.randaoReveal;
      const graffiti = "a".repeat(32);
      const feeRecipient = "0xccccccccccccccccccccccccccccccccccccccaa";
      const currentSlot = 1 * SLOTS_PER_EPOCH;

      vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(currentSlot);
      vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
      modules.chain.recomputeForkChoiceHead.mockReturnValue({
        blockRoot: toHexString(fullBlock.parentRoot),
      } as ProtoBlock);
      modules.chain.getProposerHead.mockReturnValue({blockRoot: toHexString(fullBlock.parentRoot)} as ProtoBlock);
      modules.chain.forkChoice.getBlock.mockReturnValue(zeroProtoBlock);

      const commonBlockBody: CommonBlockBody = {
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
      };
      modules.chain.produceCommonBlockBody.mockResolvedValue(commonBlockBody);

      if (enginePayloadValue !== null) {
        const fullBlockBody: AssembledFullBlockBody<ForkName.bellatrix> = {
          executionPayload: fullBlock.body.executionPayload,
        };
        modules.chain.produceFullBlockBody.mockResolvedValue({
          body: fullBlockBody,
          executionPayloadValue: BigInt(enginePayloadValue),
          shouldOverrideBuilder,
          blobs: {type: BlobsResultType.preDeneb},
        });
      } else {
        modules.chain.produceFullBlockBody.mockRejectedValue(Error("not produced"));
      }

      if (builderPayloadValue !== null) {
        const blindedBlockBody: AssembledBlindedBlockBody<ForkName.bellatrix> = {
          executionPayloadHeader: blindedBlock.body.executionPayloadHeader,
        };
        modules.chain.produceBlindedBlockBody.mockResolvedValue({
          body: blindedBlockBody,
          executionPayloadValue: BigInt(builderPayloadValue),
          shouldOverrideBuilder,
          blobs: {type: BlobsResultType.preDeneb},
        });
      } else {
        modules.chain.produceBlindedBlockBody.mockRejectedValue(Error("not produced"));
      }

      when(modules.chain.assembleBlockBody)
        .calledWith(
          expect.objectContaining({
            blockType: BlockType.Full,
          })
        )
        .thenResolve({
          block: fullBlock,
          executionPayloadValue: BigInt(enginePayloadValue ?? 0),
          consensusBlockValue: BigInt(consensusBlockValue),
        });

      when(modules.chain.assembleBlockBody)
        .calledWith(
          expect.objectContaining({
            blockType: BlockType.Blinded,
          })
        )
        .thenResolve({
          block: blindedBlock,
          executionPayloadValue: BigInt(builderPayloadValue ?? 0),
          consensusBlockValue: BigInt(consensusBlockValue),
        });

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

      const expectedBlock = finalSelection === "builder" ? blindedBlock : fullBlock;
      const expectedExecution = finalSelection === "builder";

      expect(block).toEqual(expectedBlock);
      expect(meta.executionPayloadBlinded).toEqual(expectedExecution);

      // expect(modules.chain.produceCommonBlockBody).toBeCalledTimes(1);

      // check call counts
      if (builderSelection === routes.validator.BuilderSelection.ExecutionOnly) {
        expect(modules.chain.produceBlindedBlockBody).toBeCalledTimes(0);
      } else {
        expect(modules.chain.produceBlindedBlockBody).toBeCalledTimes(1);
      }

      if (builderSelection === routes.validator.BuilderSelection.BuilderOnly) {
        expect(modules.chain.produceFullBlockBody).toBeCalledTimes(0);
      } else {
        expect(modules.chain.produceFullBlockBody).toBeCalledTimes(1);
      }
    });
  }
});
