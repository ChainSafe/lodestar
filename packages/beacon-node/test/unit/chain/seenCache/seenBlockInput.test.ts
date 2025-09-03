import {generateKeyPair} from "@libp2p/crypto/keys";
import {ForkName, ForkPostFulu} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {SignedBeaconBlock} from "@lodestar/types";
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
import {SeenBlockInput} from "../../../../src/chain/seenCache/seenGossipBlockInput.js";
import {computeNodeIdFromPrivateKey} from "../../../../src/network/subnets/index.js";
import {Clock} from "../../../../src/util/clock.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";
import {
  config,
  generateBlock,
  generateBlockWithBlobSidecars,
  generateChainOfBlocks,
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
        seenTimestampSec: Date.now(),
      });
      expect(cache.has(rootHex)).toBeTruthy();
    });

    it("should return false if not in cache", () => {
      const {block, blockRoot, rootHex} = generateBlock({forkName: ForkName.capella});
      cache.getByBlock({
        block,
        blockRootHex: rootHex,
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
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput);
    });

    it("should return undefined if not in cache", () => {
      const {block, blockRoot, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
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
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
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
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
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
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(parentRootHex)).toBe(parentBlockInput);

      const childBlockInput = cache.getByBlock({
        block: childBlock,
        blockRootHex: childRootHex,
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
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(parentRootHex)).toBe(parentBlockInput);

      childBlockInput = cache.getByBlock({
        block: childBlock,
        blockRootHex: childRootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
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
        seenTimestampSec: Date.now(),
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
          seenTimestampSec: Date.now(),
        });
        expect(isBlockInputPreDeneb(blockInput)).toBeTruthy();
      });

      it("should return a BlockInputBlobs", () => {
        const {block, rootHex} = generateBlock({forkName: ForkName.deneb});
        const blockInput = cache.getByBlock({
          block,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        });
        expect(isBlockInputBlobs(blockInput)).toBeTruthy();
      });

      it("should return a BlockInputColumns", () => {
        const {block, rootHex} = generateBlock({forkName: ForkName.fulu});
        const blockInput = cache.getByBlock({
          block,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        });
        expect(isBlockInputColumns(blockInput)).toBeTruthy();
      });
    });

    it("should return the same BlockInput for an existing block root", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput1 = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput1);
      const blockInput2 = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(blockInput1).toBe(blockInput2);
    });

    it("should not throw for a BlockInput with an existing block", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(() =>
        blockInput.addBlock({
          block: block as SignedBeaconBlock<ForkPostFulu>,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        })
      ).toThrow();
      expect(() =>
        cache.getByBlock({
          block,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        })
      ).not.toThrow();
    });

    it("should return the correct BlockInput for a BlockInput created by blob", () => {
      const {block, blobSidecars, rootHex} = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 1});

      const blockInput1 = cache.getByBlob({
        blobSidecar: blobSidecars[0],
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockInput2 = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });

      expect(blockInput1).toBe(blockInput2);
    });

    it("should return the correct BlockInput for a BlockInput created by column", () => {
      // const {block, columnSidecar} = buildBlockAndBlobTestSet(ForkName.fulu);
      // const blockInput1 = cache.getByColumn({
      //   columnSidecar,
      //   source: BlockInputSource.gossip,
      //   seenTimestampSec: Date.now(),
      // });
      // const blockInput2 = cache.getByBlock({
      //   block,
      //   source: BlockInputSource.gossip,
      //   seenTimestampSec: Date.now(),
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
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput);
    });

    it("should return the same BlockInput for an existing block root", () => {
      const {rootHex, blobSidecars} = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 1});

      const blockInput1 = cache.getByBlob({
        blobSidecar: blobSidecars[0],
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput1);
      const blockInput2 = cache.getByBlob({
        blobSidecar: blobSidecars[0],
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(blockInput1).toBe(blockInput2);
    });

    it("should throw if attempting to add a blob to wrong type of BlockInput", () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.capella});
      const blockInput = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      expect(isBlockInputPreDeneb(blockInput)).toBeTruthy();

      const {blobSidecars} = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 1});
      blobSidecars[0].signedBlockHeader = signedBlockToSignedHeader(config, block);
      expect(() =>
        cache.getByBlob({
          blobSidecar: blobSidecars[0],
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
        })
      ).toThrow();
    });

    it("should add blob to an existing BlockInput", () => {
      const {block, blobSidecars, rootHex} = generateBlockWithBlobSidecars({forkName: ForkName.deneb, count: 1});

      const blockInput1 = cache.getByBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
      });
      const blockInput2 = cache.getByBlob({
        blobSidecar: blobSidecars[0],
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now(),
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
        seenTimestampSec: Date.now(),
      });
      expect(cache.get(rootHex)).toBe(blockInput);
      expect(() =>
        blockInput.addBlob({
          blobSidecar: blobSidecars[0],
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
          blockRootHex: rootHex,
        })
      ).toThrow();
      expect(() =>
        cache.getByBlob({
          blobSidecar: blobSidecars[0],
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now(),
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
          seenTimestampSec: Date.now(),
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
            seenTimestampSec: Date.now(),
          },
          {throwErrorIfAlreadyKnown: true}
        )
      ).toThrow();
    });
  });

  // describe("getByColumn()", () => {
  //   it("should return a new BlockInput for a new block root", () => {
  //     const {rootHex, blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);
  //     expect(cache.get(rootHex)).toBeUndefined();
  //     const blockInput = cache.getByBlob({
  //       blobSidecar,
  //       source: BlockInputSource.gossip,
  //       seenTimestampSec: Date.now(),
  //     });
  //     expect(cache.get(rootHex)).toBe(blockInput);
  //   });
  //   it("should return the same BlockInput for an existing block root", () => {
  //     const {rootHex, blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);

  //     const blockInput1 = cache.getByBlob({
  //       blobSidecar,
  //       source: BlockInputSource.gossip,
  //       seenTimestampSec: Date.now(),
  //     });
  //     expect(cache.get(rootHex)).toBe(blockInput1);
  //     const blockInput2 = cache.getByBlob({
  //       blobSidecar,
  //       source: BlockInputSource.gossip,
  //       seenTimestampSec: Date.now(),
  //     });
  //     expect(blockInput1).toBe(blockInput2);
  //   });
  //   it("should throw if attempting to add a blob to wrong type of BlockInput", () => {
  //     const {block} = buildBlockTestSet(ForkName.capella);
  //     const blockInput = cache.getByBlock({
  //       block,
  //       source: BlockInputSource.gossip,
  //       seenTimestampSec: Date.now(),
  //     });
  //     expect(isBlockInputPreDeneb(blockInput)).toBeTruthy();

  //     const {blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);
  //     blobSidecar.signedBlockHeader = signedBlockToSignedHeader(config, block);
  //     expect(() =>
  //       cache.getByBlob({blobSidecar, source: BlockInputSource.gossip, seenTimestampSec: Date.now()})
  //     ).toThrow();
  //   });
  //   it("should add blob to an existing BlockInput", () => {
  //     const {block, blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);

  //     const blockInput1 = cache.getByBlock({
  //       block,
  //       source: BlockInputSource.gossip,
  //       seenTimestampSec: Date.now(),
  //     });
  //     const blockInput2 = cache.getByBlob({
  //       blobSidecar,
  //       source: BlockInputSource.gossip,
  //       seenTimestampSec: Date.now(),
  //     });

  //     expect(blockInput1).toBe(blockInput2);
  //     expect(blockInput2.getBlobs()[0]).toBe(blobSidecar);
  //   });
  //   it("should not throw for a BlockInput with an existing blob", () => {
  //     const {rootHex, blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);

  //     expect(cache.get(rootHex)).toBeUndefined();
  //     const blockInput = cache.getByBlob({
  //       blobSidecar,
  //       source: BlockInputSource.gossip,
  //       seenTimestampSec: Date.now(),
  //     });
  //     expect(cache.get(rootHex)).toBe(blockInput);
  //     expect(() =>
  //       blockInput.addBlob({
  //         blobSidecar,
  //         source: BlockInputSource.gossip,
  //         seenTimestampSec: Date.now(),
  //         blockRootHex: rootHex,
  //       })
  //     ).toThrow();
  //     expect(() =>
  //       cache.getByBlob({
  //         blobSidecar,
  //         source: BlockInputSource.gossip,
  //         seenTimestampSec: Date.now(),
  //       })
  //     ).not.toThrow();
  //   });
  //   it("should throw for an existing blob with opts.throwGossipErrorIfAlreadyKnown", () => {
  //     const {rootHex, blobSidecar} = buildBlockAndBlobTestSet(ForkName.electra);

  //     expect(cache.get(rootHex)).toBeUndefined();
  //     const blockInput = cache.getByBlob(
  //       {
  //         blobSidecar,
  //         source: BlockInputSource.gossip,
  //         seenTimestampSec: Date.now(),
  //       },
  //       {throwErrorIfAlreadyKnown: true}
  //     );
  //     expect(cache.get(rootHex)).toBe(blockInput);
  //     expect(() =>
  //       cache.getByBlob(
  //         {
  //           blobSidecar,
  //           source: BlockInputSource.gossip,
  //           seenTimestampSec: Date.now(),
  //         },
  //         {throwErrorIfAlreadyKnown: true}
  //       )
  //     ).toThrow();
  //   });
  // });
});
