import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {BlockInputPreData, BlockInputSource} from "../../../../../../src/chain/blocks/blockInput/index.js";
import {verifyBlocksInEpoch} from "../../../../../../src/chain/blocks/verifyBlock.js";
import {BlockErrorCode, BlockGossipError, GossipAction} from "../../../../../../src/chain/errors/index.js";
import {SeenBlockProposers} from "../../../../../../src/chain/seenCache/seenBlockProposers.js";
import {validateGossipBlock} from "../../../../../../src/chain/validation/block.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

vi.mock("../../../../../../src/chain/blocks/verifyBlock.js");
vi.mock("../../../../../../src/chain/validation/block.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../../src/chain/validation/block.js")>();
  return {...original, validateGossipBlock: vi.fn()};
});

describe("api - beacon - publishBlockV2", () => {
  const config = createBeaconConfig(configDef, Buffer.alloc(32, 1));
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
      const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      const blockInput = BlockInputPreData.createFromBlock({
        forkName: ForkName.phase0,
        block: signedBlock,
        blockRootHex: blockRoot,
        source: BlockInputSource.api,
        seenTimestampSec: 0,
        daOutOfRange: false,
      });
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
      vi.mocked(validateGossipBlock).mockRejectedValueOnce(
        new BlockGossipError(GossipAction.IGNORE, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRoot})
      );

      const api = getBeaconBlockApi(modules);
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

    it("rejects a repeat proposal", async () => {
      const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      const blockInput = BlockInputPreData.createFromBlock({
        forkName: ForkName.phase0,
        block: signedBlock,
        blockRootHex: blockRoot,
        source: BlockInputSource.api,
        seenTimestampSec: 0,
        daOutOfRange: false,
      });
      const error = new BlockGossipError(GossipAction.IGNORE, {
        code: BlockErrorCode.REPEAT_PROPOSAL,
        proposerIndex: signedBlock.message.proposerIndex,
        root: blockRoot,
      });
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
      vi.mocked(validateGossipBlock).mockRejectedValueOnce(error);

      const api = getBeaconBlockApi(modules);
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.gossip,
        })
      ).rejects.toBe(error);

      expect(modules.chain.persistInvalidSszValue).toHaveBeenCalledWith(
        modules.config.getForkTypes(signedBlock.message.slot).SignedBeaconBlock,
        signedBlock,
        "api_reject_gossip_failure"
      );
      expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
      expect(modules.chain.processBlock).not.toHaveBeenCalled();
    });
  });

  describe("broadcast_validation=consensus_and_equivocation", () => {
    it("does not publish or import a non-local block that conflicts with an observed proposal", async () => {
      const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = 1;
      signedBlock.message.proposerIndex = 2;
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      const conflictingBlockRoot = toRootHex(Buffer.alloc(32, 1));
      const blockInput = BlockInputPreData.createFromBlock({
        forkName: ForkName.phase0,
        block: signedBlock,
        blockRootHex: blockRoot,
        source: BlockInputSource.api,
        seenTimestampSec: 0,
        daOutOfRange: false,
      });
      modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(generateProtoBlock({slot: 0}));
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
      modules.chain.seenBlockProposers.observeBlockRoot(
        signedBlock.message.slot,
        signedBlock.message.proposerIndex,
        conflictingBlockRoot,
        ssz.phase0.SignedBeaconBlockHeader.defaultValue()
      );

      const api = getBeaconBlockApi(modules);
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
        const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
        signedBlock.message.slot = 1;
        signedBlock.message.proposerIndex = 2;
        const blockRoot = toRootHex(
          modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
        );
        const blockInput = BlockInputPreData.createFromBlock({
          forkName: ForkName.phase0,
          block: signedBlock,
          blockRootHex: blockRoot,
          source: BlockInputSource.api,
          seenTimestampSec: 0,
          daOutOfRange: false,
        });
        vi.spyOn(modules.chain.blockProductionCache, "has").mockReturnValue(true);
        modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);

        const api = getBeaconBlockApi(modules);
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
        const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
        signedBlock.message.slot = 1;
        signedBlock.message.proposerIndex = 2;
        const blockRoot = toRootHex(
          modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
        );
        const blockInput = BlockInputPreData.createFromBlock({
          forkName: ForkName.phase0,
          block: signedBlock,
          blockRootHex: blockRoot,
          source: BlockInputSource.api,
          seenTimestampSec: 0,
          daOutOfRange: false,
        });
        modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(generateProtoBlock({slot: 0}));
        modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);

        const api = getBeaconBlockApi(modules);
        await api.publishBlockV2({signedBlockContents: {signedBlock}, broadcastValidation});

        expect(verifyBlocksInEpoch).toHaveBeenCalledOnce();
        expect(modules.network.publishBeaconBlock).toHaveBeenCalledWith(signedBlock);
      }
    );
  });
});
