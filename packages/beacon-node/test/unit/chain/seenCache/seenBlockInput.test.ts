import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {computeStartSlotAtEpoch, signedBlockToSignedHeader} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {beforeEach, describe, expect, it} from "vitest";
import {
  BlockInputSource,
  IBlockInput,
  isBlockInputBlobs,
  isBlockInputColumns,
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
  const config = createChainForkConfig({
    ...defaultChainConfig,
    CAPELLA_FORK_EPOCH,
    DENEB_FORK_EPOCH,
    ELECTRA_FORK_EPOCH,
    FULU_FORK_EPOCH,
  });

  const capellaSlot = computeStartSlotAtEpoch(CAPELLA_FORK_EPOCH);
  const denebSlot = computeStartSlotAtEpoch(DENEB_FORK_EPOCH);
  const electraSlot = computeStartSlotAtEpoch(ELECTRA_FORK_EPOCH);
  const fuluSlot = computeStartSlotAtEpoch(FULU_FORK_EPOCH);

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
      const block = ssz.capella.SignedBeaconBlock.defaultValue();
      block.message.slot = capellaSlot;
      cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockRoot = ssz.capella.BeaconBlock.hashTreeRoot(block.message);
      expect(cache.has(toRootHex(blockRoot))).toBeTruthy();
    });
    it("should return false if not in cache", () => {
      const block = ssz.capella.SignedBeaconBlock.defaultValue();
      block.message.slot = capellaSlot;
      cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockRoot = ssz.capella.BeaconBlock.hashTreeRoot(block.message);
      expect(cache.has(toRootHex(blockRoot))).toBeTruthy();
      blockRoot[0] = (blockRoot[0] + 1) % 255;
      blockRoot[1] = (blockRoot[1] + 1) % 255;
      blockRoot[2] = (blockRoot[2] + 1) % 255;
      expect(cache.has(toRootHex(blockRoot))).toBeFalsy();
    });
  });
  describe("get()", () => {
    it("should return BlockInput if in cache", () => {
      const block = ssz.capella.SignedBeaconBlock.defaultValue();
      block.message.slot = capellaSlot;
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockRoot = ssz.capella.BeaconBlock.hashTreeRoot(block.message);
      expect(cache.get(toRootHex(blockRoot))).toBe(blockInput);
    });
    it("should return undefined if not in cache", () => {
      const block = ssz.capella.SignedBeaconBlock.defaultValue();
      block.message.slot = capellaSlot;
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockRoot = ssz.capella.BeaconBlock.hashTreeRoot(block.message);
      expect(cache.get(toRootHex(blockRoot))).toBe(blockInput);
      blockRoot[0] = (blockRoot[0] + 1) % 255;
      blockRoot[1] = (blockRoot[1] + 1) % 255;
      blockRoot[2] = (blockRoot[2] + 1) % 255;
      expect(cache.get(toRootHex(blockRoot))).toBeUndefined();
    });
  });
  describe("remove()", () => {
    it("should remove a BlockInput", () => {
      const block = ssz.capella.SignedBeaconBlock.defaultValue();
      block.message.slot = capellaSlot;
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockRoot = ssz.capella.BeaconBlock.hashTreeRoot(block.message);
      const rootHex = toRootHex(blockRoot);
      expect(cache.get(rootHex)).toBe(blockInput);
      cache.remove(rootHex);
      expect(cache.get(rootHex)).toBeUndefined();
    });
    it("should not throw an error if BlockInput not in cache", () => {
      const block = ssz.capella.SignedBeaconBlock.defaultValue();
      block.message.slot = capellaSlot;
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockRoot = ssz.capella.BeaconBlock.hashTreeRoot(block.message);
      const rootHex = toRootHex(blockRoot);
      expect(cache.get(rootHex)).toBe(blockInput);
      blockRoot[0] = (blockRoot[0] + 1) % 255;
      blockRoot[1] = (blockRoot[1] + 1) % 255;
      blockRoot[2] = (blockRoot[2] + 1) % 255;
      expect(() => cache.remove(toRootHex(blockRoot))).not.toThrow();
      expect(cache.get(rootHex)).toBe(blockInput);
    });
  });
  describe("prune()", () => {
    it("should remove a BlockInput", () => {
      const block = ssz.capella.SignedBeaconBlock.defaultValue();
      block.message.slot = capellaSlot;
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockRoot = ssz.capella.BeaconBlock.hashTreeRoot(block.message);
      const rootHex = toRootHex(blockRoot);
      expect(cache.get(rootHex)).toBe(blockInput);
      cache.prune(rootHex);
      expect(cache.get(rootHex)).toBeUndefined();
    });
    it("should remove all ancestors of a BlockInput", () => {
      const parentBlock = ssz.capella.SignedBeaconBlock.defaultValue();
      parentBlock.message.slot = capellaSlot;
      const parentBlockRoot = ssz.capella.BeaconBlock.hashTreeRoot(parentBlock.message);
      const parentBlockInput = cache.getByBlock({
        block: parentBlock,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const parentRootHex = toRootHex(parentBlockRoot);
      expect(cache.get(parentRootHex)).toBe(parentBlockInput);

      const childBlock = ssz.capella.SignedBeaconBlock.defaultValue();
      childBlock.message.slot = capellaSlot + 1;
      childBlock.message.parentRoot = parentBlockRoot;
      const childBlockRoot = ssz.capella.BeaconBlock.hashTreeRoot(childBlock.message);
      const childBlockInput = cache.getByBlock({
        block: childBlock,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const childRootHex = toRootHex(childBlockRoot);
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
    beforeEach(() => {
      const parentBlock = ssz.capella.SignedBeaconBlock.defaultValue();
      parentBlock.message.slot = capellaSlot;
      const parentBlockRoot = ssz.capella.BeaconBlock.hashTreeRoot(parentBlock.message);
      parentBlockInput = cache.getByBlock({
        block: parentBlock,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      parentRootHex = toRootHex(parentBlockRoot);
      expect(cache.get(parentRootHex)).toBe(parentBlockInput);

      const childBlock = ssz.capella.SignedBeaconBlock.defaultValue();
      childBlock.message.slot = capellaSlot + 1;
      childBlock.message.parentRoot = parentBlockRoot;
      const childBlockRoot = ssz.capella.BeaconBlock.hashTreeRoot(childBlock.message);
      childBlockInput = cache.getByBlock({
        block: childBlock,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      childRootHex = toRootHex(childBlockRoot);
      expect(cache.get(childRootHex)).toBe(childBlockInput);
    });
    it("should remove all BlockInputs in slots before the checkpoint", () => {
      chainEvents.emit(ChainEvent.forkChoiceFinalized, {
        epoch: DENEB_FORK_EPOCH,
        root: Buffer.alloc(32, 0xff),
        rootHex: Buffer.alloc(32, 0xff),
      });
      expect(cache.get(childRootHex)).toBeUndefined();
      expect(cache.get(parentRootHex)).toBeUndefined();
    });
    it("should not remove BlockInputs in slots after the checkpoint", () => {
      chainEvents.emit(ChainEvent.forkChoiceFinalized, {
        epoch: CAPELLA_FORK_EPOCH,
        root: Buffer.alloc(32, 0xff),
        rootHex: Buffer.alloc(32, 0xff),
      });
      expect(cache.get(childRootHex)).toBe(childBlockInput);
      expect(cache.get(parentRootHex)).toBe(parentBlockInput);
    });
  });
  describe("getByBlock()", () => {
    it("should return a new BlockInput for a new block root", () => {
      const block = ssz.capella.SignedBeaconBlock.defaultValue();
      block.message.slot = capellaSlot;
      const blockRoot = ssz.capella.BeaconBlock.hashTreeRoot(block.message);
      expect(cache.get(toRootHex(blockRoot))).toBeUndefined();
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(toRootHex(blockRoot))).toBe(blockInput);
    });
    describe("should return the correct type of BlockInput for a given block root", () => {
      it("should return a BlockInputPreDeneb", () => {
        const block = ssz.capella.SignedBeaconBlock.defaultValue();
        block.message.slot = capellaSlot;
        const blockInput = cache.getByBlock({
          block,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        });
        expect(isBlockInputPreDeneb(blockInput)).toBeTruthy();
      });
      it("should return a BlockInputBlobs", () => {
        const block = ssz.deneb.SignedBeaconBlock.defaultValue();
        block.message.slot = denebSlot;
        const blockInput = cache.getByBlock({
          block,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        });
        expect(isBlockInputBlobs(blockInput)).toBeTruthy();
      });
      // TODO(fulu): need to turn this on once we have custodyConfig available with peerDAS branch
      it.skip("should return a BlockInputColumns", () => {
        const block = ssz.fulu.SignedBeaconBlock.defaultValue();
        block.message.slot = fuluSlot;
        const blockInput = cache.getByBlock({
          block,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        });
        expect(isBlockInputColumns(blockInput)).toBeTruthy();
      });
    });
    it("should return the same BlockInput for an existing block root", () => {
      const block = ssz.capella.SignedBeaconBlock.defaultValue();
      block.message.slot = capellaSlot;
      const blockRoot = ssz.capella.BeaconBlock.hashTreeRoot(block.message);
      const blockInput1 = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(toRootHex(blockRoot))).toBe(blockInput1);
      const blockInput2 = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(blockInput1).toBe(blockInput2);
    });
    it("should not throw for a BlockInput with an existing block", () => {
      const block = ssz.capella.SignedBeaconBlock.defaultValue();
      block.message.slot = capellaSlot;
      const blockRoot = ssz.capella.BeaconBlock.hashTreeRoot(block.message);
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockRootHex = toRootHex(blockRoot);
      expect(() =>
        blockInput.addBlock({
          block,
          blockRootHex,
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
      const block = ssz.deneb.SignedBeaconBlock.defaultValue();
      block.message.slot = denebSlot;
      const signedBlockHeader = signedBlockToSignedHeader(config, block);
      const blobSidecar = ssz.deneb.BlobSidecar.defaultValue();
      blobSidecar.signedBlockHeader = signedBlockHeader;

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
      const block = ssz.electra.SignedBeaconBlock.defaultValue();
      block.message.slot = electraSlot;
      const blockRoot = ssz.electra.BeaconBlock.hashTreeRoot(block.message);
      const signedBlockHeader = signedBlockToSignedHeader(config, block);
      const blobSidecar = ssz.electra.BlobSidecar.defaultValue();
      blobSidecar.signedBlockHeader = signedBlockHeader;

      expect(cache.get(toRootHex(blockRoot))).toBeUndefined();
      const blockInput = cache.getByBlob({
        blobSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(toRootHex(blockRoot))).toBe(blockInput);
    });
    it("should return the same BlockInput for an existing block root", () => {
      const block = ssz.electra.SignedBeaconBlock.defaultValue();
      block.message.slot = electraSlot;
      const blockRoot = ssz.electra.BeaconBlock.hashTreeRoot(block.message);
      const signedBlockHeader = signedBlockToSignedHeader(config, block);
      const blobSidecar = ssz.electra.BlobSidecar.defaultValue();
      blobSidecar.signedBlockHeader = signedBlockHeader;

      const blockInput1 = cache.getByBlob({
        blobSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(toRootHex(blockRoot))).toBe(blockInput1);
      const blockInput2 = cache.getByBlob({
        blobSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(blockInput1).toBe(blockInput2);
    });
    it("should throw if attempting to add a blob to wrong type of BlockInput", () => {
      const block = ssz.capella.SignedBeaconBlock.defaultValue();
      block.message.slot = capellaSlot;
      const blockInput = cache.getByBlock({
        block,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(isBlockInputPreDeneb(blockInput)).toBeTruthy();

      const signedBlockHeader = signedBlockToSignedHeader(config, block);
      const blobSidecar = ssz.deneb.BlobSidecar.defaultValue();
      blobSidecar.signedBlockHeader = signedBlockHeader;

      expect(() =>
        cache.getByBlob({blobSidecar, source: BlockInputSource.gossip, seenTimestampSec: Date.now()})
      ).toThrow();
    });
    it("should add blob to an existing BlockInput", () => {
      const block = ssz.deneb.SignedBeaconBlock.defaultValue();
      block.message.slot = denebSlot;
      const commitment = Buffer.alloc(48, 0x77);
      block.message.body.blobKzgCommitments = [commitment];
      const signedBlockHeader = signedBlockToSignedHeader(config, block);
      const blobSidecar = ssz.deneb.BlobSidecar.defaultValue();
      blobSidecar.signedBlockHeader = signedBlockHeader;
      blobSidecar.kzgCommitment = commitment;

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
      const block = ssz.electra.SignedBeaconBlock.defaultValue();
      block.message.slot = electraSlot;
      const blockRoot = ssz.electra.BeaconBlock.hashTreeRoot(block.message);
      const blockRootHex = toRootHex(blockRoot);
      const signedBlockHeader = signedBlockToSignedHeader(config, block);
      const blobSidecar = ssz.electra.BlobSidecar.defaultValue();
      blobSidecar.signedBlockHeader = signedBlockHeader;

      expect(cache.get(toRootHex(blockRoot))).toBeUndefined();
      const blockInput = cache.getByBlob({
        blobSidecar,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(blockRootHex)).toBe(blockInput);
      expect(() =>
        blockInput.addBlob({
          blobSidecar,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
          blockRootHex,
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
      const block = ssz.electra.SignedBeaconBlock.defaultValue();
      block.message.slot = electraSlot;
      const blockRoot = ssz.electra.BeaconBlock.hashTreeRoot(block.message);
      const blockRootHex = toRootHex(blockRoot);
      const signedBlockHeader = signedBlockToSignedHeader(config, block);
      const blobSidecar = ssz.electra.BlobSidecar.defaultValue();
      blobSidecar.signedBlockHeader = signedBlockHeader;

      expect(cache.get(toRootHex(blockRoot))).toBeUndefined();
      const blockInput = cache.getByBlob(
        {
          blobSidecar,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        },
        {throwGossipErrorIfAlreadyKnown: true}
      );
      expect(cache.get(blockRootHex)).toBe(blockInput);
      expect(() =>
        cache.getByBlob(
          {
            blobSidecar,
            source: BlockInputSource.gossip,
            seenTimestampSec: Date.now(),
          },
          {throwGossipErrorIfAlreadyKnown: true}
        )
      ).toThrow();
    });
  });
});
