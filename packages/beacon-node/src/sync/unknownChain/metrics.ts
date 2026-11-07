import {RegistryMetricCreator} from "../../metrics/utils/registryMetricCreator.js";
import {ChainState} from "./backwardsChain.js";

export type UnknownChainSyncMetrics = ReturnType<typeof createUnknownChainSyncMetrics>;

export function createUnknownChainSyncMetrics(register: RegistryMetricCreator) {
  return {
    register,

    headerCount: register.gauge({
      name: "lodestar_unknown_chain_sync_header_count",
      help: "number of headers in unknown chains being synced",
    }),
    chainCount: register.gauge<{state: ChainState}>({
      name: "lodestar_unknown_chain_sync_chain_count",
      help: "number of unknown chains being synced",
      labelNames: ["state"],
    }),
    chainHeaders: register.histogram({
      name: "lodestar_unknown_chain_sync_chain_headers",
      help: "number of headers in unknown chains being synced",
      buckets: [1, 5, 10, 15, 20],
    }),
    chainPeers: register.histogram({
      name: "lodestar_unknown_chain_sync_chain_peers",
      help: "number of peers in unknown chains being synced",
      buckets: [1, 5, 10, 15, 20],
    }),

    processorQueue: {
      length: register.gauge({
        name: "lodestar_unknown_chain_sync_processor_queue_length",
        help: "Count of total regen queue length",
      }),
      droppedJobs: register.gauge({
        name: "lodestar_unknown_chain_sync_processor_queue_dropped_jobs_total",
        help: "Count of total regen queue dropped jobs",
      }),
      jobTime: register.histogram({
        name: "lodestar_unknown_chain_sync_processor_queue_job_time_seconds",
        help: "Time to process regen queue job in seconds",
        buckets: [0.01, 0.1, 1, 10, 100],
      }),
      jobWaitTime: register.histogram({
        name: "lodestar_unknown_chain_sync_processor_queue_job_wait_time_seconds",
        help: "Time from job added to the regen queue to starting in seconds",
        buckets: [0.01, 0.1, 1, 10, 100],
      }),
      concurrency: register.gauge({
        name: "lodestar_unknown_chain_sync_processor_queue_concurrency",
        help: "Current concurrency of regen queue",
      }),
    },
  };
}
