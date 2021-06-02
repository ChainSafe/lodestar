export interface ISyncOptions {
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
}

export const defaultSyncOptions: Required<ISyncOptions> = {
  isSingleNode: false,
  disableProcessAsChainSegment: false,
};
