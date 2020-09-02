import {Number64} from "@chainsafe/lodestar-types";
import {ENR, IDiscv5DiscoveryInputOptions} from "@chainsafe/discv5";

export interface INetworkOptions {
  maxPeers: Number64;
  localMultiaddrs: string[];
  bootMultiaddrs: string[];
  discv5?: IDiscv5DiscoveryInputOptions;
  rpcTimeout: Number64;
  connectTimeout: number;
  disconnectTimeout: number;
}

const config: INetworkOptions = {
  maxPeers: 25,
  localMultiaddrs: ["/ip4/0.0.0.0/tcp/9000"],
  bootMultiaddrs: [],
  discv5: {
    bindAddr: "/ip4/0.0.0.0/udp/9000",
    enr: new ENR(),
    bootEnrs: [],
    enrUpdate: true,
  },
  rpcTimeout: 5000,
  connectTimeout: 3000,
  disconnectTimeout: 3000,
};

export default config;
