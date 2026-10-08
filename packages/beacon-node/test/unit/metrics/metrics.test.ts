import {describe, expect, it} from "vitest";
import {StateHashTreeRootSource} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {createMetrics} from "../../../src/metrics/index.js";
import {GossipType} from "../../../src/network/gossip/interface.js";
import {createMetricsTest} from "./utils.js";

describe("Metrics", () => {
  it.each([true, false])("registers JS networking metrics only when enabled: %s", async (enabled) => {
    const metrics = createMetrics({enabled: true, port: 0}, 0, [], {
      includeNetworkJsMetrics: enabled,
      collectNodeMetrics: false,
    });
    try {
      expect(metrics.networkJs !== null).toBe(enabled);
      const names = new Set(metrics.register.getMetricsAsArray().map((metric) => metric.name));
      for (const name of [
        "lodestar_gossip_validation_queue_length",
        "lodestar_gossip_validation_queue_concurrency",
        "lodestar_awaiting_block_gossip_messages_total",
        "lodestar_awaiting_payload_gossip_messages_total",
        "lodestar_network_processor_execute_work_calls_total",
        "lodestar_network_worker_handler_reqresp_bridge_req_caller_pending_count",
        "lodestar_network_worker_wire_events_on_main_thread_latency_seconds",
      ]) {
        expect(names.has(name), name).toBe(enabled);
      }
      metrics.networkProcessor.gossipValidationAccept.inc({topic: GossipType.beacon_block});
      metrics.gossipValidationQueue.jobTime.observe({topic: GossipType.beacon_block}, 0.125);
      const text = await metrics.register.metrics();
      expect(text).toContain('lodestar_gossip_validation_accept_total{topic="beacon_block"} 1');
      expect(text).toContain('lodestar_gossip_validation_queue_job_time_seconds_sum{topic="beacon_block"} 0.125');
    } finally {
      metrics.close();
    }
  });

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

    expect(metrics.stateTransition).toBeNull();
    const metricsAsText = await metrics.register.metrics();
    expect(metricsAsText).not.toContain("lodestar_stfn_process_block_seconds");
    expect(metricsAsText).not.toContain("lodestar_stfn_validators_in_activation_queue");
    expect(metricsAsText).not.toContain("lodestar_stfn_balances_nodes_populated_hit_total");
  });

  it("keeps state hash tree root metrics when state-transition metrics are excluded", async () => {
    const state = ssz.phase0.BeaconState.defaultViewDU();
    const metrics = createMetrics({enabled: true, port: 0}, state.genesisTime, [], {
      includeStateTransitionMetrics: false,
    });

    metrics.stateHashTreeRootTime.observe({source: StateHashTreeRootSource.blockTransition}, 0.125);
    metrics.close();

    const metricsAsText = await metrics.register.metrics();
    expect(metricsAsText).toContain('lodestar_stfn_hash_tree_root_seconds_count{source="block_transition"} 1');
    expect(metricsAsText).toContain('lodestar_stfn_hash_tree_root_seconds_sum{source="block_transition"} 0.125');
  });
});
