export interface ISyncOptions {
  blockPerChunk: number;
  /**
   * max slots to import before waiting for
   * chain to process them
   */
  maxSlotImport: bigint;
  minPeers: number;
}


const config: ISyncOptions = {
  minPeers: 2,
  //2 epochs
  maxSlotImport: 64n,
  blockPerChunk: 20
};

export default config;
