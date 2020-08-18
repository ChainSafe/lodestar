export interface ISyncOptions {
  blockPerChunk?: number;
  /**
   * max slots to import before waiting for
   * chain to process them
   */
  maxSlotImport?: number;
  minPeers?: number;
}


const config: ISyncOptions = {
  minPeers: 2,
  //2 epochs
  maxSlotImport: 64,
  blockPerChunk: 20
};

export default config;
