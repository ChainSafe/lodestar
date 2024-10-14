import {Eth2GossipsubOpts} from "./gossip/gossipsub.js";
import {PeerManagerOpts, PeerRpcScoreOpts} from "./peers/index.js";
import {ReqRespBeaconNodeOpts} from "./reqresp/ReqRespBeaconNode.js";
import {NetworkProcessorOpts} from "./processor/index.js";
import {SubnetsServiceOpts} from "./subnets/interface.js";

// Since Network is eventually intended to be run in a separate thread, ensure that all options are cloneable using structuredClone
export interface NetworkOptions
  extends PeerManagerOpts,
    // remove all Functions
    Omit<ReqRespBeaconNodeOpts, "getPeerLogMetadata" | "onRateLimit" | "disableLightClientServer">,
    NetworkProcessorOpts,
    PeerRpcScoreOpts,
    SubnetsServiceOpts,
    Omit<Eth2GossipsubOpts, "disableLightClientServer"> {
  localMultiaddrs: string[];
  bootMultiaddrs?: string[];
  subscribeAllSubnets?: boolean;
  mdns?: boolean;
  connectToDiscv5Bootnodes?: boolean;
  version?: string;
  private?: boolean;
  useWorker?: boolean;
  maxYoungGenerationSizeMb?: number;
  disableLightClientServer?: boolean;
  disableQuic?: boolean;
}

export const defaultNetworkOptions: NetworkOptions = {
  maxPeers: 110, // Allow some room above targetPeers for new inbound peers
  targetPeers: 100,
  // this default is never used, in practice, it is always overridden by the cli
  localMultiaddrs: ["/ip4/0.0.0.0/tcp/9000", "/ip4/0.0.0.0/udp/9001/quic-v1"],
  bootMultiaddrs: [],
  /** disabled by default */
  discv5: null,
  rateLimitMultiplier: 1,
  useWorker: true,
  // set after testing before 1.19.0, see https://github.com/ChainSafe/lodestar/issues/6596
  disableFloodPublish: true,
  // default set via research in https://github.com/ChainSafe/lodestar/issues/2115
  maxYoungGenerationSizeMb: 152,
  // subscribe 2 slots before aggregator dutied slot to get stable mesh peers as monitored on goerli
  slotsToSubscribeBeforeAggregatorDuty: 2,
  // This will enable the light client server by default
  disableLightClientServer: false,
  // enable quic by default
  disableQuic: false,
};
