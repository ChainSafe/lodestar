import {Eth2GossipsubOpts} from "./gossip/gossipsub.js";
import {PeerManagerOpts, PeerRpcScoreOpts} from "./peers/index.js";
import {NetworkProcessorOpts} from "./processor/index.js";
import {ReqRespBeaconNodeOpts} from "./reqresp/ReqRespBeaconNode.js";
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

  /**
   * During E2E tests observe a lot of following `missing stream`:
   *
   * > libp2p:mplex receiver stream with id 2 and protocol /eth2/beacon_chain/req/metadata/2/ssz_snappy ended
   * > libp2p:mplex initiator stream with id 4 and protocol /eth2/beacon_chain/req/metadata/2/ssz_snappy ended
   * > libp2p:mplex initiator stream with id 2 and protocol /eth2/beacon_chain/req/metadata/2/ssz_snappy ended
   * > libp2p:mplex missing stream 2 for message type CLOSE_INITIATOR
   * > libp2p:mplex missing stream 2 for message type CLOSE_RECEIVER
   * > libp2p:mplex missing stream 4 for message type CLOSE_INITIATOR
   *
   * which results in following rate-limit error and cause the connection to close and fail the e2e tests
   * > libp2p:mplex rate limit hit when receiving messages for streams that do not exist - closing remote connection
   * > libp2p:mplex:stream:initiator:3 abort with error Error: Too many messages for missing streams
   *
   * The default value for `disconnectThreshold` in libp2p is set to `5`.
   * We need to increase this only for the testing purpose
   */
  disconnectThreshold?: number;
}

export const defaultNetworkOptions: NetworkOptions = {
  maxPeers: 210, // Allow some room above targetPeers for new inbound peers
  targetPeers: 200,
  localMultiaddrs: ["/ip4/0.0.0.0/tcp/9000", "/ip6/::/tcp/9000"],
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
  // specific option for fulu
  //   - this is the same to TARGET_SUBNET_PEERS
  //   - for fusaka-devnets, we have 25-30 peers per subnet
  //   - for public testnets or mainnet, average number of peers per group is SAMPLES_PER_SLOT * targetPeers / NUMBER_OF_CUSTODY_GROUPS = 6.25 so this should not be an issue
  targetGroupPeers: 6,
};
