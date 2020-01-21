import {number64} from "@chainsafe/eth2.0-types";

export interface INetworkOptions {
  maxPeers: number64;
  multiaddrs: string[];
  bootnodes: string[];
  rpcTimeout: number64;
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
