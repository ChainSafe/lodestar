export interface ISyncOptions {
  blockPerChunk: number;
  minPeers: number;
}


const config: ISyncOptions = {
  minPeers: 3,
  blockPerChunk: 20
};

export default config;
