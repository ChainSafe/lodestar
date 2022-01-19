import {ENR, IDiscv5DiscoveryInputOptions} from "@chainsafe/discv5";
import {defaultGossipHandlerOpts, GossipHandlerOpts} from "./gossip/handlers";
import {PeerManagerOpts} from "./peers";
import {defaultRateLimiterOpts, RateLimiterOpts} from "./reqresp/response/rateLimiter";

export interface INetworkOptions extends PeerManagerOpts, RateLimiterOpts, GossipHandlerOpts {
  localMultiaddrs: string[];
  bootMultiaddrs?: string[];
  subscribeAllSubnets?: boolean;
  connectToDiscv5Bootnodes?: boolean;
}

export const defaultDiscv5Options: IDiscv5DiscoveryInputOptions = {
  bindAddr: "/ip4/0.0.0.0/udp/9000",
  enr: new ENR(),
  bootEnrs: [],
  enrUpdate: true,
  enabled: true,
};

export const defaultNetworkOptions: INetworkOptions = {
  maxPeers: 30, // Allow some room above targetPeers for new inbound peers
  targetPeers: 25,
  discv5FirstQueryDelayMs: 1000,
  localMultiaddrs: ["/ip4/0.0.0.0/tcp/9000"],
  bootMultiaddrs: [],
  discv5: defaultDiscv5Options,
  ...defaultRateLimiterOpts,
  ...defaultGossipHandlerOpts,
};
