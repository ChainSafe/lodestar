import {Number64} from "@chainsafe/lodestar-types";

export interface INetworkOptions {
  maxPeers: Number64;
  multiaddrs: string[];
  bootnodes: string[];
  rpcTimeout: Number64;
  connectTimeout: number;
  disconnectTimeout: number;
}

const config: INetworkOptions = {
  maxPeers: 25,
  multiaddrs: ["/ip4/127.0.0.1/tcp/30606"],
  bootnodes: [],
  rpcTimeout: 5000,
  connectTimeout: 3000,
  disconnectTimeout: 3000,
};

export default config;
