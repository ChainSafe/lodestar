import {describe, it, expect, beforeEach, afterEach, MockedObject, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {routes} from "@lodestar/api";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiModules} from "../../../../../src/api/impl/types.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {testLogger} from "../../../../utils/logger.js";
import {ApiImplTestModules, setupApiImplTestServer} from "../../../../__mocks__/apiMocks.js";
import {ExecutionBuilderHttp} from "../../../../../src/execution/builder/http.js";

/* eslint-disable @typescript-eslint/naming-convention */
describe("api/validator - produceBlockV3", function () {
  const logger = testLogger();

  let modules: ApiModules;
  let server: ApiImplTestModules;

  let chainStub: ApiImplTestModules["chainStub"];
  let executionBuilderStub: MockedObject<ExecutionBuilderHttp>;
  let syncStub: ApiImplTestModules["syncStub"];

  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 1,
  });
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

  beforeEach(() => {
    server = setupApiImplTestServer();
    chainStub = server.chainStub;
    executionBuilderStub = server.chainStub.executionBuilder;
    syncStub = server.syncStub;

    executionBuilderStub.status = true;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  const testCases: [routes.validator.BuilderSelection, number | null, number | null, number, string][] = [
    [routes.validator.BuilderSelection.MaxProfit, 1, 0, 0, "builder"],
    [routes.validator.BuilderSelection.MaxProfit, 1, 2, 1, "engine"],
    [routes.validator.BuilderSelection.MaxProfit, null, 0, 0, "engine"],
    [routes.validator.BuilderSelection.MaxProfit, 0, null, 1, "builder"],

    [routes.validator.BuilderSelection.BuilderAlways, 1, 2, 0, "builder"],
    [routes.validator.BuilderSelection.BuilderAlways, 1, 0, 1, "builder"],
    [routes.validator.BuilderSelection.BuilderAlways, null, 0, 0, "engine"],
    [routes.validator.BuilderSelection.BuilderAlways, 0, null, 1, "builder"],

    [routes.validator.BuilderSelection.BuilderOnly, 0, 2, 0, "builder"],
    [routes.validator.BuilderSelection.ExecutionOnly, 2, 0, 1, "execution"],
  ];

  testCases.forEach(
    ([builderSelection, builderPayloadValue, enginePayloadValue, consensusBlockValue, finalSelection]) => {
      it(`produceBlockV3  - ${finalSelection} produces block`, async () => {
        syncStub = server.syncStub;
        modules = {
          chain: server.chainStub,
          config,
          db: server.dbStub,
          logger,
          network: server.networkStub,
          sync: syncStub,
          metrics: null,
        };

        const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
        const blindedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();

        const slot = 1 * SLOTS_PER_EPOCH;
        const randaoReveal = fullBlock.body.randaoReveal;
        const graffiti = "a".repeat(32);
        const feeRecipient = "0xccccccccccccccccccccccccccccccccccccccaa";
        const currentSlot = 1 * SLOTS_PER_EPOCH;

        vi.spyOn(server.chainStub.clock, "currentSlot", "get").mockReturnValue(currentSlot);
        vi.spyOn(syncStub, "state", "get").mockReturnValue(SyncState.Synced);

        const api = getValidatorApi(modules);

        if (enginePayloadValue !== null) {
          chainStub.produceBlock.mockResolvedValue({
            block: fullBlock,
            executionPayloadValue: BigInt(enginePayloadValue),
          });
        } else {
          chainStub.produceBlock.mockRejectedValue(Error("not produced"));
        }

        if (builderPayloadValue !== null) {
          chainStub.produceBlindedBlock.mockResolvedValue({
            block: blindedBlock,
            executionPayloadValue: BigInt(builderPayloadValue),
          });
        } else {
          chainStub.produceBlindedBlock.mockRejectedValue(Error("not produced"));
        }
        chainStub.getBlockRewards.mockResolvedValue(BigInt(consensusBlockValue));

        const _skipRandaoVerification = false;
        const produceBlockOpts = {
          strictFeeRecipientCheck: false,
          builderSelection,
          feeRecipient,
        };

        const block = await api.produceBlockV3(slot, randaoReveal, graffiti, _skipRandaoVerification, produceBlockOpts);

        const expectedBlock = finalSelection === "builder" ? blindedBlock : fullBlock;
        const expectedExecution = finalSelection === "builder" ? true : false;

        expect(block.data).toEqual(expectedBlock);
        expect(block.executionPayloadBlinded).toEqual(expectedExecution);

        // check call counts
        if (builderSelection === routes.validator.BuilderSelection.ExecutionOnly) {
          expect(chainStub.produceBlindedBlock).toBeCalledTimes(0);
          expect(chainStub.getBlockRewards).toBeCalledTimes(1);
        } else {
          expect(chainStub.produceBlindedBlock).toBeCalledTimes(1);
        }

        if (builderSelection === routes.validator.BuilderSelection.BuilderOnly) {
          expect(chainStub.produceBlock).toBeCalledTimes(0);
          expect(chainStub.getBlockRewards).toBeCalledTimes(1);
        } else {
          expect(chainStub.produceBlock).toBeCalledTimes(1);
        }
      });
    }
  );
});
