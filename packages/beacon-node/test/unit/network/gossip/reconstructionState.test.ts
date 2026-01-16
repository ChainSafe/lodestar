import {describe, it, expect, beforeEach, vi} from "vitest";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {PeerId} from "@libp2p/interface";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {
  ReconstructionStateManager,
  countBitsInMetadata,
  createEmptyPartsMetadata,
  mergePartsMetadata,
  isSubsetMetadata,
  getMetadataDifference,
} from "../../../../src/network/gossip/reconstructionState.js";
import {InMemoryColumnAvailabilityStore} from "../../../../src/network/gossip/columnAvailabilityStore.js";

const PARTS_METADATA_SIZE = Math.ceil(NUMBER_OF_COLUMNS / 8);

/**
 * Create multiple unique PeerIds asynchronously.
 */
async function createUniquePeerIds(count: number): Promise<PeerId[]> {
  const peerIds: PeerId[] = [];
  for (let i = 0; i < count; i++) {
    const privateKey = await generateKeyPair("secp256k1");
    peerIds.push(peerIdFromPrivateKey(privateKey));
  }
  return peerIds;
}

/**
 * Create a minimal valid DataColumnSidecar for testing.
 * KZG proofs are not verified in these unit tests.
 */
function createMockColumn(index: number): ReturnType<typeof ssz.fulu.DataColumnSidecar.defaultValue> {
  const column = ssz.fulu.DataColumnSidecar.defaultValue();
  column.index = index;
  // Add minimal data so serialization works
  column.column = [new Uint8Array(2048)];
  column.kzgProofs = [new Uint8Array(48)];
  column.kzgCommitments = [new Uint8Array(48)];
  return column;
}

/**
 * Create parts metadata with specific columns set.
 */
function createMetadataWithColumns(columns: number[]): Uint8Array {
  const metadata = new Uint8Array(PARTS_METADATA_SIZE);
  for (const col of columns) {
    const byteIdx = Math.floor(col / 8);
    const bitIdx = col % 8;
    metadata[byteIdx] |= 1 << bitIdx;
  }
  return metadata;
}

/**
 * Create a block root from a seed.
 */
function createBlockRoot(seed: number): Uint8Array {
  const root = new Uint8Array(32);
  root.fill(seed);
  return root;
}

describe("ReconstructionStateManager", () => {
  let manager: ReconstructionStateManager;
  let columnStore: InMemoryColumnAvailabilityStore;
  const blockRoot = createBlockRoot(1);

  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const mockMetrics = {
    partialColumnsReceived: {
      inc: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    columnStore = new InMemoryColumnAvailabilityStore();
    manager = new ReconstructionStateManager(columnStore, mockLogger as any, mockMetrics);
  });

  describe("peer metadata tracking", () => {
    it("should track peer metadata on first receive", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const metadata = createMetadataWithColumns([0, 1, 2]);

      manager.onPartialRpc(peerId, blockRoot, metadata, undefined);

      const retrieved = manager.getPeerMetadata(blockRoot, peerId);
      expect(retrieved).not.toBeNull();
      expect(retrieved![0]).toBe(0b00000111); // Columns 0, 1, 2
    });

    it("should merge peer metadata on subsequent receives", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const metadata1 = createMetadataWithColumns([0, 1, 2]);
      const metadata2 = createMetadataWithColumns([3, 4, 5]);

      manager.onPartialRpc(peerId, blockRoot, metadata1, undefined);
      manager.onPartialRpc(peerId, blockRoot, metadata2, undefined);

      const retrieved = manager.getPeerMetadata(blockRoot, peerId);
      expect(retrieved).not.toBeNull();
      // Should have all columns 0-5
      expect(retrieved![0]).toBe(0b00111111);
    });

    it("should track metadata independently for different peers", async () => {
      const [peer1, peer2] = await createUniquePeerIds(2);
      const metadata1 = createMetadataWithColumns([0, 1]);
      const metadata2 = createMetadataWithColumns([2, 3]);

      manager.onPartialRpc(peer1, blockRoot, metadata1, undefined);
      manager.onPartialRpc(peer2, blockRoot, metadata2, undefined);

      const retrieved1 = manager.getPeerMetadata(blockRoot, peer1);
      const retrieved2 = manager.getPeerMetadata(blockRoot, peer2);

      expect(retrieved1![0]).toBe(0b00000011); // Columns 0, 1
      expect(retrieved2![0]).toBe(0b00001100); // Columns 2, 3
    });

    it("should track metadata independently for different blocks", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const root1 = createBlockRoot(1);
      const root2 = createBlockRoot(2);
      const metadata1 = createMetadataWithColumns([0]);
      const metadata2 = createMetadataWithColumns([5]);

      manager.onPartialRpc(peerId, root1, metadata1, undefined);
      manager.onPartialRpc(peerId, root2, metadata2, undefined);

      const retrieved1 = manager.getPeerMetadata(root1, peerId);
      const retrieved2 = manager.getPeerMetadata(root2, peerId);

      expect(retrieved1![0]).toBe(0b00000001); // Column 0
      expect(retrieved2![0]).toBe(0b00100000); // Column 5
    });

    it("should return null for unknown peer", async () => {
      const [peerId] = await createUniquePeerIds(1);
      expect(manager.getPeerMetadata(blockRoot, peerId)).toBeNull();
    });
  });

  describe("incoming column data processing", () => {
    it("should process and store new column data", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const column = createMockColumn(5);
      const serialized = ssz.fulu.DataColumnSidecar.serialize(column);

      const results = manager.onPartialRpc(peerId, blockRoot, undefined, serialized);

      expect(results).toHaveLength(1);
      expect(results[0].columnIndex).toBe(5);
      expect(results[0].isNew).toBe(true);
      expect(columnStore.hasColumn(blockRoot, 5)).toBe(true);
    });

    it("should mark column as available in store", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const column = createMockColumn(10);
      const serialized = ssz.fulu.DataColumnSidecar.serialize(column);

      expect(columnStore.hasColumn(blockRoot, 10)).toBe(false);
      manager.onPartialRpc(peerId, blockRoot, undefined, serialized);
      expect(columnStore.hasColumn(blockRoot, 10)).toBe(true);
    });

    it("should allow retrieving stored column", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const column = createMockColumn(7);
      const serialized = ssz.fulu.DataColumnSidecar.serialize(column);

      manager.onPartialRpc(peerId, blockRoot, undefined, serialized);

      const retrieved = manager.getColumn(blockRoot, 7);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.index).toBe(7);
    });

    it("should increment metrics for new columns", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const column = createMockColumn(0);
      const serialized = ssz.fulu.DataColumnSidecar.serialize(column);

      manager.onPartialRpc(peerId, blockRoot, undefined, serialized);

      expect(mockMetrics.partialColumnsReceived.inc).toHaveBeenCalledWith({result: "new"});
    });

    it("should log when receiving new column", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const column = createMockColumn(0);
      const serialized = ssz.fulu.DataColumnSidecar.serialize(column);

      manager.onPartialRpc(peerId, blockRoot, undefined, serialized);

      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe("duplicate column detection", () => {
    it("should detect duplicate columns", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const column = createMockColumn(3);
      const serialized = ssz.fulu.DataColumnSidecar.serialize(column);

      // First receive
      const results1 = manager.onPartialRpc(peerId, blockRoot, undefined, serialized);
      expect(results1).toHaveLength(1);
      expect(results1[0].isNew).toBe(true);

      // Second receive (duplicate)
      const results2 = manager.onPartialRpc(peerId, blockRoot, undefined, serialized);
      expect(results2).toHaveLength(0);
    });

    it("should increment metrics for duplicate columns", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const column = createMockColumn(0);
      const serialized = ssz.fulu.DataColumnSidecar.serialize(column);

      manager.onPartialRpc(peerId, blockRoot, undefined, serialized);
      vi.clearAllMocks();

      manager.onPartialRpc(peerId, blockRoot, undefined, serialized);
      expect(mockMetrics.partialColumnsReceived.inc).toHaveBeenCalledWith({result: "duplicate"});
    });

    it("should detect duplicate even from different peers", async () => {
      const [peer1, peer2] = await createUniquePeerIds(2);
      const column = createMockColumn(0);
      const serialized = ssz.fulu.DataColumnSidecar.serialize(column);

      const results1 = manager.onPartialRpc(peer1, blockRoot, undefined, serialized);
      expect(results1).toHaveLength(1);

      const results2 = manager.onPartialRpc(peer2, blockRoot, undefined, serialized);
      expect(results2).toHaveLength(0);
    });
  });

  describe("finding peers with needed columns", () => {
    it("should return empty array when no peers are tracking block", async () => {
      const peers = manager.getPeersWithColumns(blockRoot, [0, 1, 2]);
      expect(peers).toEqual([]);
    });

    it("should find peers with needed columns", async () => {
      const [peer1, peer2] = await createUniquePeerIds(2);
      const meta1 = createMetadataWithColumns([0, 1, 2]); // Has 0, 1, 2
      const meta2 = createMetadataWithColumns([3, 4, 5]); // Has 3, 4, 5

      manager.onPartialRpc(peer1, blockRoot, meta1, undefined);
      manager.onPartialRpc(peer2, blockRoot, meta2, undefined);

      // Looking for column 3 - only peer2 has it
      const peersFor3 = manager.getPeersWithColumns(blockRoot, [3]);
      expect(peersFor3).toHaveLength(1);
      expect(peersFor3[0].toString()).toBe(peer2.toString());

      // Looking for column 0 - only peer1 has it
      const peersFor0 = manager.getPeersWithColumns(blockRoot, [0]);
      expect(peersFor0).toHaveLength(1);
      expect(peersFor0[0].toString()).toBe(peer1.toString());
    });

    it("should return all peers that have any of the needed columns", async () => {
      const [peer1, peer2, peer3] = await createUniquePeerIds(3);

      manager.onPartialRpc(peer1, blockRoot, createMetadataWithColumns([0, 1]), undefined);
      manager.onPartialRpc(peer2, blockRoot, createMetadataWithColumns([1, 2]), undefined);
      manager.onPartialRpc(peer3, blockRoot, createMetadataWithColumns([2, 3]), undefined);

      // Looking for columns 1 and 2 - peer1, peer2, and peer3 all have at least one
      const peers = manager.getPeersWithColumns(blockRoot, [1, 2]);
      expect(peers).toHaveLength(3);
    });

    it("should not return peers that have none of the needed columns", async () => {
      const [peer1, peer2] = await createUniquePeerIds(2);

      manager.onPartialRpc(peer1, blockRoot, createMetadataWithColumns([0, 1, 2]), undefined);
      manager.onPartialRpc(peer2, blockRoot, createMetadataWithColumns([10, 11, 12]), undefined);

      // Looking for columns 5, 6 - neither peer has them
      const peers = manager.getPeersWithColumns(blockRoot, [5, 6]);
      expect(peers).toHaveLength(0);
    });
  });

  describe("custody columns checking", () => {
    it("should delegate hasCustodyColumns to column store", () => {
      const custodyColumns = [0, 5, 10];

      expect(manager.hasCustodyColumns(blockRoot, custodyColumns)).toBe(false);

      columnStore.markColumnAvailable(blockRoot, 0);
      columnStore.markColumnAvailable(blockRoot, 5);
      columnStore.markColumnAvailable(blockRoot, 10);

      expect(manager.hasCustodyColumns(blockRoot, custodyColumns)).toBe(true);
    });

    it("should return missing custody columns", () => {
      const custodyColumns = [0, 5, 10, 15];

      columnStore.markColumnAvailable(blockRoot, 0);
      columnStore.markColumnAvailable(blockRoot, 10);

      const missing = manager.getMissingCustodyColumns(blockRoot, custodyColumns);
      expect(missing).toEqual([5, 15]);
    });

    it("should return empty array when all custody columns are available", () => {
      const custodyColumns = [0, 5];

      columnStore.markColumnAvailable(blockRoot, 0);
      columnStore.markColumnAvailable(blockRoot, 5);

      const missing = manager.getMissingCustodyColumns(blockRoot, custodyColumns);
      expect(missing).toEqual([]);
    });
  });

  describe("pruning", () => {
    it("should prune all state for a block", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const column = createMockColumn(0);
      const serialized = ssz.fulu.DataColumnSidecar.serialize(column);

      manager.onPartialRpc(peerId, blockRoot, createMetadataWithColumns([0, 1]), serialized);

      // Verify state exists
      expect(manager.getPeerMetadata(blockRoot, peerId)).not.toBeNull();
      expect(manager.getColumn(blockRoot, 0)).not.toBeNull();
      expect(columnStore.hasColumn(blockRoot, 0)).toBe(true);

      manager.pruneBlock(blockRoot);

      // Verify state is gone
      expect(manager.getPeerMetadata(blockRoot, peerId)).toBeNull();
      expect(manager.getColumn(blockRoot, 0)).toBeNull();
      expect(columnStore.hasColumn(blockRoot, 0)).toBe(false);
    });

    it("should not affect other blocks when pruning", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const root1 = createBlockRoot(1);
      const root2 = createBlockRoot(2);

      manager.onPartialRpc(peerId, root1, createMetadataWithColumns([0]), undefined);
      manager.onPartialRpc(peerId, root2, createMetadataWithColumns([5]), undefined);

      manager.pruneBlock(root1);

      expect(manager.getPeerMetadata(root1, peerId)).toBeNull();
      expect(manager.getPeerMetadata(root2, peerId)).not.toBeNull();
    });
  });

  describe("tracking stats", () => {
    it("should return correct tracked block count", async () => {
      const [peerId] = await createUniquePeerIds(1);

      expect(manager.getTrackedBlockCount()).toBe(0);

      manager.onPartialRpc(peerId, createBlockRoot(1), createMetadataWithColumns([0]), undefined);
      expect(manager.getTrackedBlockCount()).toBe(1);

      manager.onPartialRpc(peerId, createBlockRoot(2), createMetadataWithColumns([0]), undefined);
      expect(manager.getTrackedBlockCount()).toBe(2);
    });

    it("should return correct peer count for block", async () => {
      const [peer1, peer2, peer3] = await createUniquePeerIds(3);

      expect(manager.getPeerCountForBlock(blockRoot)).toBe(0);

      manager.onPartialRpc(peer1, blockRoot, createMetadataWithColumns([0]), undefined);
      expect(manager.getPeerCountForBlock(blockRoot)).toBe(1);

      manager.onPartialRpc(peer2, blockRoot, createMetadataWithColumns([1]), undefined);
      expect(manager.getPeerCountForBlock(blockRoot)).toBe(2);

      manager.onPartialRpc(peer3, blockRoot, createMetadataWithColumns([2]), undefined);
      expect(manager.getPeerCountForBlock(blockRoot)).toBe(3);
    });
  });

  describe("invalid column handling", () => {
    it("should handle invalid serialized data gracefully", async () => {
      const [peerId] = await createUniquePeerIds(1);
      const invalidData = new Uint8Array([1, 2, 3, 4, 5]);

      const results = manager.onPartialRpc(peerId, blockRoot, undefined, invalidData);

      expect(results).toHaveLength(0);
      expect(mockMetrics.partialColumnsReceived.inc).toHaveBeenCalledWith({result: "invalid"});
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("should handle empty partial message gracefully", async () => {
      const [peerId] = await createUniquePeerIds(1);

      const results = manager.onPartialRpc(peerId, blockRoot, createMetadataWithColumns([0]), new Uint8Array(0));

      expect(results).toHaveLength(0);
    });
  });

  describe("null metrics handling", () => {
    it("should work without metrics", async () => {
      const managerNoMetrics = new ReconstructionStateManager(columnStore, mockLogger as any, null);
      const [peerId] = await createUniquePeerIds(1);
      const column = createMockColumn(0);
      const serialized = ssz.fulu.DataColumnSidecar.serialize(column);

      // Should not throw
      const results = managerNoMetrics.onPartialRpc(peerId, blockRoot, undefined, serialized);
      expect(results).toHaveLength(1);
    });
  });
});

describe("reconstructionState utility functions", () => {
  describe("countBitsInMetadata", () => {
    it("should return 0 for empty metadata", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE);
      expect(countBitsInMetadata(metadata)).toBe(0);
    });

    it("should count bits correctly", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE);
      metadata[0] = 0b00000111; // 3 bits set
      expect(countBitsInMetadata(metadata)).toBe(3);
    });

    it("should count bits across multiple bytes", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE);
      metadata[0] = 0b00000001; // 1 bit
      metadata[1] = 0b00000011; // 2 bits
      metadata[2] = 0b00000111; // 3 bits
      expect(countBitsInMetadata(metadata)).toBe(6);
    });

    it("should count all bits when full", () => {
      const metadata = new Uint8Array(PARTS_METADATA_SIZE).fill(0xff);
      // Account for potentially unused bits in the last byte
      const expectedBits = PARTS_METADATA_SIZE * 8;
      expect(countBitsInMetadata(metadata)).toBe(expectedBits);
    });
  });

  describe("createEmptyPartsMetadata", () => {
    it("should create correct size metadata", () => {
      const metadata = createEmptyPartsMetadata();
      expect(metadata.length).toBe(PARTS_METADATA_SIZE);
    });

    it("should create all-zero metadata", () => {
      const metadata = createEmptyPartsMetadata();
      expect(metadata.every((b) => b === 0)).toBe(true);
    });
  });

  describe("mergePartsMetadata", () => {
    it("should merge two empty metadatas to empty", () => {
      const a = createEmptyPartsMetadata();
      const b = createEmptyPartsMetadata();
      const result = mergePartsMetadata(a, b);
      expect(result.every((byte) => byte === 0)).toBe(true);
    });

    it("should perform bitwise OR correctly", () => {
      const a = new Uint8Array(PARTS_METADATA_SIZE);
      const b = new Uint8Array(PARTS_METADATA_SIZE);
      a[0] = 0b00001111;
      b[0] = 0b11110000;

      const result = mergePartsMetadata(a, b);
      expect(result[0]).toBe(0b11111111);
    });

    it("should handle overlapping bits", () => {
      const a = new Uint8Array(PARTS_METADATA_SIZE);
      const b = new Uint8Array(PARTS_METADATA_SIZE);
      a[0] = 0b00111100;
      b[0] = 0b00011110;

      const result = mergePartsMetadata(a, b);
      expect(result[0]).toBe(0b00111110);
    });

    it("should return correct size", () => {
      const a = createEmptyPartsMetadata();
      const b = createEmptyPartsMetadata();
      const result = mergePartsMetadata(a, b);
      expect(result.length).toBe(PARTS_METADATA_SIZE);
    });
  });

  describe("isSubsetMetadata", () => {
    it("should return true for empty subset", () => {
      const subset = createEmptyPartsMetadata();
      const superset = new Uint8Array(PARTS_METADATA_SIZE);
      superset[0] = 0b11111111;
      expect(isSubsetMetadata(subset, superset)).toBe(true);
    });

    it("should return true for identical metadata", () => {
      const a = new Uint8Array(PARTS_METADATA_SIZE);
      a[0] = 0b00001111;
      const b = new Uint8Array(PARTS_METADATA_SIZE);
      b[0] = 0b00001111;
      expect(isSubsetMetadata(a, b)).toBe(true);
    });

    it("should return true when subset is proper subset", () => {
      const subset = new Uint8Array(PARTS_METADATA_SIZE);
      subset[0] = 0b00001111;
      const superset = new Uint8Array(PARTS_METADATA_SIZE);
      superset[0] = 0b11111111;
      expect(isSubsetMetadata(subset, superset)).toBe(true);
    });

    it("should return false when subset has bits not in superset", () => {
      const a = new Uint8Array(PARTS_METADATA_SIZE);
      a[0] = 0b00001111;
      const b = new Uint8Array(PARTS_METADATA_SIZE);
      b[0] = 0b11110000;
      expect(isSubsetMetadata(a, b)).toBe(false);
    });

    it("should handle multi-byte comparison", () => {
      const subset = new Uint8Array(PARTS_METADATA_SIZE);
      subset[0] = 0b00000001;
      subset[1] = 0b00000010;

      const superset = new Uint8Array(PARTS_METADATA_SIZE);
      superset[0] = 0b11111111;
      superset[1] = 0b11111111;

      expect(isSubsetMetadata(subset, superset)).toBe(true);
    });
  });

  describe("getMetadataDifference", () => {
    it("should return empty array when a is empty", () => {
      const a = createEmptyPartsMetadata();
      const b = new Uint8Array(PARTS_METADATA_SIZE);
      b[0] = 0b11111111;
      expect(getMetadataDifference(a, b)).toEqual([]);
    });

    it("should return all columns in a when b is empty", () => {
      const a = new Uint8Array(PARTS_METADATA_SIZE);
      a[0] = 0b00000111; // Columns 0, 1, 2
      const b = createEmptyPartsMetadata();
      expect(getMetadataDifference(a, b)).toEqual([0, 1, 2]);
    });

    it("should return columns in a but not in b", () => {
      const a = new Uint8Array(PARTS_METADATA_SIZE);
      a[0] = 0b00001111; // Columns 0, 1, 2, 3
      const b = new Uint8Array(PARTS_METADATA_SIZE);
      b[0] = 0b00000011; // Columns 0, 1
      expect(getMetadataDifference(a, b)).toEqual([2, 3]);
    });

    it("should handle differences across byte boundaries", () => {
      const a = new Uint8Array(PARTS_METADATA_SIZE);
      a[0] = 0b10000000; // Column 7
      a[1] = 0b00000001; // Column 8
      const b = createEmptyPartsMetadata();
      expect(getMetadataDifference(a, b)).toEqual([7, 8]);
    });

    it("should return empty when a is subset of b", () => {
      const a = new Uint8Array(PARTS_METADATA_SIZE);
      a[0] = 0b00001111;
      const b = new Uint8Array(PARTS_METADATA_SIZE);
      b[0] = 0b11111111;
      expect(getMetadataDifference(a, b)).toEqual([]);
    });
  });
});
