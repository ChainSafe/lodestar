import {MetricsRegisterExtra} from "@lodestar/utils";
import {UpdateHeadOpt} from "./forkChoice/forkChoice.js";
import {NotReorgedReason} from "./forkChoice/interface.js";

export type ForkChoiceMetrics = ReturnType<typeof getForkChoiceMetrics>;

export function getForkChoiceMetrics(register: MetricsRegisterExtra) {
  return {
    forkChoice: {
      findHead: register.histogram<{caller: string}>({
        name: "beacon_fork_choice_find_head_seconds",
        help: "Time taken to find head in seconds",
        buckets: [0.1, 1, 10],
        labelNames: ["caller"],
      }),
      requests: register.gauge({
        name: "beacon_fork_choice_requests_total",
        help: "Count of occasions where fork choice has tried to find a head",
      }),
      errors: register.gauge<{entrypoint: UpdateHeadOpt}>({
        name: "beacon_fork_choice_errors_total",
        help: "Count of occasions where fork choice has returned an error when trying to find a head",
        labelNames: ["entrypoint"],
      }),
      changedHead: register.gauge({
        name: "beacon_fork_choice_changed_head_total",
        help: "Count of occasions fork choice has found a new head",
      }),
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
      notReorgedReason: register.counter<{reason: NotReorgedReason}>({
        name: "beacon_fork_choice_not_reorged_reason_total",
        help: "Reason why the current head is not re-orged out",
        labelNames: ["reason"],
      }),
    },
  };
}
