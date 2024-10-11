import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {routes} from "@lodestar/api";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {CommonBlockBody} from "../../../../../src/chain/interface.js";
import {zeroProtoBlock} from "../../../../utils/state.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";

describe("api/validator - produceBlockV3", function () {
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
      const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
      const blindedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();

      const slot = 1 * SLOTS_PER_EPOCH;
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

      if (enginePayloadValue !== null) {
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

        modules.chain.produceBlock.mockResolvedValue({
          block: fullBlock,
          executionPayloadValue: BigInt(enginePayloadValue),
          consensusBlockValue: BigInt(consensusBlockValue),
          shouldOverrideBuilder,
        });
      } else {
        modules.chain.produceBlock.mockRejectedValue(Error("not produced"));
      }

      if (builderPayloadValue !== null) {
        modules.chain.produceBlindedBlock.mockResolvedValue({
          block: blindedBlock,
          executionPayloadValue: BigInt(builderPayloadValue),
          consensusBlockValue: BigInt(consensusBlockValue),
        });
      } else {
        modules.chain.produceBlindedBlock.mockRejectedValue(Error("not produced"));
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

      const expectedBlock = finalSelection === "builder" ? blindedBlock : fullBlock;
      const expectedExecution = finalSelection === "builder";

      expect(block).toEqual(expectedBlock);
      expect(meta.executionPayloadBlinded).toEqual(expectedExecution);

      // check call counts
      if (builderSelection === routes.validator.BuilderSelection.ExecutionOnly) {
        expect(modules.chain.produceBlindedBlock).toBeCalledTimes(0);
      } else {
        expect(modules.chain.produceBlindedBlock).toBeCalledTimes(1);
      }

      if (builderSelection === routes.validator.BuilderSelection.BuilderOnly) {
        expect(modules.chain.produceBlock).toBeCalledTimes(0);
      } else {
        expect(modules.chain.produceBlock).toBeCalledTimes(1);
      }
    });
  }
});
