import {ENRInput} from "@chainsafe/discv5";
import {Eth2GossipsubOpts} from "./gossip/gossipsub.js";
import {GossipHandlerOpts} from "./gossip/handlers/index.js";
import {PeerDiscoveryOpts} from "./peers/discover.js";
import {DEFAULT_P2P_PORT, DEFAULT_TARGET_PEERS, DEFAULT_MAX_PEERS_FACTOR, PeerManagerOpts} from "./peers/index.js";
import {RateLimiterOpts} from "./reqresp/response/rateLimiter.js";

export interface INetworkOptions
  extends Pick<PeerManagerOpts, "targetPeers" | "maxPeers">,
    GossipHandlerOpts,
    RateLimiterOpts,
    Eth2GossipsubOpts {
  discv5?: boolean;
  listenAddress?: string;
  port?: number;
  discoveryPort?: number;
  bootnodes?: string[];
  subscribeAllSubnets?: boolean;
  enr?: ENRInput;
  discv5FirstQueryDelayMs?: PeerDiscoveryOpts["discv5FirstQueryDelayMs"];
  connectToBootnodes?: PeerDiscoveryOpts["connectToBootnodes"];
}

export const defaultNetworkOptions: Required<
  Pick<INetworkOptions, "discv5" | "listenAddress" | "port" | "discoveryPort" | "targetPeers" | "maxPeers">
> = {
  discv5: true,
  listenAddress: "0.0.0.0",
  port: DEFAULT_P2P_PORT,
  discoveryPort: DEFAULT_P2P_PORT,
  targetPeers: DEFAULT_TARGET_PEERS,
  maxPeers: Math.round(DEFAULT_TARGET_PEERS * DEFAULT_MAX_PEERS_FACTOR),
};
