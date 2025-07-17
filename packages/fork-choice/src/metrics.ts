import {MetricsRegister} from "@lodestar/utils";
import {FCInclusionListSource} from "./index.js";

export type BeaconForkChoiceMetrics = ReturnType<typeof getForkChoiceMetrics>;

/**
 * A collection of metrics used throughout the Fork Choice.
 */
export function getForkChoiceMetrics(register: MetricsRegister) {
  return {
    inclusionListEquivocating: register.counter<{source: FCInclusionListSource}>({
      name: "beacon_equivocating_inclusion_lists_total",
      help: "Total number of equivocating inclusion lists",
      labelNames: ["source"],
    }),
    inclusionListFirstSeenInSLot: register.histogram({
      name: "beacon_inclusion_list_first_seen_in_slot",
      help: "First inclusion list seen in slot",
      buckets: [0, 1, 2, 3, 4, 6, 10, 12],
    }),
  };
}
