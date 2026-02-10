import {describe, expect, it} from "vitest";
import {ForkName, ForkPostGloas} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {SignedBeaconBlock, gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputErrorCode} from "../../../../src/chain/blocks/blockInput/errors.js";
import {
  AddBlock,
  AddColumn,
  AddPayloadEnvelope,
  BlockInputEpbs,
  BlockInputSource,
  ColumnConfig,
  CreateBlockInputMeta,
  DAType,
  isBlockInputEpbs,
} from "../../../../src/chain/blocks/blockInput/index.js";

const GLOAS_FORK_EPOCH = 4;
const gloasSlot = computeStartSlotAtEpoch(GLOAS_FORK_EPOCH);

// --- Test helpers ---

function buildGloasBlock(numCommitments = 2): {
  block: SignedBeaconBlock<ForkPostGloas>;
  blockRoot: Uint8Array;
  rootHex: string;
} {
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = gloasSlot;
  // In Gloas, blobKzgCommitments are on the ExecutionPayloadBid (in the block body)
  const commitments = Array.from({length: numCommitments}, (_, i) => {
    const buf = Buffer.alloc(48, 0);
    buf[0] = i + 1;
    return buf;
  });
  block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = commitments;
  const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
  return {block, blockRoot, rootHex: toRootHex(blockRoot)};
}

function buildPayloadEnvelope(blockRootHex: string): gloas.SignedExecutionPayloadEnvelope {
  const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  envelope.message.beaconBlockRoot = new Uint8Array(Buffer.from(blockRootHex.slice(2), "hex"));
  envelope.message.slot = gloasSlot;
  // In Gloas, blobKzgCommitments are on the ExecutionPayloadBid (block body), not the envelope
  return envelope;
}

function buildGloasColumn(index: number): gloas.DataColumnSidecar {
  const column = ssz.gloas.DataColumnSidecar.defaultValue();
  column.index = index;
  column.slot = gloasSlot;
  // In Gloas, kzgCommitments are on the ExecutionPayloadBid (block body), not the column
  return column;
}

function blockProps(
  rootHex: string,
  block: SignedBeaconBlock<ForkPostGloas>
): AddBlock<ForkPostGloas> & CreateBlockInputMeta & ColumnConfig {
  return {
    block,
    blockRootHex: rootHex,
    daOutOfRange: false,
    forkName: ForkName.gloas,
    source: BlockInputSource.gossip,
    seenTimestampSec: Date.now() / 1000,
    sampledColumns: [0, 1, 2, 3],
    custodyColumns: [0, 1, 2, 3, 4, 5, 6, 7],
  };
}

function payloadProps(
  rootHex: string,
  envelope: gloas.SignedExecutionPayloadEnvelope
): AddPayloadEnvelope & CreateBlockInputMeta & ColumnConfig {
  return {
    payloadEnvelope: envelope,
    blockRootHex: rootHex,
    daOutOfRange: false,
    forkName: ForkName.gloas,
    source: BlockInputSource.gossip,
    seenTimestampSec: Date.now() / 1000,
    sampledColumns: [0, 1, 2, 3],
    custodyColumns: [0, 1, 2, 3, 4, 5, 6, 7],
  };
}

function columnProps(
  rootHex: string,
  column: gloas.DataColumnSidecar
): AddColumn & CreateBlockInputMeta & ColumnConfig {
  return {
    columnSidecar: column,
    blockRootHex: rootHex,
    daOutOfRange: false,
    forkName: ForkName.gloas,
    source: BlockInputSource.gossip,
    seenTimestampSec: Date.now() / 1000,
    sampledColumns: [0, 1, 2, 3],
    custodyColumns: [0, 1, 2, 3, 4, 5, 6, 7],
  };
}

describe("BlockInputEpbs", () => {
  describe("type guard", () => {
    it("isBlockInputEpbs returns true for BlockInputEpbs", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));
      expect(isBlockInputEpbs(blockInput)).toBe(true);
    });

    it("has correct DAType", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));
      expect(blockInput.type).toBe(DAType.Epbs);
    });
  });

  describe("createFromBlock", () => {
    it("creates with block, hasBlock=true, hasAllData=false", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      expect(blockInput.hasBlock()).toBe(true);
      expect(blockInput.hasAllData()).toBe(false);
      expect(blockInput.hasBlockAndAllData()).toBe(false);
      expect(blockInput.hasPayloadEnvelope()).toBe(false);
      expect(blockInput.slot).toBe(gloasSlot);
      expect(blockInput.forkName).toBe(ForkName.gloas);
      expect(blockInput.blockRootHex).toBe(rootHex);
    });

    it("hasAllData=true when daOutOfRange", () => {
      const {block, rootHex} = buildGloasBlock();
      const props = blockProps(rootHex, block);
      props.daOutOfRange = true;
      const blockInput = BlockInputEpbs.createFromBlock(props);

      expect(blockInput.hasBlock()).toBe(true);
      expect(blockInput.hasAllData()).toBe(true);
      expect(blockInput.hasBlockAndAllData()).toBe(true);
    });

    it("hasAllData=true when no sampled columns", () => {
      const {block, rootHex} = buildGloasBlock();
      const props = blockProps(rootHex, block);
      props.sampledColumns = [];
      const blockInput = BlockInputEpbs.createFromBlock(props);

      expect(blockInput.hasBlock()).toBe(true);
      expect(blockInput.hasAllData()).toBe(true);
    });

    it("hasAllData=true when no blobs (0 commitments in bid)", () => {
      const {block, rootHex} = buildGloasBlock(0);
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      expect(blockInput.hasBlock()).toBe(true);
      expect(blockInput.hasAllData()).toBe(true);
      expect(blockInput.hasBlockAndAllData()).toBe(true);
      expect(blockInput.getVersionedHashes().length).toBe(0);
    });
  });

  describe("createFromPayload", () => {
    it("creates with payload, hasBlock=false", () => {
      const {rootHex} = buildGloasBlock();
      const envelope = buildPayloadEnvelope(rootHex);
      const blockInput = BlockInputEpbs.createFromPayload(payloadProps(rootHex, envelope));

      expect(blockInput.hasBlock()).toBe(false);
      expect(blockInput.hasPayloadEnvelope()).toBe(true);
      expect(blockInput.hasAllData()).toBe(false); // Still needs columns
      expect(blockInput.slot).toBe(gloasSlot);
    });

    it("hasAllData=true when daOutOfRange", () => {
      const {rootHex} = buildGloasBlock();
      const envelope = buildPayloadEnvelope(rootHex);
      const props = payloadProps(rootHex, envelope);
      props.daOutOfRange = true;
      const blockInput = BlockInputEpbs.createFromPayload(props);

      expect(blockInput.hasPayloadEnvelope()).toBe(true);
      expect(blockInput.hasAllData()).toBe(true);
    });
  });

  describe("createFromColumn", () => {
    it("creates with single column, hasBlock=false, hasAllData=false", () => {
      const {rootHex} = buildGloasBlock();
      const column = buildGloasColumn(0);
      const blockInput = BlockInputEpbs.createFromColumn(columnProps(rootHex, column));

      expect(blockInput.hasBlock()).toBe(false);
      expect(blockInput.hasAllData()).toBe(false);
      expect(blockInput.hasPayloadEnvelope()).toBe(false);
      expect(blockInput.columnCount).toBe(1);
      expect(blockInput.hasColumn(0)).toBe(true);
      expect(blockInput.hasColumn(1)).toBe(false);
    });
  });

  describe("Scenario A: Block -> Payload -> Columns", () => {
    it("completes when all sampled columns arrive after block and payload", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      // Step 1: Block arrives
      expect(blockInput.hasBlock()).toBe(true);
      expect(blockInput.hasAllData()).toBe(false);

      // Step 2: Payload arrives
      const envelope = buildPayloadEnvelope(rootHex);
      blockInput.addPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      expect(blockInput.hasPayloadEnvelope()).toBe(true);
      expect(blockInput.hasAllData()).toBe(false); // Still needs columns

      // Step 3: Columns arrive (sampled: [0, 1, 2, 3])
      for (let i = 0; i < 3; i++) {
        const col = buildGloasColumn(i);
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
        expect(blockInput.hasAllData()).toBe(false);
      }
      // Last sampled column
      const lastCol = buildGloasColumn(3);
      blockInput.addColumn({
        columnSidecar: lastCol,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput.hasAllData()).toBe(true);
      expect(blockInput.hasBlockAndAllData()).toBe(true);
    });
  });

  describe("Scenario B: Block -> Columns -> Payload", () => {
    it("completes when payload arrives after block and all columns", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      // Columns arrive first (all sampled)
      for (let i = 0; i < 4; i++) {
        const col = buildGloasColumn(i);
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
      }
      expect(blockInput.hasAllData()).toBe(false); // Still needs payload

      // Payload arrives last
      const envelope = buildPayloadEnvelope(rootHex);
      blockInput.addPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput.hasAllData()).toBe(true);
      expect(blockInput.hasBlockAndAllData()).toBe(true);
    });
  });

  describe("Scenario C: Payload + Columns -> Block", () => {
    it("completes when block arrives after payload and all columns", () => {
      const {block, rootHex} = buildGloasBlock();

      // Start from payload
      const envelope = buildPayloadEnvelope(rootHex);
      const blockInput = BlockInputEpbs.createFromPayload(payloadProps(rootHex, envelope));

      expect(blockInput.hasBlock()).toBe(false);
      expect(blockInput.hasPayloadEnvelope()).toBe(true);

      // Add all sampled columns
      for (let i = 0; i < 4; i++) {
        const col = buildGloasColumn(i);
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
      }
      expect(blockInput.hasAllData()).toBe(true);
      expect(blockInput.hasBlockAndAllData()).toBe(false); // No block yet

      // Block arrives
      blockInput.addBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput.hasBlock()).toBe(true);
      expect(blockInput.hasBlockAndAllData()).toBe(true);
    });
  });

  describe("Scenario D: Builder non-reveal", () => {
    it("completes when markPayloadUnavailable is called", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      expect(blockInput.hasBlock()).toBe(true);
      expect(blockInput.hasAllData()).toBe(false);

      blockInput.markPayloadUnavailable();

      expect(blockInput.hasAllData()).toBe(true);
      expect(blockInput.hasBlockAndAllData()).toBe(true);
      expect(blockInput.hasPayloadEnvelope()).toBe(false);
    });

    it("markPayloadUnavailable is idempotent", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      blockInput.markPayloadUnavailable();
      blockInput.markPayloadUnavailable(); // Should not throw

      expect(blockInput.hasAllData()).toBe(true);
    });
  });

  describe("Promise resolution", () => {
    it("blockPromise resolves when block is available at creation", async () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      const resolved = await blockInput.waitForBlock(1000);
      expect(resolved.message.slot).toBe(gloasSlot);
    });

    it("blockPromise resolves when block is added later", async () => {
      const {block, rootHex} = buildGloasBlock();
      const envelope = buildPayloadEnvelope(rootHex);
      const blockInput = BlockInputEpbs.createFromPayload(payloadProps(rootHex, envelope));

      // Add block
      blockInput.addBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      const resolved = await blockInput.waitForBlock(1000);
      expect(resolved.message.slot).toBe(gloasSlot);
    });

    it("dataPromise resolves with payload data when complete", async () => {
      const {block, rootHex} = buildGloasBlock();
      const props = blockProps(rootHex, block);
      props.sampledColumns = [0]; // Only need 1 column
      const blockInput = BlockInputEpbs.createFromBlock(props);

      // Add payload
      const envelope = buildPayloadEnvelope(rootHex);
      blockInput.addPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      // Add the one sampled column
      const col = buildGloasColumn(0);
      blockInput.addColumn({
        columnSidecar: col,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      const data = await blockInput.waitForAllData(1000);
      expect(data).not.toBeNull();
      expect(data?.payloadEnvelope).toBeDefined();
      expect(data?.columns).toBeDefined();
    });

    it("dataPromise resolves with null on markPayloadUnavailable", async () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      blockInput.markPayloadUnavailable();

      const data = await blockInput.waitForAllData(1000);
      expect(data).toBeNull();
    });

    it("dataPromise resolves with null when daOutOfRange", async () => {
      const {block, rootHex} = buildGloasBlock();
      const props = blockProps(rootHex, block);
      props.daOutOfRange = true;
      const blockInput = BlockInputEpbs.createFromBlock(props);

      const data = await blockInput.waitForAllData(1000);
      expect(data).toBeNull();
    });

    it("waitForBlockAndAllData resolves when both available", async () => {
      const {block, rootHex} = buildGloasBlock();
      const props = blockProps(rootHex, block);
      props.sampledColumns = []; // No columns needed
      props.daOutOfRange = true;
      const blockInput = BlockInputEpbs.createFromBlock(props);

      const resolved = await blockInput.waitForBlockAndAllData(1000);
      expect(resolved.hasBlock()).toBe(true);
      expect(resolved.hasAllData()).toBe(true);
    });
  });

  describe("getBlock and getBlockSource", () => {
    it("getBlock returns the block when available", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      const retrievedBlock = blockInput.getBlock();
      expect(retrievedBlock.message.slot).toBe(gloasSlot);
    });

    it("getBlock throws when block not available", () => {
      const {rootHex} = buildGloasBlock();
      const envelope = buildPayloadEnvelope(rootHex);
      const blockInput = BlockInputEpbs.createFromPayload(payloadProps(rootHex, envelope));

      expect(() => blockInput.getBlock()).toThrow();
    });

    it("getBlockSource returns source metadata", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      const source = blockInput.getBlockSource();
      expect(source.source).toBe(BlockInputSource.gossip);
    });
  });

  describe("getPayloadEnvelope", () => {
    it("returns payload when available", () => {
      const {rootHex} = buildGloasBlock();
      const envelope = buildPayloadEnvelope(rootHex);
      const blockInput = BlockInputEpbs.createFromPayload(payloadProps(rootHex, envelope));

      expect(blockInput.getPayloadEnvelope()).toBeDefined();
      expect(blockInput.getPayloadEnvelope().message.slot).toBe(gloasSlot);
    });

    it("throws when payload not available", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      expect(() => blockInput.getPayloadEnvelope()).toThrow();
    });

    it("getPayloadEnvelopeOrNull returns null when not available", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      expect(blockInput.getPayloadEnvelopeOrNull()).toBeNull();
    });
  });

  describe("getTimeComplete", () => {
    it("returns time when complete", () => {
      const {block, rootHex} = buildGloasBlock();
      const props = blockProps(rootHex, block);
      props.daOutOfRange = true;
      const blockInput = BlockInputEpbs.createFromBlock(props);

      expect(blockInput.getTimeComplete()).toBeGreaterThan(0);
    });

    it("throws when not complete", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      expect(() => blockInput.getTimeComplete()).toThrow();
    });
  });

  describe("Column methods", () => {
    it("hasColumn tracks individual columns", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      expect(blockInput.hasColumn(0)).toBe(false);

      const col = buildGloasColumn(0);
      blockInput.addColumn({
        columnSidecar: col,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput.hasColumn(0)).toBe(true);
      expect(blockInput.hasColumn(1)).toBe(false);
      expect(blockInput.columnCount).toBe(1);
    });

    it("getSampledColumns returns only sampled columns", () => {
      const {block, rootHex} = buildGloasBlock();
      const props = blockProps(rootHex, block);
      props.sampledColumns = [0, 2]; // Only sample columns 0 and 2
      const blockInput = BlockInputEpbs.createFromBlock(props);

      // Add columns 0, 1, 2, 3
      for (let i = 0; i < 4; i++) {
        const col = buildGloasColumn(i);
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
      }

      const sampled = blockInput.getSampledColumns();
      expect(sampled.length).toBe(2);
      expect(sampled[0].index).toBe(0);
      expect(sampled[1].index).toBe(2);
    });

    it("getCustodyColumns returns custody columns", () => {
      const {block, rootHex} = buildGloasBlock();
      const props = blockProps(rootHex, block);
      props.custodyColumns = [0, 1];
      const blockInput = BlockInputEpbs.createFromBlock(props);

      const col0 = buildGloasColumn(0);
      const col1 = buildGloasColumn(1);
      blockInput.addColumn({
        columnSidecar: col0,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });
      blockInput.addColumn({
        columnSidecar: col1,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      const custody = blockInput.getCustodyColumns();
      expect(custody.length).toBe(2);
    });

    it("getAllColumns returns all cached columns", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      for (let i = 0; i < 3; i++) {
        const col = buildGloasColumn(i);
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
      }

      expect(blockInput.getAllColumns().length).toBe(3);
      expect(blockInput.getAllColumnsWithSource().length).toBe(3);
    });

    it("getMissingSampledColumnMeta returns missing columns", () => {
      const {block, rootHex} = buildGloasBlock();
      const props = blockProps(rootHex, block);
      props.sampledColumns = [0, 1, 2, 3];
      const blockInput = BlockInputEpbs.createFromBlock(props);

      // Add columns 0 and 2
      for (const idx of [0, 2]) {
        const col = buildGloasColumn(idx);
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
      }

      const missing = blockInput.getMissingSampledColumnMeta();
      expect(missing.missing).toEqual([1, 3]);
    });

    it("getMissingSampledColumnMeta returns empty when complete", () => {
      const {block, rootHex} = buildGloasBlock();
      const props = blockProps(rootHex, block);
      props.daOutOfRange = true;
      const blockInput = BlockInputEpbs.createFromBlock(props);

      const missing = blockInput.getMissingSampledColumnMeta();
      expect(missing.missing).toEqual([]);
    });
  });

  describe("getLogMeta", () => {
    it("returns correct metadata", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      const meta = blockInput.getLogMeta();
      expect(meta.slot).toBe(gloasSlot);
      expect(meta.hasPayload).toBe(false);
      expect(meta.payloadAvailable).toBe(true);
      expect(meta.expectedColumns).toBe(4);
      expect(meta.receivedColumns).toBe(0);
    });
  });

  describe("Validation errors", () => {
    it("addBlock throws on mismatched root hex", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      const wrongRoot = "0x" + "ff".repeat(32);
      expect(() =>
        blockInput.addBlock({
          block,
          blockRootHex: wrongRoot,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).toThrow();
    });

    it("addBlock throws on duplicate block with throwOnDuplicateAdd=true", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      expect(() =>
        blockInput.addBlock(
          {
            block,
            blockRootHex: rootHex,
            source: BlockInputSource.gossip,
            seenTimestampSec: Date.now() / 1000,
          },
          {throwOnDuplicateAdd: true}
        )
      ).toThrow();
    });

    it("addBlock returns silently on duplicate with throwOnDuplicateAdd=false", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      expect(() =>
        blockInput.addBlock(
          {
            block,
            blockRootHex: rootHex,
            source: BlockInputSource.gossip,
            seenTimestampSec: Date.now() / 1000,
          },
          {throwOnDuplicateAdd: false}
        )
      ).not.toThrow();
    });

    it("addPayloadEnvelope throws on mismatched root hex", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      const envelope = buildPayloadEnvelope(rootHex);
      const wrongRoot = "0x" + "ff".repeat(32);
      expect(() =>
        blockInput.addPayloadEnvelope({
          payloadEnvelope: envelope,
          blockRootHex: wrongRoot,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).toThrow();
    });

    it("addPayloadEnvelope throws on mismatched beacon_block_root", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      // Create envelope with wrong beaconBlockRoot
      const wrongBlockRoot = "0x" + "aa".repeat(32);
      const envelope = buildPayloadEnvelope(wrongBlockRoot);
      try {
        blockInput.addPayloadEnvelope({
          payloadEnvelope: envelope,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
        expect.fail("Should have thrown");
      } catch (e: unknown) {
        expect((e as {type: {code: string}}).type.code).toBe(BlockInputErrorCode.MISMATCHED_ROOT_HEX);
      }
    });

    it("addPayloadEnvelope throws on duplicate payload", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      const envelope = buildPayloadEnvelope(rootHex);
      blockInput.addPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(() =>
        blockInput.addPayloadEnvelope({
          payloadEnvelope: envelope,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).toThrow();
    });

    it("addPayloadEnvelope throws after markPayloadUnavailable", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));
      blockInput.markPayloadUnavailable();

      const envelope = buildPayloadEnvelope(rootHex);
      try {
        blockInput.addPayloadEnvelope({
          payloadEnvelope: envelope,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
        expect.fail("Should have thrown");
      } catch (e: unknown) {
        expect((e as {type: {code: string}}).type.code).toBe(BlockInputErrorCode.PAYLOAD_UNAVAILABLE_MARKED);
      }
    });

    it("addColumn throws on mismatched root hex", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      const col = buildGloasColumn(0);
      const wrongRoot = "0x" + "ff".repeat(32);
      expect(() =>
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: wrongRoot,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).toThrow();
    });

    it("addColumn throws on duplicate column", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      const col = buildGloasColumn(0);
      blockInput.addColumn({
        columnSidecar: col,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(() =>
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        })
      ).toThrow();
    });

    it("addColumn does not throw on duplicate with throwOnDuplicateAdd=false", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      const col = buildGloasColumn(0);
      blockInput.addColumn({
        columnSidecar: col,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(() =>
        blockInput.addColumn(
          {
            columnSidecar: col,
            blockRootHex: rootHex,
            source: BlockInputSource.gossip,
            seenTimestampSec: Date.now() / 1000,
          },
          {throwOnDuplicateAdd: false}
        )
      ).not.toThrow();
    });

    it("addColumn throws after markPayloadUnavailable", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));
      blockInput.markPayloadUnavailable();

      const col = buildGloasColumn(0);
      try {
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
        expect.fail("Should have thrown");
      } catch (e: unknown) {
        expect((e as {type: {code: string}}).type.code).toBe(BlockInputErrorCode.PAYLOAD_UNAVAILABLE_MARKED);
      }
    });
  });

  describe("Incremental column arrival", () => {
    it("tracks column count correctly as columns arrive", () => {
      const {block, rootHex} = buildGloasBlock();
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      expect(blockInput.columnCount).toBe(0);

      for (let i = 0; i < 4; i++) {
        const col = buildGloasColumn(i);
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
        expect(blockInput.columnCount).toBe(i + 1);
      }
    });

    it("non-sampled columns don't trigger completion", () => {
      const {block, rootHex} = buildGloasBlock();
      const props = blockProps(rootHex, block);
      props.sampledColumns = [0, 1]; // Only sample 0 and 1
      const blockInput = BlockInputEpbs.createFromBlock(props);

      // Add payload
      const envelope = buildPayloadEnvelope(rootHex);
      blockInput.addPayloadEnvelope({
        payloadEnvelope: envelope,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      // Add non-sampled columns (2, 3) - should not complete
      for (const idx of [2, 3]) {
        const col = buildGloasColumn(idx);
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
      }
      expect(blockInput.hasAllData()).toBe(false);

      // Add sampled columns (0, 1) - should complete
      for (const idx of [0, 1]) {
        const col = buildGloasColumn(idx);
        blockInput.addColumn({
          columnSidecar: col,
          blockRootHex: rootHex,
          source: BlockInputSource.gossip,
          seenTimestampSec: Date.now() / 1000,
        });
      }
      expect(blockInput.hasAllData()).toBe(true);
    });
  });

  describe("Column-first scenarios", () => {
    it("columns arrive before block, then block arrives", () => {
      const {block, rootHex} = buildGloasBlock();
      const col = buildGloasColumn(0);
      const blockInput = BlockInputEpbs.createFromColumn(columnProps(rootHex, col));

      expect(blockInput.hasBlock()).toBe(false);
      expect(blockInput.hasColumn(0)).toBe(true);

      // Add block
      blockInput.addBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      expect(blockInput.hasBlock()).toBe(true);
    });
  });

  describe("getVersionedHashes", () => {
    it("returns hashes from block's bid commitments", () => {
      const {block, rootHex} = buildGloasBlock(3);
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      // In Gloas, versionedHashes are derived from the bid's blobKzgCommitments at block creation
      expect(blockInput.getVersionedHashes().length).toBe(3);
    });

    it("returns empty when block has no commitments", () => {
      const {block, rootHex} = buildGloasBlock(0);
      const blockInput = BlockInputEpbs.createFromBlock(blockProps(rootHex, block));

      expect(blockInput.getVersionedHashes().length).toBe(0);
    });

    it("returns empty when created from payload (block not yet available)", () => {
      const {rootHex} = buildGloasBlock();
      const envelope = buildPayloadEnvelope(rootHex);
      const blockInput = BlockInputEpbs.createFromPayload(payloadProps(rootHex, envelope));

      // VersionedHashes are empty until block arrives (commitments are on the bid, not the envelope)
      expect(blockInput.getVersionedHashes().length).toBe(0);
    });

    it("sets versioned hashes when block added to payload-first input", () => {
      const {block, rootHex} = buildGloasBlock(2);
      const envelope = buildPayloadEnvelope(rootHex);
      const blockInput = BlockInputEpbs.createFromPayload(payloadProps(rootHex, envelope));

      expect(blockInput.getVersionedHashes().length).toBe(0);

      blockInput.addBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Date.now() / 1000,
      });

      // After block arrives, versionedHashes are computed from the bid's blobKzgCommitments
      expect(blockInput.getVersionedHashes().length).toBe(2);
    });
  });
});
