import {describe, expect, it} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName, ForkPostCapella, ForkPostDeneb, ForkPreGloas, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {computeStartSlotAtEpoch, signedBlockToSignedHeader} from "@lodestar/state-transition";
import {BeaconBlockBody, SignedBeaconBlock, deneb, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  AddBlob,
  AddBlock,
  BlockInputBlobs,
  BlockInputColumns,
  BlockInputSource,
  CreateBlockInputMeta,
  ForkBlobsDA,
} from "../../../../src/chain/blocks/blockInput/index.js";

const CAPELLA_FORK_EPOCH = 0;
const DENEB_FORK_EPOCH = 1;
const ELECTRA_FORK_EPOCH = 2;
const FULU_FORK_EPOCH = 3;
const GLOAS_FORK_EPOCH = 4;
const HEZE_FORK_EPOCH = 5;
const config = createChainForkConfig({
  ...defaultChainConfig,
  CAPELLA_FORK_EPOCH,
  DENEB_FORK_EPOCH,
  ELECTRA_FORK_EPOCH,
  FULU_FORK_EPOCH,
  GLOAS_FORK_EPOCH,
  HEZE_FORK_EPOCH,
});

const slots: Record<ForkPostCapella, number> = {
  capella: computeStartSlotAtEpoch(CAPELLA_FORK_EPOCH),
  deneb: computeStartSlotAtEpoch(DENEB_FORK_EPOCH),
  electra: computeStartSlotAtEpoch(ELECTRA_FORK_EPOCH),
  fulu: computeStartSlotAtEpoch(FULU_FORK_EPOCH),
  gloas: computeStartSlotAtEpoch(GLOAS_FORK_EPOCH),
  heze: computeStartSlotAtEpoch(HEZE_FORK_EPOCH),
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

type BlockAndBlobTestSet<F extends ForkPostDeneb = ForkPostDeneb> = BlockTestSet<F> & {
  blobSidecars: deneb.BlobSidecars;
};
function buildBlockAndBlobsTestSet(forkName: ForkPostDeneb, numberOfBlobs: number): BlockAndBlobTestSet<ForkPostDeneb> {
  const {block, blockRoot, rootHex} = buildBlockTestSet<ForkPostDeneb>(forkName);
  const commitments = Array.from({length: numberOfBlobs}, () => Buffer.alloc(48, 0x77));
  (block.message.body as BeaconBlockBody<ForkPostDeneb & ForkPreGloas>).blobKzgCommitments = commitments;
  const signedBlockHeader = signedBlockToSignedHeader(config, block);
  const blobSidecars: deneb.BlobSidecars = [];
  for (const kzgCommitment of commitments) {
    const blobSidecar = ssz[forkName].BlobSidecar.defaultValue();
    blobSidecar.index = blobSidecars.length;
    blobSidecar.signedBlockHeader = signedBlockHeader;
    blobSidecar.kzgCommitment = kzgCommitment;
    blobSidecars.push(blobSidecar);
  }

  return {
    block,
    blockRoot,
    rootHex,
    blobSidecars,
  };
}

const testCases: {name: string; blobCount: number; blobsBeforeBlock: number}[] = [
  {
    name: "no blobs",
    blobCount: 0,
    blobsBeforeBlock: 0,
  },
  {
    name: "1 blob, block first",
    blobCount: 1,
    blobsBeforeBlock: 0,
  },
  {
    name: "1 blob, blob first",
    blobCount: 1,
    blobsBeforeBlock: 1,
  },
  {
    name: "6 blobs, block first",
    blobCount: 6,
    blobsBeforeBlock: 0,
  },
  {
    name: "4 blobs, block in middle",
    blobCount: 4,
    blobsBeforeBlock: 2,
  },
  {
    name: "3 blobs, block in end",
    blobCount: 3,
    blobsBeforeBlock: 3,
  },
];

type TestCaseArray = (AddBlock<ForkBlobsDA> | AddBlob) & CreateBlockInputMeta;

describe("BlockInput", () => {
  describe("Blob timing", () => {
    for (const {name, blobCount, blobsBeforeBlock} of testCases) {
      it(name, () => {
        const {block, rootHex, blobSidecars} = buildBlockAndBlobsTestSet(ForkName.deneb, blobCount);
        const firstSeenTimestampSec = 1000;
        const testArray: TestCaseArray[] = [];
        for (let i = 0; i < blobsBeforeBlock; i++) {
          const blobSidecar = blobSidecars.shift();
          if (!blobSidecar) throw new Error("must have blobSidecar to add to TestCaseArray");
          testArray.push({
            blobSidecar,
            blockRootHex: rootHex,
            daOutOfRange: false,
            forkName: ForkName.deneb,
            seenTimestampSec: firstSeenTimestampSec + testArray.length,
            source: BlockInputSource.gossip,
          } as AddBlob & CreateBlockInputMeta);
        }
        testArray.push({
          block,
          blockRootHex: rootHex,
          daOutOfRange: false,
          forkName: ForkName.deneb,
          source: BlockInputSource.gossip,
          seenTimestampSec: firstSeenTimestampSec + testArray.length,
        } as AddBlock<ForkBlobsDA> & CreateBlockInputMeta);
        for (const blobSidecar of blobSidecars) {
          testArray.push({
            blobSidecar,
            blockRootHex: rootHex,
            daOutOfRange: false,
            forkName: ForkName.deneb,
            seenTimestampSec: firstSeenTimestampSec + testArray.length,
            source: BlockInputSource.gossip,
          } as AddBlob & CreateBlockInputMeta);
        }
        const lastSeenTimestampSec = firstSeenTimestampSec + testArray.length - 1;

        let blockInput: BlockInputBlobs;
        let testCaseEntry = testArray.shift();
        if (!testCaseEntry) throw new Error("undefined testCaseEntry state. debug unit test");
        if ("block" in testCaseEntry) {
          blockInput = BlockInputBlobs.createFromBlock(testCaseEntry);
          expect(blockInput.hasBlock()).toBeTruthy();
          expect(blockInput.hasBlob(0)).toBeFalsy();
          if (blobCount === 0) {
            expect(blockInput.hasAllData()).toBeTruthy();
          } else {
            expect(blockInput.hasAllData()).toBeFalsy();
          }
        } else {
          blockInput = BlockInputBlobs.createFromBlob(testCaseEntry as AddBlob & CreateBlockInputMeta);
          expect(blockInput.hasBlock()).toBeFalsy();
          expect(blockInput.hasBlob(0)).toBeTruthy();
          // expect falsy here because block/blobCount not known yet
          expect(blockInput.hasAllData()).toBeFalsy();
        }

        for (testCaseEntry of testArray) {
          if ("block" in testCaseEntry) {
            expect(blockInput.hasBlock()).toBeFalsy();
            blockInput.addBlock(testCaseEntry);
            expect(blockInput.hasBlock()).toBeTruthy();
          } else {
            expect(blockInput.hasAllData()).toBeFalsy();
            expect(blockInput.hasBlob(testCaseEntry.blobSidecar.index)).toBeFalsy();
            blockInput.addBlob(testCaseEntry as AddBlob);
            expect(blockInput.hasBlob(testCaseEntry.blobSidecar.index)).toBeTruthy();
          }
        }
        expect(blockInput.hasAllData()).toBeTruthy();
        expect(blockInput.getTimeComplete()).toBe(lastSeenTimestampSec);
      });
    }
  });

  describe("Column timing", () => {
    const firstSeenTimestampSec = 1000;

    function buildColumnsBlockInput(sampledColumns: number[]): {blockInput: BlockInputColumns; rootHex: string} {
      const {block, rootHex} = buildBlockTestSet(ForkName.fulu);
      block.message.body.blobKzgCommitments = [Buffer.alloc(48, 0x77)];
      const blockInput = BlockInputColumns.createFromBlock({
        block,
        blockRootHex: rootHex,
        daOutOfRange: false,
        forkName: ForkName.fulu,
        source: BlockInputSource.gossip,
        seenTimestampSec: firstSeenTimestampSec,
        sampledColumns,
        custodyColumns: sampledColumns,
      });
      return {blockInput, rootHex};
    }

    function addColumn(blockInput: BlockInputColumns, rootHex: string, index: number): void {
      const columnSidecar = ssz.fulu.DataColumnSidecar.defaultValue();
      columnSidecar.index = index;
      blockInput.addColumn({
        columnSidecar,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: firstSeenTimestampSec + 1 + index,
      });
    }

    it("completes when the last sampled column is seen", () => {
      const sampledColumns = [0, 1, 2, 3];
      const {blockInput, rootHex} = buildColumnsBlockInput(sampledColumns);
      for (const index of sampledColumns) {
        expect(blockInput.hasAllData()).toBeFalsy();
        addColumn(blockInput, rootHex, index);
      }
      expect(blockInput.hasAllData()).toBeTruthy();
      expect(blockInput.getTimeComplete()).toBe(firstSeenTimestampSec + 1 + 3);
    });

    it("keeps the completion time when more columns are seen after the reconstruction threshold", () => {
      const sampledColumns = Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i);
      const {blockInput, rootHex} = buildColumnsBlockInput(sampledColumns);
      const lastIndexToComplete = NUMBER_OF_COLUMNS / 2 - 1;
      for (let index = 0; index <= lastIndexToComplete; index++) {
        addColumn(blockInput, rootHex, index);
      }
      expect(blockInput.hasAllData()).toBeTruthy();
      expect(blockInput.hasComputedAllData()).toBeFalsy();
      expect(blockInput.getTimeComplete()).toBe(firstSeenTimestampSec + 1 + lastIndexToComplete);

      addColumn(blockInput, rootHex, lastIndexToComplete + 1);
      expect(blockInput.getTimeComplete()).toBe(firstSeenTimestampSec + 1 + lastIndexToComplete);
    });
  });
});
