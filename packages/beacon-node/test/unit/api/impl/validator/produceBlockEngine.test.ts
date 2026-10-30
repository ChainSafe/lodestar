import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ApiError} from "@lodestar/api/server";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {beaconBlockToBlinded} from "@lodestar/state-transition";
import {ProducedBlockSource, ssz} from "@lodestar/types";
import {ErrorAborted, toRootHex} from "@lodestar/utils";
import {MAX_BUILDER_BOOST_FACTOR} from "@lodestar/validator";
import {NodeIsSyncing} from "../../../../../src/api/impl/errors.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {BeaconEngineErrorCode, ProductionError} from "../../../../../src/chain/beaconEngine/interface.js";
import {BlockType, ProduceFullGloas} from "../../../../../src/chain/produceBlock/index.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {toGraffitiBytes} from "../../../../../src/util/graffiti.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";

describe("validator production engine boundary", () => {
  let modules: ApiTestModules;
  const config = createBeaconConfig(
    createChainForkConfig({...defaultChainConfig, ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0}),
    Buffer.alloc(32)
  );
  const request = {slot: 1, randaoReveal: Buffer.alloc(96), graffiti: "test"};
  beforeEach(() => {
    modules = getApiTestModules({config});
    vi.spyOn(modules.chain.beaconEngine.chainView, "getHead");
    modules.chain.persistBlock = vi.fn().mockResolvedValue(undefined);
  });

  it("makes one V3 call, caches DA artifacts, and blinds a local block", async () => {
    const api = getValidatorApi(defaultApiOptions, modules);
    const block = ssz.bellatrix.BeaconBlock.defaultValue();
    block.slot = request.slot;
    const produceResult = {
      type: BlockType.Full as const,
      fork: ForkName.bellatrix as const,
      executionPayload: block.body.executionPayload,
    };
    vi.mocked(modules.chain.beaconEngine.produceBlock).mockResolvedValue({
      ok: true,
      headUpdate: false,
      data: {
        data: {block},
        version: ForkName.bellatrix,
        executionPayloadBlinded: false,
        executionPayloadSource: ProducedBlockSource.engine,
        executionPayloadValue: 3n,
        consensusBlockValue: 2n,
        shouldOverrideBuilder: true,
        produceResult,
      },
    });
    modules.chain.opts.persistProducedBlocks = true;
    const response = await api.produceBlockV3({...request, blindedLocal: true, feeRecipient: "0x1234"});
    expect(modules.chain.beaconEngine.produceBlock).toHaveBeenCalledExactlyOnceWith({
      ...request,
      graffiti: toGraffitiBytes(`${request.graffiti} LS0000`),
      feeRecipient: "0x1234",
      strictFeeRecipientCheck: undefined,
      builderSelection: routes.validator.BuilderSelection.MaxProfit,
      builderBoostFactor: 100n,
    });
    expect(response.data).toEqual(beaconBlockToBlinded(config, block));
    expect(response.meta.executionPayloadBlinded).toBe(true);
    expect(response.meta.executionPayloadValue).toBe(3n);
    expect(response.meta).not.toHaveProperty("produceResult");
    expect(
      modules.chain.blockProductionCache.get(toRootHex(config.getForkTypes(1).BeaconBlock.hashTreeRoot(block)))
    ).toBe(produceResult);
    expect(modules.chain.persistBlock).toHaveBeenCalledWith(block, "produced_engine_block");
    expect(modules.chain.beaconEngine.chainView.getHead).not.toHaveBeenCalled();
  });

  it("makes one V4 call and stores the returned DA artifacts", async () => {
    const gloasConfig = createBeaconConfig(
      createChainForkConfig({
        ...defaultChainConfig,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
      }),
      Buffer.alloc(32)
    );
    modules = getApiTestModules({config: gloasConfig});
    const api = getValidatorApi(defaultApiOptions, modules);
    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = 1;
    const produceResult: ProduceFullGloas = {
      type: BlockType.Full,
      fork: ForkName.gloas,
      executionPayload: ssz.gloas.ExecutionPayload.defaultValue(),
      executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
      blobsBundle: {blobs: [], commitments: [], proofs: []},
      cells: [],
      parentBlockRoot: Buffer.alloc(32),
    };
    vi.mocked(modules.chain.beaconEngine.produceBlockV4).mockResolvedValue({
      ok: true,
      headUpdate: false,
      data: {
        data: block,
        meta: {
          version: ForkName.gloas,
          executionPayloadValue: 1n,
          consensusBlockValue: 2n,
          executionPayloadIncluded: false,
        },
        executionPayloadSource: ProducedBlockSource.builder,
        produceResult,
      },
    });
    expect(
      await api.produceBlockV4({
        ...request,
        includePayload: false,
        builderConfig: {minBid: 0n, builderBoostFactor: 100n, builders: []},
      })
    ).toEqual({
      data: block,
      meta: {
        version: ForkName.gloas,
        executionPayloadValue: 1n,
        consensusBlockValue: 2n,
        executionPayloadIncluded: false,
      },
    });
    expect(modules.chain.beaconEngine.produceBlockV4).toHaveBeenCalledExactlyOnceWith({
      ...request,
      graffiti: toGraffitiBytes(`${request.graffiti} LS0000`),
      feeRecipient: undefined,
      strictFeeRecipientCheck: undefined,
      includePayload: false,
      builderConfig: {minBid: 0n, builderBoostFactor: 100n, builders: []},
    });
    expect([...modules.chain.blockProductionCache.values()]).toEqual([produceResult]);
    expect(modules.chain.beaconEngine.produceBlock).not.toHaveBeenCalled();
  });

  for (const [code, payload, errorClass, message] of [
    [BeaconEngineErrorCode.API_ERROR, {status: 400, message: "bad request"}, ApiError, "bad request"],
    [
      BeaconEngineErrorCode.NODE_SYNCING,
      {message: "parent unavailable"},
      NodeIsSyncing,
      "Node is syncing - parent unavailable",
    ],
    [BeaconEngineErrorCode.ABORTED, {message: "Aborted closed"}, ErrorAborted, "Aborted closed"],
    [BeaconEngineErrorCode.INTERNAL, {message: "failed"}, Error, "failed"],
  ] as const) {
    it(`reconstructs ${code} without caching`, async () => {
      const api = getValidatorApi(defaultApiOptions, modules);
      const failure = {ok: false, code, payload} as ProductionError;
      vi.mocked(modules.chain.beaconEngine.produceBlock).mockResolvedValue({...failure, headUpdate: false});
      await expect(api.produceBlockV3(request)).rejects.toBeInstanceOf(errorClass);
      await expect(api.produceBlockV3(request)).rejects.toThrow(message);
      expect(modules.chain.blockProductionCache.size).toBe(0);
    });
  }

  it("rejects an excessive boost before calling the engine", async () => {
    const api = getValidatorApi(defaultApiOptions, modules);
    await expect(
      api.produceBlockV3({...request, builderBoostFactor: MAX_BUILDER_BOOST_FACTOR + 1n})
    ).rejects.toMatchObject({statusCode: 400});
    expect(modules.chain.beaconEngine.produceBlock).not.toHaveBeenCalled();
  });

  it("uses the engine head for syncing checks", async () => {
    const slot = 3 * SLOTS_PER_EPOCH;
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(slot);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.SyncingHead);
    modules.chain.forkChoice.getHead.mockReturnValue({...modules.chain.forkChoice.getHead(), slot: 0});
    const api = getValidatorApi(defaultApiOptions, modules);
    await expect(api.produceBlockV3({...request, slot})).rejects.toBeInstanceOf(NodeIsSyncing);
    expect(modules.chain.beaconEngine.produceBlock).not.toHaveBeenCalled();
    expect(modules.chain.beaconEngine.chainView.getHead).toHaveBeenCalledOnce();
  });
});
