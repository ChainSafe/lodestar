import {Number64} from "@chainsafe/lodestar-types";
import Multiaddr from "multiaddr";
import {ENR} from "@chainsafe/discv5";
import {IDiscv5DiscoveryInputOptions} from "./discovery/discv5";

export interface INetworkOptions {
  maxPeers: Number64;
  multiaddrs: string[];
  bootnodes: string[];
  discv5?: IDiscv5DiscoveryInputOptions;
  rpcTimeout: Number64;
  connectTimeout: number;
  disconnectTimeout: number;
}

const config: INetworkOptions = {
  maxPeers: 25,
  multiaddrs: ["/ip4/127.0.0.1/tcp/30606"],
  bootnodes: [],
  discv5: {
    bindAddr: Multiaddr("/ip4/0.0.0.0/udp/5500"),
    enr: new ENR(),
    bootEnrs: [],
  },
  rpcTimeout: 5000,
  connectTimeout: 3000,
  disconnectTimeout: 3000,
};

export default config;
