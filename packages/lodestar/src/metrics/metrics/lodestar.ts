import {RegistryMetricCreator} from "../utils/registryMetricCreator";
import {readLodestarGitData} from "../utils/gitData";

export type ILodestarMetrics = ReturnType<typeof createLodestarMetrics>;

/**
 * Extra Lodestar custom metrics
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function createLodestarMetrics(register: RegistryMetricCreator) {
  // Private - only used once now
  register.static<"semver" | "branch" | "commit" | "version">({
    name: "lodestar_version",
    help: "Lodestar version",
    value: readLodestarGitData(),
  });

  return {
    peersByDirection: register.gauge<"direction">({
      name: "lodestar_peers_by_direction",
      help: "number of peers, labeled by direction",
      labelNames: ["direction"],
    }),
    peerConnectedEvent: register.gauge<"direction">({
      name: "lodestar_peer_connected",
      help: "Number of peer:connected event, labeled by direction",
      labelNames: ["direction"],
    }),
    peerDisconnectedEvent: register.gauge<"direction">({
      name: "lodestar_peer_disconnected",
      help: "Number of peer:disconnected event, labeled by direction",
      labelNames: ["direction"],
    }),
    peerGoodbyeReceived: register.gauge<"reason">({
      name: "lodestar_peer_goodbye_received",
      help: "Number of goodbye received, labeled by reason",
      labelNames: ["reason"],
    }),
    peerGoodbyeSent: register.gauge<"reason">({
      name: "lodestar_peer_goodbye_sent",
      help: "Number of goodbye sent, labeled by reason",
      labelNames: ["reason"],
    }),
    peersTotalUniqueConnected: register.gauge({
      name: "lodestar_peers_total_unique_connected",
      help: "Total number of unique peers that have had a connection with",
    }),

    gossipMeshPeersByType: register.gauge<"gossipType">({
      name: "lodestar_gossip_mesh_peers_by_type",
      help: "Number of connected mesh peers per gossip type",
      labelNames: ["gossipType"],
    }),
    gossipMeshPeersByBeaconAttestationSubnet: register.gauge<"subnet">({
      name: "lodestar_gossip_mesh_peers_by_beacon_attestation_subnet",
      help: "Number of connected mesh peers per beacon attestation subnet",
      labelNames: ["subnet"],
    }),

    gossipValidationQueueLength: register.gauge<"topic">({
      name: "lodestar_gossip_validation_queue_length",
      help: "Count of total gossip validation queue length",
      labelNames: ["topic"],
    }),
    gossipValidationQueueDroppedJobs: register.gauge<"topic">({
      name: "lodestar_gossip_validation_queue_dropped_jobs_total",
      help: "Count of total gossip validation queue dropped jobs",
      labelNames: ["topic"],
    }),
    gossipValidationQueueJobTime: register.histogram<"topic">({
      name: "lodestar_gossip_validation_queue_job_time_seconds",
      help: "Time to process gossip validation queue job in seconds",
      labelNames: ["topic"],
    }),

    blockProcessorQueueLength: register.gauge<"topic">({
      name: "lodestar_block_processor_queue_length",
      help: "Count of total block processor queue length",
      labelNames: ["topic"],
    }),
    blockProcessorQueueDroppedJobs: register.gauge<"topic">({
      name: "lodestar_block_processor_queue_dropped_jobs_total",
      help: "Count of total block processor queue dropped jobs",
      labelNames: ["topic"],
    }),
    blockProcessorQueueJobTime: register.histogram<"topic">({
      name: "lodestar_block_processor_queue_job_time_seconds",
      help: "Time to process block processor queue job in seconds",
      labelNames: ["topic"],
    }),
  };
}
