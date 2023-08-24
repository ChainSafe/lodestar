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
  maxYoungGenerationSizeMb?: number;
}

export const defaultNetworkOptions: NetworkOptions = {
  maxPeers: 55, // Allow some room above targetPeers for new inbound peers
  targetPeers: 50,
  localMultiaddrs: ["/ip4/0.0.0.0/tcp/9000"],
  bootMultiaddrs: [],
  /** disabled by default */
  discv5: null,
  rateLimitMultiplier: 1,
  useWorker: true,
  // default set via research in https://github.com/ChainSafe/lodestar/issues/2115
  maxYoungGenerationSizeMb: 152,
  // subscribe to 2 subnets per node since v1.10
  deterministicLongLivedAttnets: true,
  // subscribe 2 slots before aggregator dutied slot to get stable mesh peers as monitored on goerli
  slotsToSubscribeBeforeAggregatorDuty: 2,
  // this should only be set to true if useWorker is true
  beaconAttestationBatchValidation: true,
};
