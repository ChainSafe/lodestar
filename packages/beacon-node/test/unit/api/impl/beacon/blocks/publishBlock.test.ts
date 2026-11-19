import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ApiError} from "@lodestar/api/server";
import {createBeaconConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {BeaconStateView, computeStartSlotAtEpoch, computeTimeAtSlot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {BlockInputColumns, BlockInputSource} from "../../../../../../src/chain/blocks/blockInput/index.js";
import {verifyBlocksInEpoch} from "../../../../../../src/chain/blocks/verifyBlock.js";
import {BlockError, BlockErrorCode, BlockGossipError, GossipAction} from "../../../../../../src/chain/errors/index.js";
import {SeenBlockProposers} from "../../../../../../src/chain/seenCache/seenBlockProposers.js";
import {validateAndCacheBeaconBlock} from "../../../../../../src/chain/validation/block.js";
import {Clock} from "../../../../../../src/util/clock.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {
  ELECTRA_FORK_EPOCH,
  config as forkConfig,
  generateBlockWithColumnSidecars,
} from "../../../../../utils/blocksAndData.js";
import {generateCachedState} from "../../../../../utils/state.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

vi.mock("../../../../../../src/chain/blocks/verifyBlock.js");
vi.mock("../../../../../../src/chain/validation/block.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../../src/chain/validation/block.js")>();
  return {...original, validateAndCacheBeaconBlock: vi.fn()};
});

describe("api - beacon - publishBlockV2", () => {
  const config = createBeaconConfig(
    {
      ...configDef,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
    },
    Buffer.alloc(32, 1)
  );
  let modules: ApiTestModules;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyBlocksInEpoch).mockResolvedValue({} as Awaited<ReturnType<typeof verifyBlocksInEpoch>>);
    modules = getApiTestModules({config});
    Object.defineProperty(modules.chain, "blockProductionCache", {value: new Map()});
    Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
    modules.network.publishBeaconBlock = vi.fn();
    modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(validateAndCacheBeaconBlock).mockImplementation(async (_modules, block, _fork, origin) =>
      modules.chain.seenBlockInputCache.getByBlock({block, blockRootHex: "", ...origin})
    );
  });

  it("rejects an invalid broadcast validation level before validating or caching the block", async () => {
    const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    const blockRoot = toRootHex(
      config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
    );
    modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
      BlockInputColumns.createFromBlock({
        forkName: ForkName.fulu,
        block: signedBlock,
        blockRootHex: blockRoot,
        source: BlockInputSource.api,
        seenTimestampSec: 0,
        daOutOfRange: false,
        sampledColumns: [0],
        custodyColumns: [0],
      })
    );

    const api = getBeaconBlockApi(defaultApiOptions, modules);
    await expect(
      api.publishBlockV2({
        signedBlockContents: {signedBlock},
        broadcastValidation: "invalid" as routes.beacon.BroadcastValidation,
      })
    ).rejects.toMatchObject({statusCode: 400, message: "Invalid broadcast validation level invalid"});

    expect(validateAndCacheBeaconBlock).not.toHaveBeenCalled();
    expect(modules.chain.seenBlockInputCache.getByBlock).not.toHaveBeenCalled();
    expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
  });

  it.each([
    {earlyMs: 1001, validationDelay: null},
    {earlyMs: 1000, validationDelay: 500},
    {earlyMs: 750, validationDelay: 250},
    {earlyMs: 500, validationDelay: 0},
    {earlyMs: 0, validationDelay: 0},
  ])("handles a block submitted $earlyMs ms before its slot", async ({earlyMs, validationDelay}) => {
    const actual = await vi.importActual<typeof import("../../../../../../src/chain/validation/block.js")>(
      "../../../../../../src/chain/validation/block.js"
    );
    vi.mocked(validateAndCacheBeaconBlock).mockImplementation(actual.validateAndCacheBeaconBlock);
    const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    const blockRoot = toRootHex(config.getForkTypes(1).BeaconBlock.hashTreeRoot(signedBlock.message));
    const parent = generateProtoBlock({slot: 0});
    modules.chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({
      epoch: 0,
      root: signedBlock.message.parentRoot,
      rootHex: parent.blockRoot,
    });
    modules.chain.forkChoice.getBlockHexDefaultStatus.mockImplementation((root) =>
      root === blockRoot ? null : parent
    );
    const state = new BeaconStateView(generateCachedState());
    vi.spyOn(state.cachedState.epochCtx, "getBeaconProposer").mockReturnValue(signedBlock.message.proposerIndex);
    modules.chain.regen.getState.mockResolvedValue(state);
    modules.chain.bls.verifySignatureSets.mockResolvedValue(true);
    modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
      BlockInputColumns.createFromBlock({
        forkName: ForkName.fulu,
        block: signedBlock,
        blockRootHex: blockRoot,
        source: BlockInputSource.api,
        seenTimestampSec: 0,
        daOutOfRange: false,
        sampledColumns: [0],
        custodyColumns: [0],
      })
    );

    const slotStart = computeTimeAtSlot(config, signedBlock.message.slot, modules.chain.genesisTime) * 1000;
    vi.useFakeTimers({now: slotStart - earlyMs});
    const controller = new AbortController();
    Object.defineProperty(modules.chain, "clock", {
      value: new Clock({config, genesisTime: modules.chain.genesisTime, signal: controller.signal}),
    });
    try {
      const api = getBeaconBlockApi(defaultApiOptions, modules);
      const publication = api.publishBlockV2({signedBlockContents: {signedBlock}});
      if (validationDelay === null) {
        await expect(publication).rejects.toMatchObject({type: {code: BlockErrorCode.FUTURE_SLOT}});
        expect(modules.chain.bls.verifySignatureSets).not.toHaveBeenCalled();
        expect(modules.chain.seenBlockInputCache.getByBlock).not.toHaveBeenCalled();
        expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
        return;
      }

      publication.catch(() => undefined);
      if (validationDelay > 0) {
        await vi.advanceTimersByTimeAsync(validationDelay - 1);
        expect(validateAndCacheBeaconBlock).not.toHaveBeenCalled();
        expect(modules.chain.seenBlockInputCache.getByBlock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
      } else {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(modules.chain.bls.verifySignatureSets).toHaveBeenCalledOnce();

      const remainingMs = earlyMs - validationDelay;
      if (remainingMs > 0) {
        await vi.advanceTimersByTimeAsync(remainingMs - 1);
        expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
      }
      await expect(publication).resolves.toBeUndefined();
      expect(modules.network.publishBeaconBlock).toHaveBeenCalledWith(signedBlock);
      expect(Date.now()).toBe(slotStart);
      expect(vi.mocked(validateAndCacheBeaconBlock).mock.calls[0][3].seenTimestampSec).toBe(
        (slotStart - earlyMs) / 1000
      );
    } finally {
      controller.abort();
      vi.useRealTimers();
    }
  });

  describe("broadcast_validation=gossip", () => {
    it("returns successfully for an already-known block", async () => {
      const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      const blockInput = BlockInputColumns.createFromBlock({
        forkName: ForkName.fulu,
        block: signedBlock,
        blockRootHex: blockRoot,
        source: BlockInputSource.api,
        seenTimestampSec: 0,
        daOutOfRange: false,
        sampledColumns: [0],
        custodyColumns: [0],
      });
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
      vi.mocked(validateAndCacheBeaconBlock).mockRejectedValueOnce(
        new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRoot})
      );

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).resolves.toBeUndefined();

      expect(modules.chain.persistInvalidSszValue).not.toHaveBeenCalled();
      expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
      expect(modules.chain.processBlock).not.toHaveBeenCalled();
    });

    it("returns successfully without publishing a block that is already imported", async () => {
      const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
        BlockInputColumns.createFromBlock({
          forkName: ForkName.fulu,
          block: signedBlock,
          blockRootHex: blockRoot,
          source: BlockInputSource.api,
          seenTimestampSec: 0,
          daOutOfRange: false,
          sampledColumns: [0],
          custodyColumns: [0],
        })
      );
      modules.chain.forkChoice.hasBlockHex.mockReturnValue(true);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.consensus,
        })
      ).resolves.toBeUndefined();

      expect(modules.chain.forkChoice.hasBlockHex).toHaveBeenCalledWith(blockRoot);
      expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
      expect(modules.chain.processBlock).not.toHaveBeenCalled();
    });

    it("returns successfully for a locally produced block imported while publishing", async () => {
      const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      const blockInput = BlockInputColumns.createFromBlock({
        forkName: ForkName.fulu,
        block: signedBlock,
        blockRootHex: blockRoot,
        source: BlockInputSource.api,
        seenTimestampSec: 0,
        daOutOfRange: false,
        sampledColumns: [0],
        custodyColumns: [0],
      });
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
      // A duplicate publish of a locally produced block can still race the import
      modules.chain.blockProductionCache.set(blockRoot, {} as never);
      modules.chain.processBlock = vi
        .fn()
        .mockRejectedValue(new BlockError(signedBlock, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRoot}));

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).resolves.toBeUndefined();

      expect(validateAndCacheBeaconBlock).toHaveBeenCalledOnce();
      expect(modules.chain.processBlock).toHaveBeenCalledOnce();
    });

    it("rejects a repeat proposal", async () => {
      const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      const blockInput = BlockInputColumns.createFromBlock({
        forkName: ForkName.fulu,
        block: signedBlock,
        blockRootHex: blockRoot,
        source: BlockInputSource.api,
        seenTimestampSec: 0,
        daOutOfRange: false,
        sampledColumns: [0],
        custodyColumns: [0],
      });
      const error = new BlockGossipError(GossipAction.IGNORE, {
        code: BlockErrorCode.REPEAT_PROPOSAL,
        proposerIndex: signedBlock.message.proposerIndex,
        root: blockRoot,
      });
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
      vi.mocked(validateAndCacheBeaconBlock).mockRejectedValueOnce(error);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toBe(error);

      expect(modules.chain.persistInvalidSszValue).toHaveBeenCalledWith(
        modules.config.getForkTypes(signedBlock.message.slot).SignedBeaconBlock,
        signedBlock,
        "api_reject_gossip_failure",
        blockRoot
      );
      expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
      expect(modules.chain.processBlock).not.toHaveBeenCalled();
    });
  });

  describe("broadcast_validation=consensus_and_equivocation", () => {
    it("does not publish or import a non-local block that conflicts with an observed proposal", async () => {
      const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = 1;
      signedBlock.message.proposerIndex = 2;
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      const conflictingBlockRoot = toRootHex(Buffer.alloc(32, 1));
      const blockInput = BlockInputColumns.createFromBlock({
        forkName: ForkName.fulu,
        block: signedBlock,
        blockRootHex: blockRoot,
        source: BlockInputSource.api,
        seenTimestampSec: 0,
        daOutOfRange: false,
        sampledColumns: [0],
        custodyColumns: [0],
      });
      modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(generateProtoBlock({slot: 0}));
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
      modules.chain.seenBlockProposers.observeBlockRoot(
        signedBlock.message.slot,
        signedBlock.message.proposerIndex,
        conflictingBlockRoot,
        ssz.phase0.SignedBeaconBlockHeader.defaultValue()
      );

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.consensusAndEquivocation,
        })
      ).rejects.toThrow(/proposer equivocation/);

      expect(verifyBlocksInEpoch).toHaveBeenCalledOnce();
      expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
      expect(modules.chain.processBlock).not.toHaveBeenCalled();
    });
  });

  describe("consensus validation strategies", () => {
    it.each([routes.beacon.BroadcastValidation.consensus, routes.beacon.BroadcastValidation.consensusAndEquivocation])(
      "gossip validates a local block and skips consensus checks with broadcast_validation=%s",
      async (broadcastValidation) => {
        const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
        signedBlock.message.slot = 1;
        signedBlock.message.proposerIndex = 2;
        const blockRoot = toRootHex(
          modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
        );
        const blockInput = BlockInputColumns.createFromBlock({
          forkName: ForkName.fulu,
          block: signedBlock,
          blockRootHex: blockRoot,
          source: BlockInputSource.api,
          seenTimestampSec: 0,
          daOutOfRange: false,
          sampledColumns: [0],
          custodyColumns: [0],
        });
        vi.spyOn(modules.chain.blockProductionCache, "has").mockReturnValue(true);
        modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);

        const api = getBeaconBlockApi(defaultApiOptions, modules);
        await api.publishBlockV2({signedBlockContents: {signedBlock}, broadcastValidation});

        expect(validateAndCacheBeaconBlock).toHaveBeenCalledOnce();
        expect(verifyBlocksInEpoch).not.toHaveBeenCalled();
        expect(modules.network.publishBeaconBlock).toHaveBeenCalledWith(signedBlock);
        expect(modules.chain.processBlock).toHaveBeenCalledWith(blockInput, {});
      }
    );

    it.each([routes.beacon.BroadcastValidation.consensus, routes.beacon.BroadcastValidation.consensusAndEquivocation])(
      "verifies all signatures for a non-local block with broadcast_validation=%s",
      async (broadcastValidation) => {
        const signedBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
        signedBlock.message.slot = 1;
        signedBlock.message.proposerIndex = 2;
        const blockRoot = toRootHex(
          modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
        );
        const blockInput = BlockInputColumns.createFromBlock({
          forkName: ForkName.fulu,
          block: signedBlock,
          blockRootHex: blockRoot,
          source: BlockInputSource.api,
          seenTimestampSec: 0,
          daOutOfRange: false,
          sampledColumns: [0],
          custodyColumns: [0],
        });
        modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(generateProtoBlock({slot: 0}));
        modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);

        const api = getBeaconBlockApi(defaultApiOptions, modules);
        await api.publishBlockV2({signedBlockContents: {signedBlock}, broadcastValidation});

        expect(validateAndCacheBeaconBlock).toHaveBeenCalledOnce();
        expect(verifyBlocksInEpoch).toHaveBeenCalledOnce();
        expect(vi.mocked(verifyBlocksInEpoch).mock.calls[0][3]).toMatchObject({validProposerSignature: true});
        expect(modules.network.publishBeaconBlock).toHaveBeenCalledWith(signedBlock);
      }
    );
  });

  it("rejects a pre-fulu block", async () => {
    const signedBlock = ssz.electra.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = computeStartSlotAtEpoch(ELECTRA_FORK_EPOCH);
    modules = getApiTestModules({config: forkConfig});

    const api = getBeaconBlockApi(defaultApiOptions, modules);
    await expect(
      api.publishBlockV2({
        signedBlockContents: {signedBlock, blobs: [], kzgProofs: []},
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      })
    ).rejects.toThrow(ApiError);

    expect(modules.chain.seenBlockInputCache.getByBlock).not.toHaveBeenCalled();
  });

  it("tracks data column publication results", async () => {
    const {block, blobs, columnSidecars, rootHex} = generateBlockWithColumnSidecars({
      forkName: ForkName.fulu,
      returnBlobs: true,
    });
    if (blobs === undefined) {
      throw Error("Missing generated blobs");
    }
    const kzgProofs = blobs.flatMap((_, rowIndex) =>
      columnSidecars.map((columnSidecar) => columnSidecar.kzgProofs[rowIndex])
    );
    const blockInput = BlockInputColumns.createFromBlock({
      forkName: ForkName.fulu,
      block,
      blockRootHex: rootHex,
      source: BlockInputSource.api,
      seenTimestampSec: 0,
      daOutOfRange: false,
      sampledColumns: [0],
      custodyColumns: [0],
    });

    modules = getApiTestModules({config: forkConfig});
    Object.defineProperty(modules.chain, "blockProductionCache", {value: new Map()});
    Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
    modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
    modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);
    modules.network.publishBeaconBlock = vi.fn();
    modules.network.publishDataColumnSidecar = vi.fn().mockResolvedValue({sentPeers: 1, alreadyPublished: false});

    const api = getBeaconBlockApi(defaultApiOptions, modules);
    await expect(
      api.publishBlockV2({
        signedBlockContents: {signedBlock: block, blobs, kzgProofs},
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      })
    ).resolves.toBeUndefined();

    expect(modules.network.publishDataColumnSidecar).toHaveBeenCalledTimes(columnSidecars.length);
  });
});
