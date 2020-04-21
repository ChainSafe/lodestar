export interface ISyncOptions {
  blockPerChunk: number;
  minPeers: number;
}


const config: ISyncOptions = {
  minPeers: 1,
  blockPerChunk: 20
};

export default config;
