import {describe, expect, it} from "vitest";
import {StateHashTreeRootSource, scrapeNativeStateTransitionMetrics} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {createMetrics} from "../../../src/metrics/index.js";
import {createMetricsTest} from "./utils.js";

describe("Metrics", () => {
  it("should get default metrics from register", async () => {
    const metrics = createMetricsTest();
    const metricsAsArray = metrics.register.getMetricsAsArray();
    const metricsAsText = await metrics.register.metrics();
    expect(metricsAsArray.length).toBeGreaterThan(0);
    expect(metricsAsText).not.toBe("");
  });

  it("can exclude state-transition metrics from the registry", async () => {
    const state = ssz.phase0.BeaconState.defaultViewDU();
    const metrics = createMetrics({enabled: true, port: 0}, state.genesisTime, [], {
      includeStateTransitionMetrics: false,
    });
    metrics.close();

    const metricsAsText = await metrics.register.metrics();
    expect(metricsAsText).not.toContain("lodestar_stfn_process_block_seconds");
    expect(metricsAsText).not.toContain("lodestar_stfn_validators_in_activation_queue");
    expect(metricsAsText).not.toContain("lodestar_stfn_balances_nodes_populated_hit_total");
  });

  it("routes external state hash tree root observations to native metrics", async () => {
    const state = ssz.phase0.BeaconState.defaultViewDU();
    const metrics = createMetrics({enabled: true, port: 0}, state.genesisTime, [], {
      includeStateTransitionMetrics: false,
    });

    metrics.stateHashTreeRootTime.observe({source: StateHashTreeRootSource.blockTransition}, 0.125);
    metrics.close();

    expect(await metrics.register.metrics()).not.toContain("lodestar_stfn_hash_tree_root_seconds");
    expect(scrapeNativeStateTransitionMetrics()).toContain(
      'lodestar_stfn_hash_tree_root_seconds_count{source="block_transition"}'
    );
  });
});
