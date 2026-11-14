import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ApiError} from "@lodestar/api/server";
import {createBeaconConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {BlockInputColumns, BlockInputSource} from "../../../../../../src/chain/blocks/blockInput/index.js";
import {verifyBlocksInEpoch} from "../../../../../../src/chain/blocks/verifyBlock.js";
import {BlockError, BlockErrorCode, BlockGossipError, GossipAction} from "../../../../../../src/chain/errors/index.js";
import {SeenBlockProposers} from "../../../../../../src/chain/seenCache/seenBlockProposers.js";
import {validateGossipBlock} from "../../../../../../src/chain/validation/block.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {
  ELECTRA_FORK_EPOCH,
  config as forkConfig,
  generateBlockWithColumnSidecars,
  slots,
} from "../../../../../utils/blocksAndData.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

vi.mock("../../../../../../src/chain/blocks/verifyBlock.js");
vi.mock("../../../../../../src/chain/validation/block.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../../src/chain/validation/block.js")>();
  return {...original, validateGossipBlock: vi.fn()};
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
    vi.mocked(validateGossipBlock).mockResolvedValue({skippedSlots: 0});
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
      vi.mocked(validateGossipBlock).mockRejectedValueOnce(
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
      // Locally produced blocks skip gossip validation, a duplicate publish can still race the import
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

      expect(validateGossipBlock).not.toHaveBeenCalled();
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
      vi.mocked(validateGossipBlock).mockRejectedValueOnce(error);

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
      "verifies the proposer signature and records the root before publishing a local block with broadcast_validation=%s",
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

        expect(modules.chain.bls.verifySignatureSets).toHaveBeenCalledOnce();
        expect(
          modules.chain.seenBlockProposers.hasBlockRoot(
            signedBlock.message.slot,
            signedBlock.message.proposerIndex,
            blockRoot
          )
        ).toBe(true);
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

        expect(verifyBlocksInEpoch).toHaveBeenCalledOnce();
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

  describe("seenBlockInputCache", () => {
    function cacheSubmittedBlock() {
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
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
      return {signedBlock, blockRoot};
    }

    function expectKept(blockRoot: string) {
      expect(modules.chain.seenBlockInputCache.remove).not.toHaveBeenCalled();
      expect(modules.chain.seenBlockInputCache.prune).not.toHaveBeenCalledWith(blockRoot);
      expect(modules.chain.seenPayloadEnvelopeInputCache.remove).not.toHaveBeenCalled();
    }

    it("removes a block this call cached when gossip validation rejects it", async () => {
      const {signedBlock, blockRoot} = cacheSubmittedBlock();
      const error = new BlockGossipError(GossipAction.REJECT, {
        code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
        slot: signedBlock.message.slot,
        root: blockRoot,
      });
      vi.mocked(validateGossipBlock).mockRejectedValueOnce(error);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toBe(error);

      expect(modules.chain.seenBlockInputCache.remove).toHaveBeenCalledExactlyOnceWith(blockRoot);
      expect(modules.chain.seenBlockInputCache.prune).not.toHaveBeenCalled();
    });

    it("keeps a block this call cached when the parent is unknown", async () => {
      const {signedBlock, blockRoot} = cacheSubmittedBlock();
      modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(null);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.consensus,
        })
      ).rejects.toThrow(BlockError);

      expectKept(blockRoot);
      expect(verifyBlocksInEpoch).not.toHaveBeenCalled();
    });

    it("keeps a post-gloas payload entry this call created when the parent is unknown", async () => {
      modules = getApiTestModules({config: forkConfig});
      Object.defineProperty(modules.chain, "blockProductionCache", {value: new Map()});
      Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
      Object.defineProperty(modules.chain, "custodyConfig", {value: {sampledColumns: [], custodyColumns: []}});
      modules.network.publishBeaconBlock = vi.fn();
      modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);
      modules.chain.seenPayloadEnvelopeInputCache.add = vi.fn();

      const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = slots.gloas;
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
        BlockInputColumns.createFromBlock({
          forkName: ForkName.fulu,
          block: ssz.fulu.SignedBeaconBlock.defaultValue(),
          blockRootHex: blockRoot,
          source: BlockInputSource.api,
          seenTimestampSec: 0,
          daOutOfRange: false,
          sampledColumns: [0],
          custodyColumns: [0],
        })
      );
      modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(null);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.consensus,
        })
      ).rejects.toThrow(BlockError);

      expect(modules.chain.seenPayloadEnvelopeInputCache.add).toHaveBeenCalledOnce();
      expectKept(blockRoot);
      expect(verifyBlocksInEpoch).not.toHaveBeenCalled();
    });

    it("removes a block this call cached when consensus verification fails", async () => {
      const {signedBlock, blockRoot} = cacheSubmittedBlock();
      const error = new Error("consensus failed");
      modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(generateProtoBlock({slot: 0}));
      vi.mocked(verifyBlocksInEpoch).mockRejectedValueOnce(error);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.consensus,
        })
      ).rejects.toBe(error);

      expect(modules.chain.seenBlockInputCache.remove).toHaveBeenCalledExactlyOnceWith(blockRoot);
      expect(modules.chain.seenBlockInputCache.prune).not.toHaveBeenCalled();
    });

    it("removes a block this call cached when a local proposer signature is invalid", async () => {
      const {signedBlock, blockRoot} = cacheSubmittedBlock();
      vi.spyOn(modules.chain.blockProductionCache, "has").mockReturnValue(true);
      modules.chain.bls.verifySignatureSets.mockResolvedValueOnce(false);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.consensus,
        })
      ).rejects.toThrow(BlockGossipError);

      expect(modules.chain.seenBlockInputCache.remove).toHaveBeenCalledExactlyOnceWith(blockRoot);
      expect(modules.chain.seenBlockInputCache.prune).not.toHaveBeenCalled();
      expect(modules.chain.persistInvalidSszValue).toHaveBeenCalledWith(
        modules.config.getForkTypes(signedBlock.message.slot).SignedBeaconBlock,
        signedBlock,
        "api_reject_consensus_failure",
        blockRoot
      );
    });

    it("removes a block this call cached when broadcast validation is rejected", async () => {
      const {signedBlock, blockRoot} = cacheSubmittedBlock();

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: "not-a-level" as routes.beacon.BroadcastValidation,
        })
      ).rejects.toThrow(ApiError);

      expect(modules.chain.seenBlockInputCache.remove).toHaveBeenCalledExactlyOnceWith(blockRoot);
      expect(modules.chain.seenBlockInputCache.prune).not.toHaveBeenCalled();
    });

    it("keeps a block this call cached when import fails after broadcast", async () => {
      const {signedBlock, blockRoot} = cacheSubmittedBlock();
      const error = new BlockError(signedBlock, {
        code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
        slot: signedBlock.message.slot,
        root: blockRoot,
      });
      modules.chain.processBlock = vi.fn().mockRejectedValue(error);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toBe(error);

      expectKept(blockRoot);
      expect(modules.network.publishBeaconBlock).toHaveBeenCalledOnce();
    });

    it("keeps the seen cache entry after a successful publish", async () => {
      const {signedBlock, blockRoot} = cacheSubmittedBlock();

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await api.publishBlockV2({
        signedBlockContents: {signedBlock},
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      });

      expect(modules.chain.seenBlockInputCache.getByBlock).toHaveBeenCalledOnce();
      expect(modules.network.publishBeaconBlock).toHaveBeenCalledWith(signedBlock);
      expectKept(blockRoot);
    });

    it("does not remove a block that was already in the seen cache", async () => {
      const {signedBlock, blockRoot} = cacheSubmittedBlock();
      const error = new BlockGossipError(GossipAction.REJECT, {
        code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
        slot: signedBlock.message.slot,
        root: blockRoot,
      });
      modules.chain.seenBlockInputCache.get.mockReturnValue({blockRootHex: blockRoot} as never);
      vi.mocked(validateGossipBlock).mockRejectedValueOnce(error);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toBe(error);

      expectKept(blockRoot);
    });

    it("does not remove an already-known block", async () => {
      const {signedBlock, blockRoot} = cacheSubmittedBlock();
      vi.mocked(validateGossipBlock).mockRejectedValueOnce(
        new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRoot})
      );

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).resolves.toBeUndefined();

      expectKept(blockRoot);
      expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
    });

    it("removes a post-gloas payload entry this call created when gossip validation rejects the block", async () => {
      modules = getApiTestModules({config: forkConfig});
      Object.defineProperty(modules.chain, "blockProductionCache", {value: new Map()});
      Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
      Object.defineProperty(modules.chain, "custodyConfig", {value: {sampledColumns: [], custodyColumns: []}});
      modules.network.publishBeaconBlock = vi.fn();
      modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);
      modules.chain.seenPayloadEnvelopeInputCache.add = vi.fn();

      const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = slots.gloas;
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
        BlockInputColumns.createFromBlock({
          forkName: ForkName.fulu,
          block: ssz.fulu.SignedBeaconBlock.defaultValue(),
          blockRootHex: blockRoot,
          source: BlockInputSource.api,
          seenTimestampSec: 0,
          daOutOfRange: false,
          sampledColumns: [0],
          custodyColumns: [0],
        })
      );
      const error = new BlockGossipError(GossipAction.REJECT, {
        code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
        slot: signedBlock.message.slot,
        root: blockRoot,
      });
      vi.mocked(validateGossipBlock).mockRejectedValueOnce(error);

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toBe(error);

      expect(modules.chain.seenPayloadEnvelopeInputCache.add).toHaveBeenCalledOnce();
      expect(modules.chain.seenBlockInputCache.remove).toHaveBeenCalledExactlyOnceWith(blockRoot);
      expect(modules.chain.seenPayloadEnvelopeInputCache.remove).toHaveBeenCalledExactlyOnceWith(blockRoot);
    });

    it("does not remove a post-gloas payload entry that was already cached", async () => {
      modules = getApiTestModules({config: forkConfig});
      Object.defineProperty(modules.chain, "blockProductionCache", {value: new Map()});
      Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
      Object.defineProperty(modules.chain, "custodyConfig", {value: {sampledColumns: [], custodyColumns: []}});
      modules.network.publishBeaconBlock = vi.fn();
      modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);
      modules.chain.seenPayloadEnvelopeInputCache.add = vi.fn();

      const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = slots.gloas;
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      modules.chain.seenBlockInputCache.get.mockReturnValue({blockRootHex: blockRoot} as never);
      vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue({
        blockRootHex: blockRoot,
      } as never);
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
        BlockInputColumns.createFromBlock({
          forkName: ForkName.fulu,
          block: ssz.fulu.SignedBeaconBlock.defaultValue(),
          blockRootHex: blockRoot,
          source: BlockInputSource.api,
          seenTimestampSec: 0,
          daOutOfRange: false,
          sampledColumns: [0],
          custodyColumns: [0],
        })
      );
      vi.mocked(validateGossipBlock).mockRejectedValueOnce(
        new BlockGossipError(GossipAction.REJECT, {
          code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
          slot: signedBlock.message.slot,
          root: blockRoot,
        })
      );

      const api = getBeaconBlockApi(defaultApiOptions, modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toThrow(BlockGossipError);

      expectKept(blockRoot);
    });
  });
});
