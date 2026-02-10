import {generateKeyPair} from "@libp2p/crypto/keys";
import {beforeEach, describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  BlockInputEpbs,
  BlockInputSource,
  IBlockInput,
  isBlockInputBlobs,
  isBlockInputColumns,
  isBlockInputEpbs,
  isBlockInputPreDeneb,
} from "../../../../src/chain/blocks/blockInput/index.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SeenBlockInput} from "../../../../src/chain/seenCache/seenGossipBlockInput.js";
import {computeNodeIdFromPrivateKey} from "../../../../src/network/subnets/index.js";
import {Clock} from "../../../../src/util/clock.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";
import {
  config,
  generateBlock,
  generateBlockWithBlobSidecars,
  generateChainOfBlocks,
  slots,
} from "../../../utils/blocksAndData.js";
import {testLogger} from "../../../utils/logger.js";

describe("SeenBlockInputCache", async () => {
  let cache: SeenBlockInput;
  let abortController: AbortController;
  let chainEvents: ChainEventEmitter;

  const privateKey = await generateKeyPair("secp256k1");
  const nodeId = computeNodeIdFromPrivateKey(privateKey);
  const custodyConfig = new CustodyConfig({config, nodeId});
  const logger = testLogger();

  beforeEach(() => {
    chainEvents = new ChainEventEmitter();
    abortController = new AbortController();
    const signal = abortController.signal;
    const genesisTime = Math.floor(Date.now() / 1000);
    cache = new SeenBlockInput({
      config,
      custodyConfig,
      clock: new Clock({config, genesisTime, signal}),
      chainEvents,
      signal,
      logger,
      metrics: null,
    });
  });

  describe("has()", () => {
    it("should return true if in cache", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.has(rootHex)).toBeTruthy();
    });

    it("should return false if not in cache", () => {
      const {block, blockRoot, rootHex} = generateBlock({forkName: ForkName.capella});
      cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
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
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(rootHex)).toBe(blockInput);
    });

    it("should return undefined if not in cache", () => {
      const {block, blockRoot, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
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
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(rootHex)).toBe(blockInput);
      cache.remove(rootHex);
      expect(cache.get(rootHex)).toBeUndefined();
    });

    it("should not throw an error if BlockInput not in cache", () => {
      const {block, blockRoot, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
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
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(rootHex)).toBe(blockInput);
      cache.prune(rootHex);
      expect(cache.get(rootHex)).toBeUndefined();
    });

    it("should remove all ancestors of a BlockInput", () => {
      const blocks = generateChainOfBlocks({forkName: ForkName.capella, count: 2});
      const parentBlock = blocks[0].block;
      const parentRootHex = blocks[0].rootHex;
      const childBlock = blocks[1].block;
      const childRootHex = blocks[1].rootHex;

      const parentBlockInput = cache.getByBlock({
        block: parentBlock,
        blockRootHex: parentRootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(parentRootHex)).toBe(parentBlockInput);

      const childBlockInput = cache.getByBlock({
        block: childBlock,
        blockRootHex: childRootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
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
      const blocks = generateChainOfBlocks({forkName: ForkName.capella, count: 2});
      const parentBlock = blocks[0].block;
      const parentRoot = blocks[0].rootHex;
      const childBlock = blocks[1].block;
      const childRoot = blocks[1].rootHex;
      parentRootHex = parentRoot;
      childRootHex = childRoot;

      parentBlockInput = cache.getByBlock({
        block: parentBlock,
        blockRootHex: parentRootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(parentRootHex)).toBe(parentBlockInput);

      childBlockInput = cache.getByBlock({
        block: childBlock,
        blockRootHex: childRootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(childRootHex)).toBe(childBlockInput);
    });

    it("should remove all BlockInputs in slots before the checkpoint", () => {
      chainEvents.emit(ChainEvent.forkChoiceFinalized, {
        epoch: config.DENEB_FORK_EPOCH,
        root,
        rootHex,
      });
      expect(cache.get(childRootHex)).toBeUndefined();
      expect(cache.get(parentRootHex)).toBeUndefined();
    });

    it("should not remove BlockInputs in slots after the checkpoint", () => {
      chainEvents.emit(ChainEvent.forkChoiceFinalized, {
        epoch: config.CAPELLA_FORK_EPOCH,
        root,
        rootHex,
      });
      expect(cache.get(childRootHex)).toBe(childBlockInput);
      expect(cache.get(parentRootHex)).toBe(parentBlockInput);
    });
  });

  describe("getByBlock()", () => {
    it("should return a new BlockInput for a new block root", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      expect(cache.get(rootHex)).toBeUndefined();
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(rootHex)).toBe(blockInput);
    });

    describe("should return the correct type of BlockInput for a given block root", () => {
      it("should return a BlockInputPreDeneb", () => {
        const {block, rootHex} = generateBlock({forkName: ForkName.capella});
        const blockInput = cache.getByBlock({
          block,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
        expect(isBlockInputPreDeneb(blockInput)).toBeTruthy();
      });

      it("should return a BlockInputBlobs", () => {
        const {block, rootHex} = generateBlock({forkName: ForkName.deneb});
        const blockInput = cache.getByBlock({
          block,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
        expect(isBlockInputBlobs(blockInput)).toBeTruthy();
      });

      it("should return a BlockInputColumns", () => {
        const {block, rootHex} = generateBlock({forkName: ForkName.fulu});
        const blockInput = cache.getByBlock({
          block,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
        expect(isBlockInputColumns(blockInput)).toBeTruthy();
      });

      it("should return a BlockInputEpbs", () => {
        const {block, rootHex} = generateBlock({forkName: ForkName.gloas});
        const blockInput = cache.getByBlock({
          block,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
        expect(isBlockInputEpbs(blockInput)).toBeTruthy();
      });
    });

    it("should return the same BlockInput for an existing block root", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput1 = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(rootHex)).toBe(blockInput1);
      const blockInput2 = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(blockInput1).toBe(blockInput2);
    });

    it("should not throw for a BlockInput with an existing block", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        blockInput.addBlock({
          block: block as any,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).toThrow();
      expect(() =>
        cache.getByBlock({
          block,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).not.toThrow();
    });

    it("should return the correct BlockInput for a BlockInput created by blob", () => {
      const {block, blobSidecars, rootHex} = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 1});

      const blockInput1 = cache.getByBlob({
        blobSidecar: blobSidecars[0],
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      const blockInput2 = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput1).toBe(blockInput2);
    });

    it("should return the correct BlockInput for a BlockInput created by column", () => {
      // const {block, columnSidecar} = buildBlockAndBlobTestSet(ForkName.fulu);
      // const blockInput1 = cache.getByColumn({
      //   columnSidecar,
      //   source: BlockInputSource.gossip,
      //   seenTimestampSec: Date.now() / 1000,
      // });
      // const blockInput2 = cache.getByBlock({
      //   block,
      //   source: BlockInputSource.gossip,
      //   seenTimestampSec: Date.now() / 1000,
      // });
      // expect(blockInput1).toBe(blockInput2);
    });
  });

  describe("getByBlob()", () => {
    it("should return a new BlockInput for a new block root", () => {
      const {rootHex, blobSidecars} = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 1});
      expect(cache.get(rootHex)).toBeUndefined();
      const blockInput = cache.getByBlob({
        blobSidecar: blobSidecars[0],
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(rootHex)).toBe(blockInput);
    });

    it("should return the same BlockInput for an existing block root", () => {
      const {rootHex, blobSidecars} = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 1});

      const blockInput1 = cache.getByBlob({
        blobSidecar: blobSidecars[0],
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(rootHex)).toBe(blockInput1);
      const blockInput2 = cache.getByBlob({
        blobSidecar: blobSidecars[0],
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(blockInput1).toBe(blockInput2);
    });

    it("should throw if attempting to add a blob to wrong type of BlockInput", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(isBlockInputPreDeneb(blockInput)).toBeTruthy();

      const {blobSidecars} = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 1});
      blobSidecars[0].signedBlockHeader = signedBlockToSignedHeader(config, block);
      expect(() =>
        cache.getByBlob({
          blobSidecar: blobSidecars[0],
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).toThrow();
    });

    it("should add blob to an existing BlockInput", () => {
      const {block, blobSidecars, rootHex} = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 1});

      const blockInput1 = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      const blockInput2 = cache.getByBlob({
        blobSidecar: blobSidecars[0],
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput1).toBe(blockInput2);
      expect(blockInput2.getBlobs()[0]).toBe(blobSidecars[0]);
    });

    it("should not throw for a BlockInput with an existing blob", () => {
      const {rootHex, blobSidecars} = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 1});

      expect(cache.get(rootHex)).toBeUndefined();
      const blockInput = cache.getByBlob({
        blobSidecar: blobSidecars[0],
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(rootHex)).toBe(blockInput);
      expect(() =>
        blockInput.addBlob({
          blobSidecar: blobSidecars[0],
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
          blockRootHex: rootHex,
        })
      ).toThrow();
      expect(() =>
        cache.getByBlob({
          blobSidecar: blobSidecars[0],
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).not.toThrow();
    });

    it("should throw for an existing blob with opts.throwGossipErrorIfAlreadyKnown", () => {
      const {rootHex, blobSidecars} = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 1});

      expect(cache.get(rootHex)).toBeUndefined();
      const blockInput = cache.getByBlob(
        {
          blobSidecar: blobSidecars[0],
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        },
        {throwErrorIfAlreadyKnown: true}
      );
      expect(cache.get(rootHex)).toBe(blockInput);
      expect(() =>
        cache.getByBlob(
          {
            blobSidecar: blobSidecars[0],
            blockRootHex: rootHex,
            source: BlockInputSource.gossip,
            seenTimestampSec: Date.now() / 1000,
          },
          {throwErrorIfAlreadyKnown: true}
        )
      ).toThrow();
    });
  });

  // describe("getByColumn()", () => {
  //   ... (commented out Fulu column tests - TODO)
  // });

  describe("getByPayloadEnvelope()", () => {
    function buildGloasPayloadEnvelope(blockRootHex: string): gloas.SignedExecutionPayloadEnvelope {
      const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      envelope.message.beaconBlockRoot = new Uint8Array(Buffer.from(blockRootHex.slice(2), "hex"));
      envelope.message.slot = slots.gloas;
      return envelope;
    }

    it("should create a new BlockInputEpbs for a new block root", () => {
      const {rootHex} = generateBlock({forkName: ForkName.gloas});
      const envelope = buildGloasPayloadEnvelope(rootHex);
      expect(cache.get(rootHex)).toBeUndefined();
      const blockInput = cache.getByPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(cache.get(rootHex)).toBe(blockInput);
      expect(isBlockInputEpbs(blockInput)).toBeTruthy();
      expect(blockInput.hasPayloadEnvelope()).toBeTruthy();
      expect(blockInput.hasBlock()).toBeFalsy();
    });

    it("should return the same BlockInputEpbs for an existing block root", () => {
      const {rootHex} = generateBlock({forkName: ForkName.gloas});
      const envelope = buildGloasPayloadEnvelope(rootHex);

      const blockInput1 = cache.getByPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      const blockInput2 = cache.getByPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput1).toBe(blockInput2);
    });

    it("should add payload to BlockInputEpbs created by getByBlock", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.gloas});
      // Add blob commitments so the block requires payload/columns (payloadAvailable=true)
      (block.message.body as gloas.BeaconBlockBody).signedExecutionPayloadBid.message.blobKzgCommitments = [
        Buffer.alloc(48, 0x01),
      ];
      const blockInput1 = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(isBlockInputEpbs(blockInput1)).toBeTruthy();

      const envelope = buildGloasPayloadEnvelope(rootHex);
      const blockInput2 = cache.getByPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput1).toBe(blockInput2);
      expect((blockInput2 as BlockInputEpbs).hasPayloadEnvelope()).toBeTruthy();
      expect((blockInput2 as BlockInputEpbs).hasBlock()).toBeTruthy();
    });

    it("should add block to BlockInputEpbs created by getByPayloadEnvelope", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.gloas});
      const envelope = buildGloasPayloadEnvelope(rootHex);

      const blockInput1 = cache.getByPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(blockInput1.hasBlock()).toBeFalsy();

      const blockInput2 = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput1).toBe(blockInput2);
      expect(isBlockInputEpbs(blockInput2)).toBeTruthy();
      expect((blockInput2 as BlockInputEpbs).hasBlock()).toBeTruthy();
      expect((blockInput2 as BlockInputEpbs).hasPayloadEnvelope()).toBeTruthy();
    });

    it("should throw if attempting to add payload to wrong type of BlockInput", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      const envelope = buildGloasPayloadEnvelope(rootHex);
      expect(() =>
        cache.getByPayloadEnvelope({
          payloadEnvelope: envelope,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).toThrow();
    });

    it("should throw for existing payload with throwErrorIfAlreadyKnown", () => {
      const {rootHex} = generateBlock({forkName: ForkName.gloas});
      const envelope = buildGloasPayloadEnvelope(rootHex);

      cache.getByPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(() =>
        cache.getByPayloadEnvelope(
          {
            payloadEnvelope: envelope,
            blockRootHex: rootHex,
            source: BlockInputSource.gossip,
            seenTimestampSec: Date.now() / 1000,
          },
          {throwErrorIfAlreadyKnown: true}
        )
      ).toThrow();
    });

    it("should not throw for existing payload without throwErrorIfAlreadyKnown", () => {
      const {rootHex} = generateBlock({forkName: ForkName.gloas});
      const envelope = buildGloasPayloadEnvelope(rootHex);

      cache.getByPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(() =>
        cache.getByPayloadEnvelope({
          payloadEnvelope: envelope,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).not.toThrow();
    });
  });

  describe("getByColumn() Gloas routing", () => {
    function buildGloasColumn(rootHex: string, index: number): gloas.DataColumnSidecar {
      const column = ssz.gloas.DataColumnSidecar.defaultValue();
      column.index = index;
      column.slot = slots.gloas;
      column.beaconBlockRoot = new Uint8Array(Buffer.from(rootHex.slice(2), "hex"));
      // In Gloas, kzgCommitments are on the ExecutionPayloadBid (block body), not the column
      return column;
    }

    it("should create BlockInputEpbs for Gloas column", () => {
      const {rootHex} = generateBlock({forkName: ForkName.gloas});
      const column = buildGloasColumn(rootHex, 0);

      const blockInput = cache.getByColumn({
        columnSidecar: column,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(isBlockInputEpbs(blockInput)).toBeTruthy();
      expect((blockInput as BlockInputEpbs).hasColumn(0)).toBeTruthy();
    });

    it("should return the same BlockInputEpbs for an existing block root", () => {
      const {rootHex} = generateBlock({forkName: ForkName.gloas});
      const col0 = buildGloasColumn(rootHex, 0);
      const col1 = buildGloasColumn(rootHex, 1);

      const blockInput1 = cache.getByColumn({
        columnSidecar: col0,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      const blockInput2 = cache.getByColumn({
        columnSidecar: col1,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput1).toBe(blockInput2);
      expect(isBlockInputEpbs(blockInput2)).toBeTruthy();
      expect((blockInput2 as BlockInputEpbs).hasColumn(0)).toBeTruthy();
      expect((blockInput2 as BlockInputEpbs).hasColumn(1)).toBeTruthy();
    });

    it("should add Gloas column to existing BlockInputEpbs created by getByBlock", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.gloas});
      // Add blob commitments so the block requires payload/columns (payloadAvailable=true)
      (block.message.body as gloas.BeaconBlockBody).signedExecutionPayloadBid.message.blobKzgCommitments = [
        Buffer.alloc(48, 0x01),
      ];
      const blockInput1 = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      const column = buildGloasColumn(rootHex, 0);
      const blockInput2 = cache.getByColumn({
        columnSidecar: column,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput1).toBe(blockInput2);
      expect(isBlockInputEpbs(blockInput2)).toBeTruthy();
      expect((blockInput2 as BlockInputEpbs).hasColumn(0)).toBeTruthy();
    });

    it("should throw if attempting to add Gloas column to wrong type of BlockInput", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      const column = buildGloasColumn(rootHex, 0);
      expect(() =>
        cache.getByColumn({
          columnSidecar: column,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).toThrow();
    });

    it("should not throw for duplicate column without throwErrorIfAlreadyKnown", () => {
      const {rootHex} = generateBlock({forkName: ForkName.gloas});
      const column = buildGloasColumn(rootHex, 0);

      cache.getByColumn({
        columnSidecar: column,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(() =>
        cache.getByColumn({
          columnSidecar: column,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).not.toThrow();
    });

    it("should throw for duplicate column with throwErrorIfAlreadyKnown", () => {
      const {rootHex} = generateBlock({forkName: ForkName.gloas});
      const column = buildGloasColumn(rootHex, 0);

      cache.getByColumn(
        {
          columnSidecar: column,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        },
        {throwErrorIfAlreadyKnown: true}
      );

      expect(() =>
        cache.getByColumn(
          {
            columnSidecar: column,
            blockRootHex: rootHex,
            source: BlockInputSource.gossip,
            seenTimestampSec: Date.now() / 1000,
          },
          {throwErrorIfAlreadyKnown: true}
        )
      ).toThrow();
    });
  });
});
