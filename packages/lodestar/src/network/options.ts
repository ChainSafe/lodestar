import {ENR, IDiscv5DiscoveryInputOptions} from "@chainsafe/discv5";
import {PeerManagerOpts} from "./peers";
import {RateTrackerOpts} from "./reqresp/response/rateTracker";

export interface INetworkOptions extends PeerManagerOpts, RateTrackerOpts {
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
  // rate tracker options per 1 minute
  // per peer per minute, allow to serve up to 5 requests and 500 blocks
  // total: make 4x peer params
  requestCountTotalLimit: 20,
  requestCountPeerLimit: 5,
  blockCountTotalLimit: 2000,
  blockCountPeerLimit: 500,
  rateTrackerTimeoutMs: 60 * 1000,
  discv5: defaultDiscv5Options,
};
