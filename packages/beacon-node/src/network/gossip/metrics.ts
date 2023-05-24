import {RegistryMetricCreator} from "../../metrics/index.js";

export type Eth2GossipsubMetrics = ReturnType<typeof createEth2GossipsubMetrics>;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createEth2GossipsubMetrics(register: RegistryMetricCreator) {
  return {
    gossipPeer: {
      scoreByThreshold: register.gauge<"threshold">({
        name: "lodestar_gossip_peer_score_by_threshold_count",
        help: "Gossip peer score by threshold",
        labelNames: ["threshold"],
      }),
      meshPeersByClient: register.gauge<"client">({
        name: "lodestar_gossip_mesh_peers_by_client_count",
        help: "number of mesh peers, labeled by client",
        labelNames: ["client"],
      }),
      score: register.avgMinMax({
        name: "lodestar_gossip_score_avg_min_max",
        help: "Avg min max of all gossip peer scores",
      }),
    },
    gossipMesh: {
      peersByType: register.gauge<"type" | "fork">({
        name: "lodestar_gossip_mesh_peers_by_type_count",
        help: "Number of connected mesh peers per gossip type",
        labelNames: ["type", "fork"],
      }),
      peersByBeaconAttestationSubnet: register.gauge<"subnet" | "fork">({
        name: "lodestar_gossip_mesh_peers_by_beacon_attestation_subnet_count",
        help: "Number of connected mesh peers per beacon attestation subnet",
        labelNames: ["subnet", "fork"],
      }),
      peersBySyncCommitteeSubnet: register.gauge<"subnet" | "fork">({
        name: "lodestar_gossip_mesh_peers_by_sync_committee_subnet_count",
        help: "Number of connected mesh peers per sync committee subnet",
        labelNames: ["subnet", "fork"],
      }),
    },
    gossipTopic: {
      peersByType: register.gauge<"type" | "fork">({
        name: "lodestar_gossip_topic_peers_by_type_count",
        help: "Number of connected topic peers per gossip type",
        labelNames: ["type", "fork"],
      }),
      peersByBeaconAttestationSubnet: register.gauge<"subnet" | "fork">({
        name: "lodestar_gossip_topic_peers_by_beacon_attestation_subnet_count",
        help: "Number of connected topic peers per beacon attestation subnet",
        labelNames: ["subnet", "fork"],
      }),
      peersBySyncCommitteeSubnet: register.gauge<"subnet" | "fork">({
        name: "lodestar_gossip_topic_peers_by_sync_committee_subnet_count",
        help: "Number of connected topic peers per sync committee subnet",
        labelNames: ["subnet", "fork"],
      }),
    },
  };
}
