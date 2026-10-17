import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {signedBeaconBlockToBlinded} from "@lodestar/state-transition";
import {capella, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {
  BlockInputColumns,
  BlockInputPreData,
  BlockInputSource,
} from "../../../../../../src/chain/blocks/blockInput/index.js";
import {verifyBlocksInEpoch} from "../../../../../../src/chain/blocks/verifyBlock.js";
import {BlockError, BlockErrorCode, BlockGossipError, GossipAction} from "../../../../../../src/chain/errors/index.js";
import {BlockType, ProduceFullBellatrix} from "../../../../../../src/chain/produceBlock/index.js";
import {SeenBlockProposers} from "../../../../../../src/chain/seenCache/seenBlockProposers.js";
import {validateGossipBlock} from "../../../../../../src/chain/validation/block.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {config as forkConfig, generateBlockWithColumnSidecars} from "../../../../../utils/blocksAndData.js";
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

    it("returns successfully without publishing a block that is already imported", async () => {
      const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
      const blockRoot = toRootHex(
        modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
      );
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
        BlockInputPreData.createFromBlock({
          forkName: ForkName.phase0,
          block: signedBlock,
          blockRootHex: blockRoot,
          source: BlockInputSource.api,
          seenTimestampSec: 0,
          daOutOfRange: false,
        })
      );
      modules.chain.forkChoice.hasBlockHex.mockReturnValue(true);

      const api = getBeaconBlockApi(modules);
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
      // Locally produced blocks skip gossip validation, a duplicate publish can still race the import
      modules.chain.blockProductionCache.set(blockRoot, {} as never);
      modules.chain.processBlock = vi
        .fn()
        .mockRejectedValue(new BlockError(signedBlock, {code: BlockErrorCode.ALREADY_KNOWN, root: blockRoot}));

      const api = getBeaconBlockApi(modules);
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
        "api_reject_gossip_failure",
        blockRoot
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

    const api = getBeaconBlockApi(modules);
    await expect(
      api.publishBlockV2({
        signedBlockContents: {signedBlock: block, blobs, kzgProofs},
        broadcastValidation: routes.beacon.BroadcastValidation.none,
      })
    ).resolves.toBeUndefined();

    expect(modules.network.publishDataColumnSidecar).toHaveBeenCalledTimes(columnSidecars.length);
  });
});

describe("api - beacon - publish block size cap", () => {
  const config = createBeaconConfig(
    {...configDef, ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0, CAPELLA_FORK_EPOCH: 0},
    Buffer.alloc(32, 1)
  );
  const limit = config.MAX_PAYLOAD_SIZE;
  const sizes = [
    ["at", limit, true],
    ["just over", limit + 1, false],
    ["far over", 2 * limit, false],
  ] as const;
  let modules: ApiTestModules;

  beforeEach(() => {
    vi.clearAllMocks();
    modules = getApiTestModules({config});
    Object.defineProperty(modules.chain, "blockProductionCache", {value: new Map()});
    Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
    modules.network.publishBeaconBlock = vi.fn();
    modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);
  });

  /** A Capella block whose signed SSZ size is `size`, filled by one transaction */
  function blockOfSize(size: number): capella.SignedBeaconBlock {
    const signedBlock = ssz.capella.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    const empty = ssz.capella.SignedBeaconBlock.value_serializedSize(signedBlock);
    // A transaction adds its 4-byte offset and its bytes
    signedBlock.message.body.executionPayload.transactions = [new Uint8Array(size - empty - 4)];
    expect(ssz.capella.SignedBeaconBlock.value_serializedSize(signedBlock)).toBe(size);
    return signedBlock;
  }

  function importInput(signedBlock: capella.SignedBeaconBlock): BlockInputPreData {
    const blockInput = BlockInputPreData.createFromBlock({
      forkName: ForkName.capella,
      block: signedBlock,
      // The lookup is mocked, so the root need not be the block's
      blockRootHex: toRootHex(new Uint8Array(32)),
      source: BlockInputSource.api,
      seenTimestampSec: 0,
      daOutOfRange: false,
    });
    modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
    return blockInput;
  }

  async function expectOutcome(publish: Promise<unknown>, accepted: boolean, size: number): Promise<void> {
    if (accepted) {
      await expect(publish).resolves.toBeUndefined();
      expect(modules.network.publishBeaconBlock).toHaveBeenCalledOnce();
      expect(modules.chain.processBlock).toHaveBeenCalledOnce();
      return;
    }
    await expect(publish).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining(`Signed block size ${size} exceeds MAX_PAYLOAD_SIZE ${limit}`),
    });
    // Refused before the block is cached, published or imported
    expect(modules.chain.seenBlockInputCache.getByBlock).not.toHaveBeenCalled();
    expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
    expect(modules.chain.processBlock).not.toHaveBeenCalled();
  }

  it.each(sizes)("handles a full block %s the limit", async (_, size, accepted) => {
    const signedBlock = blockOfSize(size);
    importInput(signedBlock);
    const api = getBeaconBlockApi(modules);
    await expectOutcome(
      api.publishBlockV2({
        signedBlockContents: {signedBlock},
        broadcastValidation: routes.beacon.BroadcastValidation.none,
      }),
      accepted,
      size
    );
  });

  it.each(sizes)("handles an engine-reconstructed blinded block %s the limit", async (_, size, accepted) => {
    const signedBlock = blockOfSize(size);
    importInput(signedBlock);
    const signedBlindedBlock = signedBeaconBlockToBlinded(config, signedBlock);
    const blockRoot = toRootHex(
      ssz.capella.BlindedBeaconBlock.hashTreeRoot(signedBlindedBlock.message as capella.BlindedBeaconBlock)
    );
    modules.chain.blockProductionCache.set(blockRoot, {
      type: BlockType.Full,
      fork: ForkName.capella,
      executionPayload: signedBlock.message.body.executionPayload,
    } as ProduceFullBellatrix);
    const api = getBeaconBlockApi(modules);
    await expectOutcome(
      api.publishBlindedBlockV2({signedBlindedBlock, broadcastValidation: routes.beacon.BroadcastValidation.none}),
      accepted,
      size
    );
  });

  it.each(sizes)("handles a pre-Fulu builder block %s the limit", async (_, size, accepted) => {
    const signedBlock = blockOfSize(size);
    importInput(signedBlock);
    const submitBlindedBlock = vi.fn().mockResolvedValue({signedBlock});
    Object.defineProperty(modules.chain, "executionBuilder", {value: {submitBlindedBlock}});
    const api = getBeaconBlockApi(modules);
    await expectOutcome(
      api.publishBlindedBlockV2({
        signedBlindedBlock: signedBeaconBlockToBlinded(config, signedBlock),
        broadcastValidation: routes.beacon.BroadcastValidation.none,
      }),
      accepted,
      size
    );
    expect(submitBlindedBlock).toHaveBeenCalledOnce();
  });
});
