import {describe, expect, it, vi} from "vitest";

const metrics = vi.hoisted(() => ({
  init: vi.fn(),
  scrapeMetrics: vi.fn(
    () => `# HELP lodestar_stfn_epoch_transition_seconds State transition
# TYPE lodestar_stfn_epoch_transition_seconds histogram
lodestar_stfn_epoch_transition_seconds_count 1
# HELP validator_monitor_prev_epoch_on_chain_balance Validator balance
# TYPE validator_monitor_prev_epoch_on_chain_balance gauge
validator_monitor_prev_epoch_on_chain_balance 32000000000
`
  ),
}));

vi.mock("@chainsafe/lodestar-z", () => ({default: {metrics}}));

import {
  initNativeStateTransitionMetrics,
  scrapeNativeStateTransitionMetrics,
  scrapeNativeValidatorMonitorMetrics,
} from "../../src/nativeMetrics.js";

describe("native metrics", () => {
  it("separates state transition and validator monitor metrics", () => {
    initNativeStateTransitionMetrics();

    const stateTransitionMetrics = scrapeNativeStateTransitionMetrics();
    const validatorMonitorMetrics = scrapeNativeValidatorMonitorMetrics();

    expect(stateTransitionMetrics).toContain("lodestar_stfn_epoch_transition_seconds");
    expect(stateTransitionMetrics).not.toContain("validator_monitor_");
    expect(validatorMonitorMetrics).toContain("validator_monitor_prev_epoch_on_chain_balance");
    expect(validatorMonitorMetrics).not.toContain("lodestar_stfn_");
  });
});
