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
  /** USE FOR TESTING ONLY. Disable range sync completely */
  disableUnknownBlockSync?: boolean;
};

export const defaultSyncOptions: SyncOptions = {
  isSingleNode: false,
  disableProcessAsChainSegment: false,
};
