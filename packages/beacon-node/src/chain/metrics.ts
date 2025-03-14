import { UpdateHeadOpt } from "@lodestar/fork-choice";
import { NotReorgedReason } from "@lodestar/fork-choice/lib/forkChoice/interface.js";
import { PayloadPreparationType } from "./produceBlock/index.js";
import { RegistryMetricCreator } from "../metrics/utils/registryMetricCreator.js";
import { BlockProductionStep } from "./produceBlock/index.js";

export type ChainMetrics = ReturnType<typeof createChainMetrics>;

export function createChainMetrics(register: RegistryMetricCreator) {
  return {
    forkChoice: {
      findHead: register.histogram<{ caller: string }>({
        name: "beacon_fork_choice_find_head_seconds",
        help: "Time taken to find head in seconds",
        buckets: [0.1, 1, 10],
        labelNames: ["caller"],
      }),
      requests: register.gauge({
        name: "beacon_fork_choice_requests_total",
        help: "Count of occasions where fork choice has tried to find a head",
      }),
      errors: register.gauge<{ entrypoint: UpdateHeadOpt }>({
        name: "beacon_fork_choice_errors_total",
        help: "Count of occasions where fork choice has returned an error when trying to find a head",
        labelNames: ["entrypoint"],
      }),
      changedHead: register.gauge({
        name: "beacon_fork_choice_changed_head_total",
        help: "Count of occasions fork choice has found a new head",
      }),
      // duplicates beacon_reorgs_total from metrics specs
      reorg: register.gauge({
        name: "beacon_fork_choice_reorg_total",
        help: "Count of occasions fork choice has switched to a different chain",
      }),
      reorgDistance: register.histogram({
        name: "beacon_fork_choice_reorg_distance",
        help: "Histogram of re-org distance",
        // We need high resolution in the low range, since re-orgs are a rare but critical event.
        // Add buckets up to 100 to capture high depth re-orgs. Above 100 things are going really bad.
        buckets: [1, 2, 3, 5, 7, 10, 20, 30, 50, 100],
      }),
      votes: register.gauge({
        name: "beacon_fork_choice_votes_count",
        help: "Current count of votes in fork choice data structures",
      }),
      queuedAttestations: register.gauge({
        name: "beacon_fork_choice_queued_attestations_count",
        help: "Count of queued_attestations in fork choice per slot",
      }),
      validatedAttestationDatas: register.gauge({
        name: "beacon_fork_choice_validated_attestation_datas_count",
        help: "Current count of validatedAttestationDatas in fork choice data structures",
      }),
      balancesLength: register.gauge({
        name: "beacon_fork_choice_balances_length",
        help: "Current length of balances in fork choice data structures",
      }),
      nodes: register.gauge({
        name: "beacon_fork_choice_nodes_count",
        help: "Current count of nodes in fork choice data structures",
      }),
      indices: register.gauge({
        name: "beacon_fork_choice_indices_count",
        help: "Current count of indices in fork choice data structures",
      }),
      notReorgedReason: register.gauge<{ reason: NotReorgedReason }>({
        name: "beacon_fork_choice_not_reorged_reason_total",
        help: "Reason why the current head is not re-orged out",
        labelNames: ["reason"],
      }),
    },
    importedBlock: {
      parentBlockDistance: register.histogram({
        name: "beacon_imported_block_parent_distance",
        help: "Histogram of distance to parent block of valid imported blocks",
        buckets: [1, 2, 3, 5, 7, 10, 20, 30, 50, 100],
      }),
    },
    blockProduction: {
      executionBlockProductionTimeSteps: register.histogram<{ step: BlockProductionStep }>({
        name: "beacon_block_production_execution_steps_seconds",
        help: "Detailed steps runtime of execution block production",
        buckets: [0.01, 0.1, 0.2, 0.5, 1],
        labelNames: ["step"],
      }),
      builderBlockProductionTimeSteps: register.histogram<{ step: BlockProductionStep }>({
        name: "beacon_block_production_builder_steps_seconds",
        help: "Detailed steps runtime of builder block production",
        buckets: [0.01, 0.1, 0.2, 0.5, 1],
        labelNames: ["step"],
      }),
      blockProductionCaches: {
        producedBlockRoot: register.gauge({
          name: "beacon_blockroot_produced_cache_total",
          help: "Count of cached produced block roots",
        }),
        producedBlindedBlockRoot: register.gauge({
          name: "beacon_blinded_blockroot_produced_cache_total",
          help: "Count of cached produced blinded block roots",
        }),
        producedContentsCache: register.gauge({
          name: "beacon_contents_produced_cache_total",
          help: "Count of cached produced blob contents",
        }),
      },
    },
    clock: {
      clockSlot: register.gauge({
        name: "beacon_clock_slot",
        help: "Current clock slot",
      }),
      clockEpoch: register.gauge({
        name: "beacon_clock_epoch",
        help: "Current clock epoch",
      }),
    },
    prepareNextSlot: {
      weakHeadDetected: register.gauge({
        name: "beacon_weak_head_detected_total",
        help: "Detected current head block is weak. May reorg it out when proposing next slot. See proposer boost reorg for more",
      }),
    },
    blockPayload: {
      // not used on the dashboard
      payloadAdvancePrepTime: register.histogram({
        name: "beacon_block_payload_prepare_time",
        help: "Time for preparing payload in advance",
        buckets: [0.1, 1, 3, 5, 10],
      }),
      // not used on the dashboard
      payloadFetchedTime: register.histogram<{ prepType: PayloadPreparationType }>({
        name: "beacon_block_payload_fetched_time",
        help: "Time to fetch the payload from EL",
        labelNames: ["prepType"],
      }),
      // not used on the dashboard
      emptyPayloads: register.gauge<{ prepType: PayloadPreparationType }>({
        name: "beacon_block_payload_empty_total",
        help: "Count of payload with empty transactions",
        labelNames: ["prepType"],
      }),
      // not used on the dashboard
      payloadFetchErrors: register.gauge({
        name: "beacon_block_payload_errors_total",
        help: "Count of errors while fetching payloads",
      }),
    },
  };
}
