import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {EPOCHS_PER_BATCH} from "./constants";

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
  /**
   * The batch size of slots for backfill sync can attempt to sync/process before yielding
   * to sync loop. This number can be increased or decreased to make a suitable resource
   * allocation to backfill sync.
   */
  backfillBatchSize?: number;
  /** USE FOR TESTING ONLY. Disable range sync completely */
  disableRangeSync?: boolean;
  /** USE FOR TESTING ONLY. Disable range sync completely */
  disableUnknownBlockSync?: boolean;
};

export const defaultSyncOptions: SyncOptions = {
  isSingleNode: false,
  disableProcessAsChainSegment: false,
  backfillBatchSize: EPOCHS_PER_BATCH * SLOTS_PER_EPOCH,
};
