import {generateKeypair, IDiscv5DiscoveryInputOptions, KeypairType, SignableENR} from "@chainsafe/discv5";
import {Eth2GossipsubOpts} from "./gossip/gossipsub.js";
import {defaultGossipHandlerOpts, GossipHandlerOpts} from "./gossip/handlers/index.js";
import {PeerManagerOpts} from "./peers/index.js";
import {ReqRespBeaconNodeOpts} from "./reqresp/ReqRespBeaconNode.js";

// Since Network is eventually intended to be run in a separate thread, ensure that all options are cloneable using structuredClone
export interface NetworkOptions
  extends PeerManagerOpts,
    // remove all Functions
    Omit<ReqRespBeaconNodeOpts, "getPeerLogMetadata" | "onRateLimit">,
    GossipHandlerOpts,
    Eth2GossipsubOpts {
  localMultiaddrs: string[];
  bootMultiaddrs?: string[];
  subscribeAllSubnets?: boolean;
  mdns: boolean;
  connectToDiscv5Bootnodes?: boolean;
  version?: string;
}

export const defaultDiscv5Options: IDiscv5DiscoveryInputOptions = {
  bindAddr: "/ip4/0.0.0.0/udp/9000",
  enr: SignableENR.createV4(generateKeypair(KeypairType.Secp256k1)),
  bootEnrs: [],
  enrUpdate: true,
  enabled: true,
};

export const defaultNetworkOptions: NetworkOptions = {
  maxPeers: 55, // Allow some room above targetPeers for new inbound peers
  targetPeers: 50,
  discv5FirstQueryDelayMs: 1000,
  localMultiaddrs: ["/ip4/0.0.0.0/tcp/9000"],
  bootMultiaddrs: [],
  mdns: false,
  discv5: defaultDiscv5Options,
  rateLimitMultiplier: 1,
  ...defaultGossipHandlerOpts,
};
