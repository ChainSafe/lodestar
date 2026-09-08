import {describe, expect, it} from "vitest";
import {createNativeStateHashTreeRootMetric, scrapeNativeStateTransitionMetrics} from "../../src/nativeMetrics.js";
import {StateHashTreeRootSource} from "../../src/stateTransition.js";

describe("native state-transition metrics", () => {
  it("records external hash tree root observations in the native registry", () => {
    const metric = createNativeStateHashTreeRootMetric();

    metric.observe({source: StateHashTreeRootSource.blockTransition}, 0.125);
    const endTimer = metric.startTimer({source: StateHashTreeRootSource.prepareNextSlot});
    endTimer();

    const output = scrapeNativeStateTransitionMetrics();
    expect(output).toContain('lodestar_stfn_hash_tree_root_seconds_count{source="block_transition"} 1');
    expect(output).toContain('lodestar_stfn_hash_tree_root_seconds_sum{source="block_transition"} 0.125');
    expect(output).toContain('lodestar_stfn_hash_tree_root_seconds_count{source="prepare_next_slot"} 1');
  });
});
