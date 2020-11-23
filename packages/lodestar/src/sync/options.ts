export interface ISyncOptions {
  blockPerChunk?: number;
  /**
   * max slots to import before waiting for
   * chain to process them
   */
  maxSlotImport?: number;
  minPeers?: number;
}

export const defaultSyncOptions: Required<ISyncOptions> = {
  minPeers: 4,
  //2 epochs
  maxSlotImport: 64,
  blockPerChunk: 64,
};
