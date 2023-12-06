import {SLOTS_PER_EPOCH} from "@lodestar/params";

export type SyncOptions = {
  /**
   * Allow node to consider itself synced without being connected to a peer.
   * Use only for local networks with a single node, can be dangerous in regular networks.
   */
  isSingleNode?: boolean;
  /**
   * For RangeSync disable processing batches of blocks at once.
   * Should only be used for debugging or testing.
   */
  disableProcessAsChainSegment?: boolean;

  /** USE FOR TESTING ONLY. Disable range sync completely */
  disableRangeSync?: boolean;
  /** USE FOR TESTING ONLY. Disable unknown block sync completely */
  disableUnknownBlockSync?: boolean;
  /**
   * The batch size of slots for backfill sync can attempt to sync/process before yielding
   * to sync loop. This number can be increased or decreased to make a suitable resource
   * allocation to backfill sync. The default of 0 would mean backfill sync will be skipped
   */
  backfillBatchSize: number;
  /** For testing only, MAX_PENDING_BLOCKS by default */
  maxPendingBlocks?: number;

  /**
   * The number of slots ahead of us that is allowed before starting a RangeSync
   * If a peer is within this tolerance (forwards or backwards), it is treated as a fully sync'd peer.
   *
   * This means that we consider ourselves synced (and hence subscribe to all subnets and block
   * gossip if no peers are further than this range ahead of us that we have not already downloaded
   * blocks for.
   */
  slotImportTolerance?: number;
};

export const defaultSyncOptions: SyncOptions = {
  isSingleNode: false,
  disableProcessAsChainSegment: false,
  /** By default skip the backfill sync */
  backfillBatchSize: 0,
  slotImportTolerance: SLOTS_PER_EPOCH,
};
