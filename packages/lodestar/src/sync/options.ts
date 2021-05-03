export interface ISyncOptions {
  /**
   * Allow node to consider itself synced without being connected to a peer.
   * Use only for local networks with a single node, can be dangerous in regular networks.
   */
  isSingleNode?: boolean;
}

export const defaultSyncOptions: Required<ISyncOptions> = {
  isSingleNode: false,
};
