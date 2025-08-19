import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName, ForkPostCapella, ForkPostDeneb} from "@lodestar/params";
import {computeStartSlotAtEpoch, signedBlockToSignedHeader} from "@lodestar/state-transition";
import {SignedBeaconBlock, deneb, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {beforeEach, describe, expect, it} from "vitest";
import {
  BlockInputSource,
  IBlockInput,
  isBlockInputBlobs,
  isBlockInputPreDeneb,
} from "../../../../src/chain/blocks/blockInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SeenBlockInputCache} from "../../../../src/chain/seenCache/seenBlockInput.js";
import {Clock} from "../../../../src/util/clock.js";
import {testLogger} from "../../../utils/logger.js";

describe("SeenBlockInputCache", () => {
  let cache: SeenBlockInputCache;
  let abortController: AbortController;
  let chainEvents: ChainEventEmitter;

  const CAPELLA_FORK_EPOCH = 0;
  const DENEB_FORK_EPOCH = 1;
  const ELECTRA_FORK_EPOCH = 2;
  const FULU_FORK_EPOCH = 3;
  const GLOAS_FORK_EPOCH = 4;
  const config = createChainForkConfig({
    ...defaultChainConfig,
    CAPELLA_FORK_EPOCH,
    DENEB_FORK_EPOCH,
    ELECTRA_FORK_EPOCH,
    FULU_FORK_EPOCH,
    GLOAS_FORK_EPOCH,
  });

  const slots: Record<ForkPostCapella, number> = {
    capella: computeStartSlotAtEpoch(CAPELLA_FORK_EPOCH),
    deneb: computeStartSlotAtEpoch(DENEB_FORK_EPOCH),
    electra: computeStartSlotAtEpoch(ELECTRA_FORK_EPOCH),
    fulu: computeStartSlotAtEpoch(FULU_FORK_EPOCH),
    gloas: computeStartSlotAtEpoch(GLOAS_FORK_EPOCH),
  };

  type BlockTestSet<F extends ForkPostCapella> = {
    block: SignedBeaconBlock<F>;
    blockRoot: Uint8Array;
    rootHex: string;
  };

  function buildBlockTestSet<F extends ForkPostCapella = ForkPostCapella>(forkName: F): BlockTestSet<F> {
    const block = ssz[forkName].SignedBeaconBlock.defaultValue();
    block.message.slot = slots[forkName];
    const blockRoot = ssz[forkName].BeaconBlock.hashTreeRoot(block.message as any);
    const rootHex = toRootHex(blockRoot);
    return {
      block,
      blockRoot,
      rootHex,
    };
  }

  type ParentAndChildBlockTestSet<F extends ForkPostCapella> = {
    parentBlock: SignedBeaconBlock<F>;
    parentBlockRoot: Uint8Array;
    parentRootHex: string;
    childBlock: SignedBeaconBlock<F>;
    childBlockRoot: Uint8Array;
    childRootHex: string;
  };
  function buildParentAndChildBlockTestSet<F extends ForkPostCapella = ForkPostCapella>(
    forkName: F
  ): ParentAndChildBlockTestSet<F> {
    const {block: parentBlock, blockRoot: parentBlockRoot, rootHex: parentRootHex} = buildBlockTestSet(forkName);
    const {block: childBlock, blockRoot: childBlockRoot, rootHex: childRootHex} = buildBlockTestSet(forkName);
    childBlock.message.slot = parentBlock.message.slot + 1;
    childBlock.message.parentRoot = parentBlockRoot;
    return {
      parentBlock,
      parentBlockRoot,
      parentRootHex,
      childBlock,
      childBlockRoot,
      childRootHex,
    };
  }

  type BlockAndBlobTestSet<F extends ForkPostDeneb = ForkPostDeneb> = BlockTestSet<F> & {
    blobSidecar: deneb.BlobSidecar;
  };
  function buildBlockAndBlobTestSet(forkName: ForkPostDeneb): BlockAndBlobTestSet<ForkPostDeneb> {
    const {block, blockRoot, rootHex} = buildBlockTestSet<ForkPostDeneb>(forkName);
    const commitment = Buffer.alloc(48, 0x77);
    block.message.body.blobKzgCommitments = [commitment];
    const signedBlockHeader = signedBlockToSignedHeader(config, block);
    const blobSidecar = ssz[forkName].BlobSidecar.defaultValue();
    blobSidecar.signedBlockHeader = signedBlockHeader;
    blobSidecar.kzgCommitment = commitment;

    return {
      block,
      blockRoot,
      rootHex,
      blobSidecar,
    };
  }

  const logger = testLogger();
  beforeEach(() => {
    chainEvents = new ChainEventEmitter();
    abortController = new AbortController();
    const signal = abortController.signal;
    const genesisTime = Math.floor(Date.now() / 1000);
    cache = new SeenBlockInputCache({
      config,
      clock: new Clock({config, genesisTime, signal}),
      chainEvents,
      signal,
      logger,
      metrics: null,
    });
  });
  describe("has()", () => {
    it("should return true if in cache", () => {
      const {block, rootHex} = buildBlockTestSet(ForkName.capella);
      cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.has(rootHex)).toBeTruthy();
    });
    it("should return false if not in cache", () => {
      const {block, blockRoot, rootHex} = buildBlockTestSet(ForkName.capella);
      cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.has(rootHex)).toBeTruthy();
      blockRoot[0] = (blockRoot[0] + 1) % 255;
      blockRoot[1] = (blockRoot[1] + 1) % 255;
      blockRoot[2] = (blockRoot[2] + 1) % 255;
      expect(cache.has(toRootHex(blockRoot))).toBeFalsy();
    });
  });
  describe("get()", () => {
    it("should return BlockInput if in cache", () => {
      const {block, rootHex} = buildBlockTestSet(ForkName.capella);
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput);
    });
    it("should return undefined if not in cache", () => {
      const {block, blockRoot, rootHex} = buildBlockTestSet(ForkName.capella);
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput);
      blockRoot[0] = (blockRoot[0] + 1) % 255;
      blockRoot[1] = (blockRoot[1] + 1) % 255;
      blockRoot[2] = (blockRoot[2] + 1) % 255;
      expect(cache.get(toRootHex(blockRoot))).toBeUndefined();
    });
  });
  describe("remove()", () => {
    it("should remove a BlockInput", () => {
      const {block, rootHex} = buildBlockTestSet(ForkName.capella);
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput);
      cache.remove(rootHex);
      expect(cache.get(rootHex)).toBeUndefined();
    });
    it("should not throw an error if BlockInput not in cache", () => {
      const {block, blockRoot, rootHex} = buildBlockTestSet(ForkName.capella);
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput);
      blockRoot[0] = (blockRoot[0] + 1) % 255;
      blockRoot[1] = (blockRoot[1] + 1) % 255;
      blockRoot[2] = (blockRoot[2] + 1) % 255;
      expect(() => cache.remove(toRootHex(blockRoot))).not.toThrow();
      expect(cache.has(rootHex)).toBeTruthy();
    });
  });
  describe("prune()", () => {
    it("should remove a BlockInput", () => {
      const {block, rootHex} = buildBlockTestSet(ForkName.capella);
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput);
      cache.prune(rootHex);
      expect(cache.get(rootHex)).toBeUndefined();
    });
    it("should remove all ancestors of a BlockInput", () => {
      const {parentBlock, parentRootHex, childBlock, childRootHex} = buildParentAndChildBlockTestSet(ForkName.capella);

      const parentBlockInput = cache.getByBlock({
        block: parentBlock,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(parentRootHex)).toBe(parentBlockInput);

      const childBlockInput = cache.getByBlock({
        block: childBlock,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(childRootHex)).toBe(childBlockInput);

      cache.prune(childRootHex);
      expect(cache.get(childRootHex)).toBeUndefined();
      expect(cache.get(parentRootHex)).toBeUndefined();
    });
  });
  describe("onFinalized()", () => {
    let childRootHex: string;
    let childBlockInput: IBlockInput;
    let parentRootHex: string;
    let parentBlockInput: IBlockInput;
    const root = Buffer.alloc(32, 0xff);
    const rootHex = toRootHex(root);
    beforeEach(() => {
      const {
        parentBlock,
        parentRootHex: parentRoot,
        childBlock,
        childRootHex: childRoot,
      } = buildParentAndChildBlockTestSet(ForkName.capella);
      parentRootHex = parentRoot;
      childRootHex = childRoot;

      parentBlockInput = cache.getByBlock({
        block: parentBlock,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(parentRootHex)).toBe(parentBlockInput);

      childBlockInput = cache.getByBlock({
        block: childBlock,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(childRootHex)).toBe(childBlockInput);
    });
    it("should remove all BlockInputs in slots before the checkpoint", () => {
      chainEvents.emit(ChainEvent.forkChoiceFinalized, {
        epoch: DENEB_FORK_EPOCH,
        root,
        rootHex,
      });
      expect(cache.get(childRootHex)).toBeUndefined();
      expect(cache.get(parentRootHex)).toBeUndefined();
    });
    it("should not remove BlockInputs in slots after the checkpoint", () => {
      chainEvents.emit(ChainEvent.forkChoiceFinalized, {
        epoch: CAPELLA_FORK_EPOCH,
        root,
        rootHex,
      });
      expect(cache.get(childRootHex)).toBe(childBlockInput);
      expect(cache.get(parentRootHex)).toBe(parentBlockInput);
    });
  });
  describe("getByBlock()", () => {
    it("should return a new BlockInput for a new block root", () => {
      const {block, rootHex} = buildBlockTestSet(ForkName.capella);
      expect(cache.get(rootHex)).toBeUndefined();
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput);
    });
    describe("should return the correct type of BlockInput for a given block root", () => {
      it("should return a BlockInputPreDeneb", () => {
        const {block} = buildBlockTestSet(ForkName.capella);
        const blockInput = cache.getByBlock({
          block,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        });
        expect(isBlockInputPreDeneb(blockInput)).toBeTruthy();
      });
      it("should return a BlockInputBlobs", () => {
        const {block} = buildBlockTestSet(ForkName.deneb);
        const blockInput = cache.getByBlock({
          block,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        });
        expect(isBlockInputBlobs(blockInput)).toBeTruthy();
      });
      // TODO(fulu): need to turn this on once we have custodyConfig available with peerDAS branch
      //   it("should return a BlockInputColumns", () => {
      //     const {block} = buildBlockTestSet(ForkName.fulu);
      //     const blockInput = cache.getByBlock({
      //       block,
      //       source: BlockInputSource.gossip,
      //       seenTimestampSec: Date.now(),
      //     });
      //     expect(isBlockInputColumns(blockInput)).toBeTruthy();
      //   });
    });
    it("should return the same BlockInput for an existing block root", () => {
      const {block, rootHex} = buildBlockTestSet(ForkName.capella);
      const blockInput1 = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput1);
      const blockInput2 = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(blockInput1).toBe(blockInput2);
    });
    it("should not throw for a BlockInput with an existing block", () => {
      const {block, rootHex} = buildBlockTestSet(ForkName.capella);
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(() =>
        blockInput.addBlock({
          block,
          blockRootHex: rootHex,
          source: {source: BlockInputSource.gossip, seenTimestampSec: Date.now()},
        })
      ).toThrow();
      expect(() =>
        cache.getByBlock({
          block,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        })
      ).not.toThrow();
    });
    it("should return the correct BlockInput for a BlockInput created by blob", () => {
      const {block, blobSidecar} = buildBlockAndBlobTestSet(ForkName.deneb);

      const blockInput1 = cache.getByBlob({
        blobSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockInput2 = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });

      expect(blockInput1).toBe(blockInput2);
    });
  });
  describe("getByBlob()", () => {
    it("should return a new BlockInput for a new block root", () => {
      const {rootHex, blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);
      expect(cache.get(rootHex)).toBeUndefined();
      const blockInput = cache.getByBlob({
        blobSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput);
    });
    it("should return the same BlockInput for an existing block root", () => {
      const {rootHex, blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);

      const blockInput1 = cache.getByBlob({
        blobSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput1);
      const blockInput2 = cache.getByBlob({
        blobSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(blockInput1).toBe(blockInput2);
    });
    it("should throw if attempting to add a blob to wrong type of BlockInput", () => {
      const {block} = buildBlockTestSet(ForkName.capella);
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(isBlockInputPreDeneb(blockInput)).toBeTruthy();

      const {blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);
      blobSidecar.signedBlockHeader = signedBlockToSignedHeader(config, block);
      expect(() =>
        cache.getByBlob({blobSidecar, source: BlockInputSource.gossip, seenTimestampSec: Date.now()})
      ).toThrow();
    });
    it("should add blob to an existing BlockInput", () => {
      const {block, blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);

      const blockInput1 = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockInput2 = cache.getByBlob({
        blobSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });

      expect(blockInput1).toBe(blockInput2);
      expect(blockInput2.getBlobs()[0]).toBe(blobSidecar);
    });
    it("should not throw for a BlockInput with an existing blob", () => {
      const {rootHex, blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);

      expect(cache.get(rootHex)).toBeUndefined();
      const blockInput = cache.getByBlob({
        blobSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput);
      expect(() =>
        blockInput.addBlob({
          blobSidecar,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
          blockRootHex: rootHex,
        })
      ).toThrow();
      expect(() =>
        cache.getByBlob({
          blobSidecar,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        })
      ).not.toThrow();
    });
    it("should throw for an existing blob with opts.throwGossipErrorIfAlreadyKnown", () => {
      const {rootHex, blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);

      expect(cache.get(rootHex)).toBeUndefined();
      const blockInput = cache.getByBlob(
        {
          blobSidecar,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        },
        {throwErrorIfAlreadyKnown: true}
      );
      expect(cache.get(rootHex)).toBe(blockInput);
      expect(() =>
        cache.getByBlob(
          {
            blobSidecar,
            source: BlockInputSource.gossip,
            seenTimestampSec: Date.now(),
          },
          {throwErrorIfAlreadyKnown: true}
        )
      ).toThrow();
    });
  });
});
