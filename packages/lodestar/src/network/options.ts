import {Number64} from "@chainsafe/lodestar-types";
import {ENR, IDiscv5DiscoveryInputOptions} from "@chainsafe/discv5";

export interface INetworkOptions {
  // Must be defined for ILibp2pOptions.maxConnections or the libp2p.ConnectionManager throws
  maxPeers: Number64;
  localMultiaddrs: string[];
  bootMultiaddrs: string[];
  discv5?: IDiscv5DiscoveryInputOptions;
  rpcTimeout: Number64;
  connectTimeout: number;
  disconnectTimeout: number;
}

export const defaultDiscv5Options: IDiscv5DiscoveryInputOptions = {
  bindAddr: "/ip4/0.0.0.0/udp/9000",
  enr: new ENR(),
  bootEnrs: [],
  enrUpdate: true,
};

export const defaultNetworkOptions: INetworkOptions = {
  maxPeers: 25,
  localMultiaddrs: ["/ip4/0.0.0.0/tcp/9000"],
  bootMultiaddrs: [],
  discv5: defaultDiscv5Options,
  rpcTimeout: 5000,
  connectTimeout: 3000,
  disconnectTimeout: 3000,
};
