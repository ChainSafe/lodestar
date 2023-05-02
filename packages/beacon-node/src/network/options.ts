import {generateKeypair, IDiscv5DiscoveryInputOptions, KeypairType, SignableENR} from "@chainsafe/discv5";
import {Eth2GossipsubOpts} from "./gossip/gossipsub.js";
import {defaultGossipHandlerOpts} from "./processor/gossipHandlers.js";
import {PeerManagerOpts} from "./peers/index.js";
import {ReqRespBeaconNodeOpts} from "./reqresp/ReqRespBeaconNode.js";
import {NetworkProcessorOpts} from "./processor/index.js";

// Since Network is eventually intended to be run in a separate thread, ensure that all options are cloneable using structuredClone
export interface NetworkOptions
  extends PeerManagerOpts,
    // remove all Functions
    Omit<ReqRespBeaconNodeOpts, "getPeerLogMetadata" | "onRateLimit">,
    NetworkProcessorOpts,
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
  // TODO: this value is 12 per spec, however lodestar has performance issue if there are too many mesh peers
  // see https://github.com/ChainSafe/lodestar/issues/5420
  gossipsubDHigh: 9,
  // TODO: with this value, lodestar drops about 35% of attestation messages on a test mainnet node subscribed to all subnets
  // see https://github.com/ChainSafe/lodestar/issues/5441
  maxGossipTopicConcurrency: 512,
  ...defaultGossipHandlerOpts,
};
