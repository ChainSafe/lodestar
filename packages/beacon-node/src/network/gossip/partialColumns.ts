import {type PeerId} from "@libp2p/interface";
import {
  BitwiseOrMerger,
  PartialMessage,
  PartialMessageExtension,
  PartialMessageState,
  PartialPublishAction,
  type PartsMetadataMerger,
} from "@chainsafe/libp2p-gossipsub";
import {BeaconConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {Root, fulu, ssz} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {ColumnAvailabilityStore} from "./columnAvailability.js";
import {NetworkConfig} from "../networkConfig.js";
import {GossipType} from "./interface.js";
import {ReconstructionStateManager} from "./reconstructionState.js";

/**
 * Number of bytes in the parts metadata bitmap.
 * NUMBER_OF_COLUMNS (128) / 8 bits per byte = 16 bytes
 */
const PARTS_METADATA_SIZE = Math.ceil(NUMBER_OF_COLUMNS / 8);

/**
 * Wraps a DataColumnSidecar as a PartialMessage for gossip propagation.
 */
export class PartialDataColumn implements PartialMessage {
  private readonly column: fulu.DataColumnSidecar;
  private readonly serializedColumn: Uint8Array;
  private readonly blockRoot: Root;

  constructor(column: fulu.DataColumnSidecar, serializedColumn: Uint8Array, blockRoot: Root) {
    this.column = column;
    this.serializedColumn = serializedColumn;
    this.blockRoot = blockRoot;
  }

  /**
   * Group ID is the block root - all columns for a block form a group.
   */
  groupId(): Uint8Array {
    return this.blockRoot;
  }

  /**
   * Parts metadata is a bitmap where bit N is set if column N is present.
   */
  partsMetadata(): Uint8Array {
    const metadata = new Uint8Array(PARTS_METADATA_SIZE);
    const byteIndex = Math.floor(this.column.index / 8);
    const bitIndex = this.column.index % 8;
    metadata[byteIndex] = 1 << bitIndex;
    return metadata;
  }

  /**
   * Produces bytes to send based on what the peer already has.
   *
   * @param requestedMeta - Bitmap of columns the peer already has
   */
  partialMessageBytes(requestedMeta: Uint8Array | null): PartialPublishAction {
    const ourMeta = this.partsMetadata();

    if (requestedMeta !== null) {
      // Check if peer already has this column
      const byteIndex = Math.floor(this.column.index / 8);
      const bitIndex = this.column.index % 8;
      if ((requestedMeta[byteIndex] & (1 << bitIndex)) !== 0) {
        // Peer already has this column
        return {
          needMore: false,
          bytesToSend: null,
          updatedPartsMetadata: requestedMeta,
        };
      }
    }

    // Peer needs this column, send it
    const merger = new BitwiseOrMerger();
    const updatedMeta = requestedMeta !== null ? merger.merge(requestedMeta, ourMeta) : ourMeta;

    return {
      needMore: !this.hasAllParts(updatedMeta),
      bytesToSend: this.serializedColumn,
      updatedPartsMetadata: updatedMeta,
    };
  }

  private hasAllParts(metadata: Uint8Array): boolean {
    // Check if all NUMBER_OF_COLUMNS bits are set
    const fullBytes = Math.floor(NUMBER_OF_COLUMNS / 8);
    const remainingBits = NUMBER_OF_COLUMNS % 8;

    for (let i = 0; i < fullBytes; i++) {
      if (metadata[i] !== 0xff) {
        return false;
      }
    }

    if (remainingBits > 0) {
      const expectedMask = (1 << remainingBits) - 1;
      if ((metadata[fullBytes] & expectedMask) !== expectedMask) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Partial message implementation that aggregates ALL columns we have for a block.
 *
 * Unlike the single-column PartialDataColumn approach, this tracks our complete HAVE set
 * via ColumnAvailabilityStore and sends only the columns the peer is missing.
 *
 * Key differences from PartialDataColumn:
 * - OLD (PartialDataColumn): Only knew about one column at a time
 * - NEW (AggregatedPartialDataColumn): Tracks ALL columns via ColumnAvailabilityStore
 */
export class AggregatedPartialDataColumn implements PartialMessage {
  constructor(
    private readonly blockRoot: Root,
    private readonly columnStore: ColumnAvailabilityStore,
    private readonly getColumnData: (columnIndex: number) => fulu.DataColumnSidecar | null
  ) {}

  /**
   * Group ID is the block root - all columns for a block form a group.
   */
  groupId(): Uint8Array {
    return this.blockRoot;
  }

  /**
   * Returns bitmap of ALL columns we have for this block (aggregated HAVE set).
   */
  partsMetadata(): Uint8Array {
    return this.columnStore.getAvailableColumns(this.blockRoot) ?? new Uint8Array(PARTS_METADATA_SIZE);
  }

  /**
   * Produces bytes to send based on what the peer already has.
   *
   * Determines which columns the peer is missing and sends one of them.
   * Returns updated metadata showing the union of columns.
   *
   * @param requestedMeta - Bitmap of columns the peer already has
   */
  partialMessageBytes(requestedMeta: Uint8Array | null): PartialPublishAction {
    const ourMeta = this.partsMetadata();
    const theirMeta = requestedMeta ?? new Uint8Array(PARTS_METADATA_SIZE);

    // Find columns we have that they don't
    const columnsToSend: number[] = [];
    for (let col = 0; col < NUMBER_OF_COLUMNS; col++) {
      const byteIdx = Math.floor(col / 8);
      const bitIdx = col % 8;
      const weHave = (ourMeta[byteIdx] & (1 << bitIdx)) !== 0;
      const theyHave = (theirMeta[byteIdx] & (1 << bitIdx)) !== 0;

      if (weHave && !theyHave) {
        columnsToSend.push(col);
      }
    }

    if (columnsToSend.length === 0) {
      // Nothing to send - check if we need more from them
      const needMore = this.checkNeedMore(ourMeta, theirMeta);
      return {
        needMore,
        bytesToSend: null,
        updatedPartsMetadata: ourMeta,
      };
    }

    // Send one column at a time to keep messages small
    const columnIndex = columnsToSend[0];
    const columnData = this.getColumnData(columnIndex);

    if (columnData === null) {
      // Column not available (race condition) - just send metadata
      return {
        needMore: this.checkNeedMore(ourMeta, theirMeta),
        bytesToSend: null,
        updatedPartsMetadata: ourMeta,
      };
    }

    const serialized = ssz.fulu.DataColumnSidecar.serialize(columnData);

    // Updated metadata = union of theirs + ours
    const updatedMeta = new Uint8Array(PARTS_METADATA_SIZE);
    for (let i = 0; i < PARTS_METADATA_SIZE; i++) {
      updatedMeta[i] = theirMeta[i] | ourMeta[i];
    }

    return {
      needMore: columnsToSend.length > 1 || this.checkNeedMore(ourMeta, theirMeta),
      bytesToSend: serialized,
      updatedPartsMetadata: updatedMeta,
    };
  }

  /**
   * Checks if the peer has columns we don't have.
   */
  private checkNeedMore(ourMeta: Uint8Array, theirMeta: Uint8Array): boolean {
    for (let col = 0; col < NUMBER_OF_COLUMNS; col++) {
      const byteIdx = Math.floor(col / 8);
      const bitIdx = col % 8;
      const weHave = (ourMeta[byteIdx] & (1 << bitIdx)) !== 0;
      const theyHave = (theirMeta[byteIdx] & (1 << bitIdx)) !== 0;

      if (theyHave && !weHave) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Result of processing a partial column RPC.
 */
export interface PartialColumnResult {
  blockRoot: Root;
  partsMetadata: Uint8Array;
  columnIndex: number | null;
  columnData: Uint8Array | null;
  isComplete: boolean;
  newPartsCount: number;
}

/**
 * Options for PartialColumnBroadcaster
 */
export interface PartialColumnBroadcasterOpts {
  maxGroups?: number;
  groupTTL?: number;
}

/**
 * Metrics interface for partial column broadcasting.
 * This is a subset of the full Metrics type to avoid circular dependencies.
 */
export interface PartialColumnMetrics {
  partialColumnsReceived?: {
    inc(labels: {result: string}): void;
  };
  partialColumnsRebroadcast?: {
    inc(): void;
  };
}

/**
 * Callback type for when we need to fetch missing columns via req/resp.
 */
export type NeedColumnsCallback = (blockRoot: Root, columns: number[], peers: PeerId[]) => void;

/**
 * Interface for publishing partial messages to gossipsub.
 * This matches the GossipSub.publishPartial method signature.
 */
export interface PartialPublisher {
  publishPartial(partialMsg: PartialMessage, topic: string): Promise<void>;
}

/**
 * Handles partial data column message broadcasting and reception.
 *
 * Flow:
 * 1. Receive partial RPC via onIncomingRpc
 * 2. Process and extract new columns via ReconstructionStateManager
 * 3. If new columns received, rebroadcast to mesh peers
 * 4. Check if we need to fetch missing custody columns
 *
 * Integrates with js-libp2p-gossipsub partial messages extension.
 */
export class PartialColumnBroadcaster implements PartialMessageExtension {
  private readonly logger: Logger;
  private readonly merger: PartsMetadataMerger;
  private readonly stateByTopic = new Map<string, PartialMessageState>();
  private readonly columnStore: ColumnAvailabilityStore;
  private readonly reconstructionState: ReconstructionStateManager;
  private readonly custodyColumns: number[];
  private readonly metrics: PartialColumnMetrics | null;

  private publisher: PartialPublisher | null = null;
  private onNeedColumns: NeedColumnsCallback | null = null;

  constructor(
    _config: BeaconConfig,
    _networkConfig: NetworkConfig,
    logger: Logger,
    columnStore: ColumnAvailabilityStore,
    custodyColumns: number[],
    metrics: PartialColumnMetrics | null = null,
    _opts?: PartialColumnBroadcasterOpts
  ) {
    this.logger = logger;
    this.merger = new BitwiseOrMerger();
    this.columnStore = columnStore;
    this.custodyColumns = custodyColumns;
    this.metrics = metrics;
    this.reconstructionState = new ReconstructionStateManager(columnStore, logger, metrics);
  }

  /**
   * Set the publisher for rebroadcasting partial messages.
   * Must be called before rebroadcasting can occur.
   */
  setPublisher(publisher: PartialPublisher): void {
    this.publisher = publisher;
  }

  /**
   * Set callback for when we need to fetch missing columns via req/resp.
   */
  setNeedColumnsCallback(callback: NeedColumnsCallback): void {
    this.onNeedColumns = callback;
  }

  /**
   * Called when a partial message RPC is received from the gossipsub layer.
   */
  onIncomingRpc(
    peerId: PeerId,
    topicID: Uint8Array,
    groupID: Uint8Array,
    partsMetadata: Uint8Array | undefined,
    partialMessage: Uint8Array | undefined
  ): void {
    const topicStr = new TextDecoder().decode(topicID);

    // Only handle data column topics
    if (!topicStr.includes(GossipType.data_column_sidecar)) {
      return;
    }

    const blockRoot = groupID as Root;

    this.logger.debug("Received partial column RPC", {
      topic: topicStr,
      peer: peerId.toString(),
      blockRoot: toRootHex(blockRoot),
      hasMetadata: partsMetadata !== undefined,
      hasData: partialMessage !== undefined,
      partsCount: partsMetadata !== undefined ? this.countParts(partsMetadata) : 0,
    });

    // Process the incoming RPC via ReconstructionStateManager
    const results = this.reconstructionState.onPartialRpc(peerId, blockRoot, partsMetadata, partialMessage);

    // If we received new columns, rebroadcast to mesh
    if (results.length > 0) {
      this.rebroadcastToMesh(topicStr, blockRoot);
    }

    // Check if we need to fetch missing custody columns
    this.checkAndFetchMissingColumns(blockRoot);
  }

  /**
   * Publish our available columns to mesh peers.
   */
  async publishAvailableColumns(blockRoot: Root, topic: string): Promise<void> {
    if (this.publisher === null) {
      this.logger.debug("Cannot publish partial columns: no publisher set");
      return;
    }

    const partialMsg = new AggregatedPartialDataColumn(blockRoot, this.columnStore, (colIdx) =>
      this.reconstructionState.getColumn(blockRoot, colIdx)
    );

    await this.publisher.publishPartial(partialMsg, topic);
  }

  /**
   * Called when a full column is received via regular gossip.
   * Updates our availability tracking.
   */
  onFullColumnReceived(blockRoot: Root, columnIndex: number): void {
    this.columnStore.markColumnAvailable(blockRoot, columnIndex);
  }

  /**
   * Called when block is finalized - clean up state.
   */
  onBlockFinalized(blockRoot: Root): void {
    this.reconstructionState.pruneBlock(blockRoot);
    // Also clean up state for this block across all topics
    for (const state of this.stateByTopic.values()) {
      state.removeGroup(blockRoot);
    }
  }

  /**
   * Get count of available columns for a block.
   */
  getColumnCount(blockRoot: Root): number {
    return this.columnStore.getColumnCount(blockRoot);
  }

  /**
   * Check if we have all custody columns for a block.
   */
  hasCustodyColumns(blockRoot: Root): boolean {
    return this.reconstructionState.hasCustodyColumns(blockRoot, this.custodyColumns);
  }

  /**
   * Get the reconstruction state manager for advanced operations.
   */
  getReconstructionState(): ReconstructionStateManager {
    return this.reconstructionState;
  }

  /**
   * Gets the partial message state for a topic.
   */
  getState(topic: string): PartialMessageState | undefined {
    return this.stateByTopic.get(topic);
  }

  /**
   * Creates or retrieves state for a data column topic.
   */
  getOrCreateState(topic: string): PartialMessageState {
    let state = this.stateByTopic.get(topic);
    if (state === undefined) {
      state = new PartialMessageState(this.merger);
      state.start();
      this.stateByTopic.set(topic, state);
    }
    return state;
  }

  /**
   * Cleans up state for a topic.
   */
  removeTopicState(topic: string): void {
    const state = this.stateByTopic.get(topic);
    if (state !== undefined) {
      state.clear();
      this.stateByTopic.delete(topic);
    }
  }

  /**
   * Called when a block's data columns are complete.
   */
  onBlockComplete(blockRoot: Root): void {
    // Clean up state for this block across all topics
    for (const state of this.stateByTopic.values()) {
      state.removeGroup(blockRoot);
    }
  }

  /**
   * Stops all state trackers.
   */
  stop(): void {
    for (const state of this.stateByTopic.values()) {
      state.stop();
    }
    this.stateByTopic.clear();
  }

  /**
   * Rebroadcast our updated HAVE set to mesh peers.
   */
  private rebroadcastToMesh(topic: string, blockRoot: Root): void {
    const ourMeta = this.columnStore.getAvailableColumns(blockRoot);
    if (ourMeta === null) return;

    this.metrics?.partialColumnsRebroadcast?.inc();

    // Send updated metadata to all mesh peers for this topic
    this.publishAvailableColumns(blockRoot, topic).catch((e) => {
      this.logger.debug("Failed to rebroadcast partial columns", {
        blockRoot: toRootHex(blockRoot),
        error: (e as Error).message,
      });
    });
  }

  /**
   * Check if we're missing custody columns and trigger fetch.
   */
  private checkAndFetchMissingColumns(blockRoot: Root): void {
    const missing = this.reconstructionState.getMissingCustodyColumns(blockRoot, this.custodyColumns);

    if (missing.length === 0) {
      this.logger.debug("All custody columns available", {
        blockRoot: toRootHex(blockRoot),
        custodyCount: this.custodyColumns.length,
      });
      return;
    }

    // Find peers who have the columns we need
    const peers = this.reconstructionState.getPeersWithColumns(blockRoot, missing);

    if (peers.length > 0 && this.onNeedColumns !== null) {
      this.logger.debug("Requesting missing custody columns", {
        blockRoot: toRootHex(blockRoot),
        missingColumns: missing.join(","),
        peerCount: peers.length,
      });

      this.onNeedColumns(blockRoot, missing, peers);
    }
  }

  /**
   * Counts the number of set bits in a parts metadata bitmap.
   */
  private countParts(metadata: Uint8Array): number {
    let count = 0;
    for (const byte of metadata) {
      let b = byte;
      while (b !== 0) {
        count += b & 1;
        b >>= 1;
      }
    }
    return count;
  }
}

/**
 * Creates a PartialDataColumn from a DataColumnSidecar.
 */
export function createPartialDataColumn(column: fulu.DataColumnSidecar, _config: BeaconConfig): PartialDataColumn {
  const serialized = ssz.fulu.DataColumnSidecar.serialize(column);
  const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(column.signedBlockHeader.message);
  return new PartialDataColumn(column, serialized, blockRoot);
}

/**
 * Decodes parts metadata bitmap to an array of column indices.
 */
export function decodePartsMetadata(metadata: Uint8Array): number[] {
  const indices: number[] = [];
  for (let byteIdx = 0; byteIdx < metadata.length; byteIdx++) {
    const byte = metadata[byteIdx];
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      if ((byte & (1 << bitIdx)) !== 0) {
        indices.push(byteIdx * 8 + bitIdx);
      }
    }
  }
  return indices;
}

/**
 * Encodes an array of column indices to a parts metadata bitmap.
 */
export function encodePartsMetadata(indices: number[]): Uint8Array {
  const metadata = new Uint8Array(PARTS_METADATA_SIZE);
  for (const index of indices) {
    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;
    metadata[byteIndex] |= 1 << bitIndex;
  }
  return metadata;
}

/**
 * Validation result for partial message metadata.
 */
export interface PartialMetadataValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates parts metadata bitmap for correctness.
 *
 * @param metadata - The parts metadata bitmap to validate
 * @returns Validation result with error message if invalid
 */
export function validatePartsMetadata(metadata: Uint8Array): PartialMetadataValidationResult {
  // Check size matches expected
  if (metadata.length !== PARTS_METADATA_SIZE) {
    return {
      valid: false,
      error: `Invalid metadata size: expected ${PARTS_METADATA_SIZE}, got ${metadata.length}`,
    };
  }

  // Check that indices don't exceed NUMBER_OF_COLUMNS
  const lastByteIndex = PARTS_METADATA_SIZE - 1;
  const remainingBits = NUMBER_OF_COLUMNS % 8;

  // If NUMBER_OF_COLUMNS is not a multiple of 8, check that extra bits are not set
  if (remainingBits > 0) {
    const validMask = (1 << remainingBits) - 1;
    const lastByte = metadata[lastByteIndex];
    if ((lastByte & ~validMask) !== 0) {
      return {
        valid: false,
        error: `Invalid bits set in last byte: column indices exceed ${NUMBER_OF_COLUMNS}`,
      };
    }
  }

  return {valid: true};
}

/**
 * Validates that a column index matches the partial metadata.
 *
 * @param columnIndex - The column index from the DataColumnSidecar
 * @param metadata - The parts metadata bitmap
 * @returns Validation result with error message if invalid
 */
export function validateColumnInMetadata(columnIndex: number, metadata: Uint8Array): PartialMetadataValidationResult {
  if (columnIndex < 0 || columnIndex >= NUMBER_OF_COLUMNS) {
    return {
      valid: false,
      error: `Column index ${columnIndex} out of range [0, ${NUMBER_OF_COLUMNS})`,
    };
  }

  const byteIndex = Math.floor(columnIndex / 8);
  const bitIndex = columnIndex % 8;

  if ((metadata[byteIndex] & (1 << bitIndex)) === 0) {
    return {
      valid: false,
      error: `Column ${columnIndex} not indicated in parts metadata`,
    };
  }

  return {valid: true};
}

/**
 * Counts the number of columns present in the metadata bitmap.
 */
export function countColumnsInMetadata(metadata: Uint8Array): number {
  let count = 0;
  for (const byte of metadata) {
    let b = byte;
    while (b !== 0) {
      count += b & 1;
      b >>= 1;
    }
  }
  return count;
}

/**
 * Checks if all columns are present in the metadata (complete set).
 */
export function isCompleteMetadata(metadata: Uint8Array): boolean {
  const fullBytes = Math.floor(NUMBER_OF_COLUMNS / 8);
  const remainingBits = NUMBER_OF_COLUMNS % 8;

  for (let i = 0; i < fullBytes; i++) {
    if (metadata[i] !== 0xff) {
      return false;
    }
  }

  if (remainingBits > 0) {
    const expectedMask = (1 << remainingBits) - 1;
    if ((metadata[fullBytes] & expectedMask) !== expectedMask) {
      return false;
    }
  }

  return true;
}
