import {SubnetID} from "@lodestar/types";
import {RegistryMetricCreator} from "../../metrics/index.js";
import {ForkBoundaryLabel} from "./gossipsub.js";
import {GossipType} from "./interface.js";

export type Eth2GossipsubMetrics = ReturnType<typeof createEth2GossipsubMetrics>;

export function createEth2GossipsubMetrics(register: RegistryMetricCreator) {
  return {
    gossipPeer: {
      scoreByThreshold: register.gauge<{threshold: string}>({
        name: "lodestar_gossip_peer_score_by_threshold_count",
        help: "Gossip peer score by threshold",
        labelNames: ["threshold"],
      }),
      meshPeersByClient: register.gauge<{client: string}>({
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
      peersByType: register.gauge<{type: GossipType; boundary: ForkBoundaryLabel}>({
        name: "lodestar_gossip_mesh_peers_by_type_count",
        help: "Number of connected mesh peers per gossip type",
        labelNames: ["type", "boundary"],
      }),
      peersByBeaconAttestationSubnet: register.gauge<{subnet: string; boundary: ForkBoundaryLabel}>({
        name: "lodestar_gossip_mesh_peers_by_beacon_attestation_subnet_count",
        help: "Number of connected mesh peers per beacon attestation subnet",
        labelNames: ["subnet", "boundary"],
      }),
      peersBySyncCommitteeSubnet: register.gauge<{subnet: SubnetID; boundary: ForkBoundaryLabel}>({
        name: "lodestar_gossip_mesh_peers_by_sync_committee_subnet_count",
        help: "Number of connected mesh peers per sync committee subnet",
        labelNames: ["subnet", "boundary"],
      }),
      peersByDataColumnSubnet: register.gauge<{subnet: SubnetID; boundary: ForkBoundaryLabel}>({
        name: "lodestar_gossip_mesh_peers_by_data_column_subnet_count",
        help: "Number of connected mesh peers per data column subnet",
        labelNames: ["subnet", "boundary"],
      }),
    },
    gossipTopic: {
      peersByType: register.gauge<{type: GossipType; boundary: ForkBoundaryLabel}>({
        name: "lodestar_gossip_topic_peers_by_type_count",
        help: "Number of connected topic peers per gossip type",
        labelNames: ["type", "boundary"],
      }),
      peersByBeaconAttestationSubnet: register.gauge<{subnet: string; boundary: ForkBoundaryLabel}>({
        name: "lodestar_gossip_topic_peers_by_beacon_attestation_subnet_count",
        help: "Number of connected topic peers per beacon attestation subnet",
        labelNames: ["subnet", "boundary"],
      }),
      peersBySyncCommitteeSubnet: register.gauge<{subnet: SubnetID; boundary: ForkBoundaryLabel}>({
        name: "lodestar_gossip_topic_peers_by_sync_committee_subnet_count",
        help: "Number of connected topic peers per sync committee subnet",
        labelNames: ["subnet", "boundary"],
      }),
      peersByDataColumnSubnet: register.gauge<{subnet: SubnetID; boundary: ForkBoundaryLabel}>({
        name: "lodestar_gossip_topic_peers_by_data_column_subnet_count",
        help: "Number of connected topic peers per data column subnet",
        labelNames: ["subnet", "boundary"],
      }),
    },
  };
}
