import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {BeaconEngineCore} from "../../../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {GossipValidationStatus} from "../../../../../../src/chain/beaconEngine/gossipValidationResult.js";
import {
  BlockInputBlobs,
  BlockInputColumns,
  BlockInputPreData,
  BlockInputSource,
} from "../../../../../../src/chain/blocks/blockInput/index.js";
import {validateApiBlock} from "../../../../../../src/chain/blocks/validateApiBlock.js";
import {BlockError, BlockErrorCode, BlockGossipError, GossipAction} from "../../../../../../src/chain/errors/index.js";
import {SeenBlockProposers} from "../../../../../../src/chain/seenCache/seenBlockProposers.js";
import {validateGossipBlock} from "../../../../../../src/chain/validation/block.js";
import {withBeaconEngineFacade} from "../../../../../mocks/mockedBeaconChain.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {config as forkConfig, generateBlockWithColumnSidecars} from "../../../../../utils/blocksAndData.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

vi.mock("../../../../../../src/chain/blocks/validateApiBlock.js");
vi.mock("../../../../../../src/chain/validation/block.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../../../src/chain/validation/block.js")>();
  return {...original, validateGossipBlock: vi.fn()};
});

describe("api - beacon - publishBlockV2", () => {
  const config = createBeaconConfig(configDef, Buffer.alloc(32, 1));
  let modules: ApiTestModules;

  function getApi() {
    return getBeaconBlockApi({...modules, chain: withBeaconEngineFacade(modules.chain)});
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiBlock).mockResolvedValue(undefined);
    modules = getApiTestModules({config});
    for (const name of [
      "validateGossipBlockObject",
      "getConflictingBlockRoots",
      "verifyAndObserveBlockProposerObject",
    ] as const) {
      Object.defineProperty(modules.chain.beaconEngine, name, {
        value: BeaconEngineCore.prototype[name].bind(modules.chain.beaconEngine),
        configurable: true,
      });
    }
    Object.defineProperty(modules.chain, "blockProductionCache", {value: new Map()});
    Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
    modules.network.publishBeaconBlock = vi.fn();
    modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(validateGossipBlock).mockResolvedValue({skippedSlots: 0});
  });

  it.each([false, true])("caches API block data before gossip validation (SSZ request: %s)", async (sszRequest) => {
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    const root = ssz.phase0.BeaconBlock.hashTreeRoot(signedBlock.message);
    const rootHex = toRootHex(root);
    const bytes = ssz.phase0.SignedBeaconBlock.serialize(signedBlock);
    const validate = vi.spyOn(modules.chain.beaconEngine, "validateGossipBlockObject");
    modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
      BlockInputPreData.createFromBlock({
        block: signedBlock,
        blockRootHex: rootHex,
        forkName: ForkName.phase0,
        source: BlockInputSource.api,
        seenTimestampSec: 0,
        daOutOfRange: false,
      })
    );
    const deserialize = vi.spyOn(ssz.phase0.SignedBeaconBlock, "deserialize");
    vi.mocked(validateGossipBlock).mockImplementation(async (block) => {
      expect(block).toBe(signedBlock);
      expect(modules.chain.serializedCache.get(signedBlock)).toEqual(bytes);
      return {skippedSlots: 0};
    });
    await getApi().publishBlockV2(
      {signedBlockContents: {signedBlock}, broadcastValidation: routes.beacon.BroadcastValidation.gossip},
      sszRequest ? {sszBytes: bytes} : undefined
    );
    expect(deserialize).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledExactlyOnceWith({data: signedBlock, bytes}, ForkName.phase0, undefined);
    expect(validate.mock.calls[0][0].bytes).toBe(modules.chain.serializedCache.get(signedBlock));
    expect(modules.chain.serializedCache.get(signedBlock)).toEqual(bytes);
    if (sszRequest) expect(modules.chain.serializedCache.get(signedBlock)).toBe(bytes);
    deserialize.mockRestore();
    validate.mockRestore();
  });

  describe("broadcast_validation=gossip", () => {
    it.each(["INVALID_BLOCK_SSZ", "SIGNED_BLOCK_ROOT_MISMATCH", "UNEXPECTED_ERROR"])(
      "maps a plain %s engine verdict to an HTTP error",
      async (code) => {
        const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
        const root = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(signedBlock.message));
        const status = code === "UNEXPECTED_ERROR" ? GossipValidationStatus.Ignore : GossipValidationStatus.Reject;
        modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
          BlockInputPreData.createFromBlock({
            block: signedBlock,
            blockRootHex: root,
            forkName: ForkName.phase0,
            source: BlockInputSource.api,
            seenTimestampSec: 0,
            daOutOfRange: false,
          })
        );
        Object.defineProperty(modules.chain.beaconEngine, "validateGossipBlockObject", {
          value: vi.fn().mockResolvedValue({err: {status, code}}),
          configurable: true,
        });

        await expect(
          getApi().publishBlockV2({
            signedBlockContents: {signedBlock},
            broadcastValidation: routes.beacon.BroadcastValidation.gossip,
          })
        ).rejects.toMatchObject({statusCode: code === "UNEXPECTED_ERROR" ? 500 : 400});
        expect(modules.chain.serializedCache.get(signedBlock)).toBeUndefined();
        expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
        expect(modules.chain.processBlock).not.toHaveBeenCalled();
      }
    );

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

      const api = getApi();
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

      const api = getApi();
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

      const api = getApi();
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

      const api = getApi();
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

      const api = getApi();
      await expect(
        api.publishBlockV2({
          signedBlockContents: {signedBlock},
          broadcastValidation: routes.beacon.BroadcastValidation.consensusAndEquivocation,
        })
      ).rejects.toThrow(/proposer equivocation/);

      expect(validateApiBlock).toHaveBeenCalledOnce();
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

        const api = getApi();
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

        const api = getApi();
        await api.publishBlockV2({signedBlockContents: {signedBlock}, broadcastValidation});

        expect(validateApiBlock).toHaveBeenCalledOnce();
        expect(modules.network.publishBeaconBlock).toHaveBeenCalledWith(signedBlock);
      }
    );
  });

  describe.each(["consensus", "proposer signature", "equivocation"] as const)(
    "%s rejection cache cleanup",
    (failure) => {
      it.each([false, true])(
        "releases cached request bytes while preserving replacements (replacement: %s)",
        async (replace) => {
          modules = getApiTestModules({config: createBeaconConfig(forkConfig, Buffer.alloc(32, 1))});
          const contents = ssz.deneb.SignedBlockContents.defaultValue();
          const signedBlock = contents.signedBlock;
          signedBlock.message.slot = forkConfig.DENEB_FORK_EPOCH * SLOTS_PER_EPOCH;
          signedBlock.message.body.blobKzgCommitments.push(ssz.deneb.KZGCommitment.defaultValue());
          contents.blobs.push(ssz.deneb.Blob.defaultValue());
          contents.kzgProofs.push(ssz.deneb.KZGProof.defaultValue());
          const requestBytes = ssz.deneb.SignedBlockContents.serialize(contents);
          const rootHex = toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(signedBlock.message));
          const blockInput = BlockInputBlobs.createFromBlock({
            forkName: ForkName.deneb,
            block: signedBlock,
            blockRootHex: rootHex,
            source: BlockInputSource.api,
            seenTimestampSec: 0,
            daOutOfRange: false,
          });
          modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
          modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(
            generateProtoBlock({slot: signedBlock.message.slot - 1})
          );
          modules.chain.processBlock = vi.fn();
          modules.network.publishBeaconBlock = vi.fn();
          vi.spyOn(modules.chain.blockProductionCache, "has").mockReturnValue(failure === "proposer signature");

          const replacement = ssz.deneb.SignedBeaconBlock.clone(signedBlock);
          replacement.signature = Uint8Array.from(replacement.signature);
          replacement.signature[0] = 1;
          const replacementBytes = ssz.deneb.SignedBeaconBlock.serialize(replacement);
          const beforeRejection = () => {
            const cached = modules.chain.serializedCache.get(signedBlock);
            expect(cached?.buffer).toBe(requestBytes.buffer);
            expect(cached?.byteLength).toBeLessThan(requestBytes.byteLength);
            if (replace) modules.chain.serializedCache.set(replacement, replacementBytes);
          };
          const error = new Error("Validation failed");
          if (failure === "consensus") {
            vi.mocked(validateApiBlock).mockImplementationOnce(async () => {
              beforeRejection();
              throw error;
            });
          } else if (failure === "proposer signature") {
            modules.chain.beaconEngine.verifyAndObserveBlockProposerObject = vi.fn(async () => {
              beforeRejection();
              throw error;
            });
          } else {
            modules.chain.beaconEngine.getConflictingBlockRoots = vi.fn(async () => {
              beforeRejection();
              return [toRootHex(Buffer.alloc(32, 1))];
            });
          }

          await expect(
            getApi().publishBlockV2(
              {
                signedBlockContents: contents,
                broadcastValidation:
                  failure === "equivocation"
                    ? routes.beacon.BroadcastValidation.consensusAndEquivocation
                    : routes.beacon.BroadcastValidation.consensus,
              },
              {sszBytes: requestBytes}
            )
          ).rejects.toThrow(failure === "equivocation" ? /proposer equivocation/ : error);

          expect(modules.chain.serializedCache.get(signedBlock)).toBeUndefined();
          expect(modules.chain.serializedCache.get(replacement)).toBe(replace ? replacementBytes : undefined);
          expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
          expect(modules.chain.processBlock).not.toHaveBeenCalled();
        }
      );
    }
  );

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

    const api = getApi();
    await expect(
      api.publishBlockV2({
        signedBlockContents: {signedBlock: block, blobs, kzgProofs},
        broadcastValidation: routes.beacon.BroadcastValidation.none,
      })
    ).resolves.toBeUndefined();

    expect(modules.network.publishDataColumnSidecar).toHaveBeenCalledTimes(columnSidecars.length);
  });
});
