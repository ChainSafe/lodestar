import {type PeerId} from "@libp2p/interface";
import {Root, fulu, ssz} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnAvailabilityStore} from "./columnAvailability.js";

/**
 * Metrics interface for reconstruction state.
 * This is a subset of the full Metrics type to avoid circular dependencies.
 */
export interface ReconstructionMetrics {
  partialColumnsReceived?: {
    inc(labels: {result: string}): void;
  };
}

const PARTS_METADATA_SIZE = Math.ceil(NUMBER_OF_COLUMNS / 8);

/**
 * Result when processing incoming partial data.
 */
export interface ReconstructionResult {
  blockRoot: Root;
  columnIndex: number;
  column: fulu.DataColumnSidecar;
  isNew: boolean;
}

/**
 * Tracks what columns a peer has advertised for a block.
 */
export interface PeerColumnInfo {
  peerId: PeerId;
  columns: Uint8Array;
  lastSeen: number;
}

/**
 * Manages reconstruction state for partial data columns.
 *
 * Responsibilities:
 * 1. Track what columns we have per block (via ColumnAvailabilityStore)
 * 2. Track what columns each peer has advertised
 * 3. Process incoming partial data and extract columns
 * 4. Detect when we've received new columns
 * 5. Provide peer selection for fetching missing columns
 */
export class ReconstructionStateManager {
  private readonly columnStore: ColumnAvailabilityStore;
  private readonly peerColumns = new Map<string, Map<string, PeerColumnInfo>>();
  private readonly pendingColumns = new Map<string, Map<number, fulu.DataColumnSidecar>>();
  private readonly logger: Logger;
  private readonly metrics: ReconstructionMetrics | null;

  constructor(columnStore: ColumnAvailabilityStore, logger: Logger, metrics: ReconstructionMetrics | null) {
    this.columnStore = columnStore;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Process incoming partial message RPC.
   * Returns newly received columns.
   */
  onPartialRpc(
    peerId: PeerId,
    blockRoot: Root,
    partsMetadata: Uint8Array | undefined,
    partialMessage: Uint8Array | undefined
  ): ReconstructionResult[] {
    const blockKey = toRootHex(blockRoot);
    const results: ReconstructionResult[] = [];

    // Update peer's advertised columns
    if (partsMetadata !== undefined && partsMetadata.length > 0) {
      this.updatePeerMetadata(blockKey, peerId, partsMetadata);
    }

    // Process incoming column data
    if (partialMessage !== undefined && partialMessage.length > 0) {
      try {
        const column = ssz.fulu.DataColumnSidecar.deserialize(partialMessage);
        const columnIndex = column.index;

        // Check if this is a new column for us
        if (!this.columnStore.hasColumn(blockRoot, columnIndex)) {
          // Store the column
          this.storeColumn(blockKey, columnIndex, column);
          this.columnStore.markColumnAvailable(blockRoot, columnIndex);

          results.push({
            blockRoot,
            columnIndex,
            column,
            isNew: true,
          });

          this.logger.debug("Received new column via partial message", {
            blockRoot: blockKey,
            columnIndex,
            peer: peerId.toString(),
          });

          this.metrics?.partialColumnsReceived?.inc({result: "new"});
        } else {
          this.metrics?.partialColumnsReceived?.inc({result: "duplicate"});
        }
      } catch (e) {
        this.logger.debug("Failed to deserialize partial column", {
          blockRoot: blockKey,
          error: (e as Error).message,
        });
        this.metrics?.partialColumnsReceived?.inc({result: "invalid"});
      }
    }

    return results;
  }

  /**
   * Get peers who have columns we need.
   */
  getPeersWithColumns(blockRoot: Root, neededColumns: number[]): PeerId[] {
    const blockKey = toRootHex(blockRoot);
    const peerMap = this.peerColumns.get(blockKey);
    if (peerMap === undefined) return [];

    const peers: PeerId[] = [];
    for (const info of peerMap.values()) {
      for (const col of neededColumns) {
        const byteIdx = Math.floor(col / 8);
        const bitIdx = col % 8;
        if (byteIdx < info.columns.length && (info.columns[byteIdx] & (1 << bitIdx)) !== 0) {
          peers.push(info.peerId);
          break;
        }
      }
    }
    return peers;
  }

  /**
   * Get columns a peer has advertised for a block.
   */
  getPeerMetadata(blockRoot: Root, peerId: PeerId): Uint8Array | null {
    const blockKey = toRootHex(blockRoot);
    const peerKey = peerId.toString();
    return this.peerColumns.get(blockKey)?.get(peerKey)?.columns ?? null;
  }

  /**
   * Get a stored column.
   */
  getColumn(blockRoot: Root, columnIndex: number): fulu.DataColumnSidecar | null {
    const blockKey = toRootHex(blockRoot);
    return this.pendingColumns.get(blockKey)?.get(columnIndex) ?? null;
  }

  /**
   * Check if we have all custody columns for a block.
   */
  hasCustodyColumns(blockRoot: Root, custodyColumns: number[]): boolean {
    return this.columnStore.hasCustodyColumns(blockRoot, custodyColumns);
  }

  /**
   * Get missing custody columns.
   */
  getMissingCustodyColumns(blockRoot: Root, custodyColumns: number[]): number[] {
    const missing: number[] = [];
    for (const col of custodyColumns) {
      if (!this.columnStore.hasColumn(blockRoot, col)) {
        missing.push(col);
      }
    }
    return missing;
  }

  /**
   * Prune state for a finalized block.
   */
  pruneBlock(blockRoot: Root): void {
    const blockKey = toRootHex(blockRoot);
    this.peerColumns.delete(blockKey);
    this.pendingColumns.delete(blockKey);
    this.columnStore.pruneBlock(blockRoot);
  }

  /**
   * Get the number of blocks being tracked.
   */
  getTrackedBlockCount(): number {
    return this.peerColumns.size;
  }

  /**
   * Get the number of peers tracking a specific block.
   */
  getPeerCountForBlock(blockRoot: Root): number {
    const blockKey = toRootHex(blockRoot);
    return this.peerColumns.get(blockKey)?.size ?? 0;
  }

  private updatePeerMetadata(blockKey: string, peerId: PeerId, metadata: Uint8Array): void {
    let peerMap = this.peerColumns.get(blockKey);
    if (peerMap === undefined) {
      peerMap = new Map();
      this.peerColumns.set(blockKey, peerMap);
    }

    const peerKey = peerId.toString();
    const existing = peerMap.get(peerKey);

    if (existing !== undefined) {
      // Merge with existing (bitwise OR) - peer may have gained more columns
      const maxLen = Math.max(existing.columns.length, metadata.length);
      const merged = new Uint8Array(maxLen);
      for (let i = 0; i < maxLen; i++) {
        merged[i] = (existing.columns[i] ?? 0) | (metadata[i] ?? 0);
      }
      existing.columns = merged;
      existing.lastSeen = Date.now();
    } else {
      peerMap.set(peerKey, {
        peerId,
        columns: metadata.slice(),
        lastSeen: Date.now(),
      });
    }
  }

  private storeColumn(blockKey: string, columnIndex: number, column: fulu.DataColumnSidecar): void {
    let columnMap = this.pendingColumns.get(blockKey);
    if (columnMap === undefined) {
      columnMap = new Map();
      this.pendingColumns.set(blockKey, columnMap);
    }
    columnMap.set(columnIndex, column);
  }
}

/**
 * Count set bits in a metadata bitmap.
 */
export function countBitsInMetadata(metadata: Uint8Array): number {
  let count = 0;
  for (const byte of metadata) {
    let b = byte;
    while (b !== 0) {
      count += b & 1;
      b >>>= 1;
    }
  }
  return count;
}

/**
 * Create an empty parts metadata bitmap.
 */
export function createEmptyPartsMetadata(): Uint8Array {
  return new Uint8Array(PARTS_METADATA_SIZE);
}

/**
 * Merge two parts metadata bitmaps using bitwise OR.
 */
export function mergePartsMetadata(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(PARTS_METADATA_SIZE);
  for (let i = 0; i < PARTS_METADATA_SIZE; i++) {
    result[i] = (a[i] ?? 0) | (b[i] ?? 0);
  }
  return result;
}

/**
 * Check if metadata a is a subset of metadata b.
 * Returns true if all bits set in a are also set in b.
 */
export function isSubsetMetadata(subset: Uint8Array, superset: Uint8Array): boolean {
  for (let i = 0; i < PARTS_METADATA_SIZE; i++) {
    const subByte = subset[i] ?? 0;
    const superByte = superset[i] ?? 0;
    if ((subByte & superByte) !== subByte) {
      return false;
    }
  }
  return true;
}

/**
 * Get column indices that are in a but not in b.
 */
export function getMetadataDifference(a: Uint8Array, b: Uint8Array): number[] {
  const diff: number[] = [];
  for (let col = 0; col < NUMBER_OF_COLUMNS; col++) {
    const byteIdx = Math.floor(col / 8);
    const bitIdx = col % 8;
    const inA = (a[byteIdx] ?? 0) & (1 << bitIdx);
    const inB = (b[byteIdx] ?? 0) & (1 << bitIdx);
    if (inA !== 0 && inB === 0) {
      diff.push(col);
    }
  }
  return diff;
}
