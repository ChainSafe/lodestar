import {Eth2GossipsubOpts} from "./gossip/gossipsub.js";
import {PeerManagerOpts, PeerRpcScoreOpts} from "./peers/index.js";
import {ReqRespBeaconNodeOpts} from "./reqresp/ReqRespBeaconNode.js";
import {NetworkProcessorOpts} from "./processor/index.js";
import {SubnetsServiceOpts} from "./subnets/interface.js";

// Since Network is eventually intended to be run in a separate thread, ensure that all options are cloneable using structuredClone
export interface NetworkOptions
  extends PeerManagerOpts,
    // remove all Functions
    Omit<ReqRespBeaconNodeOpts, "getPeerLogMetadata" | "onRateLimit">,
    NetworkProcessorOpts,
    PeerRpcScoreOpts,
    SubnetsServiceOpts,
    Eth2GossipsubOpts {
  localMultiaddrs: string[];
  bootMultiaddrs?: string[];
  subscribeAllSubnets?: boolean;
  mdns?: boolean;
  connectToDiscv5Bootnodes?: boolean;
  version?: string;
  private?: boolean;
  useWorker?: boolean;
}

export const defaultNetworkOptions: NetworkOptions = {
  maxPeers: 55, // Allow some room above targetPeers for new inbound peers
  targetPeers: 50,
  localMultiaddrs: ["/ip4/0.0.0.0/tcp/9000"],
  bootMultiaddrs: [],
  /** disabled by default */
  discv5: null,
  rateLimitMultiplier: 1,
  // TODO: this value is 12 per spec, however lodestar has performance issue if there are too many mesh peers
  // see https://github.com/ChainSafe/lodestar/issues/5420
  gossipsubDHigh: 9,
  // TODO set to false in order to release 1.9.0 in a timely manner
  useWorker: false,
};
