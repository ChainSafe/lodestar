import {expect} from "vitest";
import {
  BeaconStateTransitionMetrics,
  BeaconStateView,
  IBeaconStateView,
  beforeProcessEpoch,
  getMetrics,
} from "@lodestar/state-transition";
import {Metrics, RegistryMetricCreator, createMetrics} from "../../../src/metrics/index.js";

export const progressiveBalancesMismatchesMetricName = "lodestar_stfn_progressive_balances_mismatches_total";

export function createSpecTestMetrics(): {metrics: BeaconStateTransitionMetrics; register: RegistryMetricCreator} {
  const register = new RegistryMetricCreator();
  const metrics = getMetrics(register);

  return {metrics, register};
}

export function createSpecTestBeaconMetrics(genesisTime: number): Metrics {
  // Skip Node.js/default process metrics: `collectDefaultMetrics` enables a perf_hooks
  // event-loop-delay monitor that is never disabled, which keeps the whole registry alive.
  // Building one full `Metrics` per fork-choice test case and wiring it into `BeaconChain`
  // then retains every closed chain (and its cached states) via the gauge `addCollect`
  // closures, growing unbounded and OOM-ing the mainnet spec-test worker. The assertions
  // only read counters, so process-level collectors are not needed.
  const metrics = createMetrics({enabled: true, port: 0}, genesisTime, [], {collectNodeMetrics: false});
  // `close()` removes the `unhandledRejection` listener added by `createMetrics`.
  metrics.close();
  return metrics;
}

export async function expectNoProgressiveBalancesMismatches(
  register: RegistryMetricCreator,
  testCaseName: string
): Promise<void> {
  const metrics = await register.getMetricsAsJSON();
  const metric = metrics.find(({name}) => name === progressiveBalancesMismatchesMetricName);
  const mismatches = metric?.values.reduce((sum, {value}) => sum + value, 0) ?? 0;

  expect(mismatches, `${testCaseName} incremented ${progressiveBalancesMismatchesMetricName}`).toBe(0);
}

export function expectValidProgressiveBalances(state: IBeaconStateView, metrics: BeaconStateTransitionMetrics): void {
  const cachedState = (state as BeaconStateView).cachedState;
  expect(cachedState, "progressive balance validation expects a BeaconStateView").toBeDefined();
  beforeProcessEpoch(cachedState.clone(true), metrics);
}

export async function expectInvalidStateTransitionWithNoProgressiveBalancesMismatches(
  transition: () => unknown,
  register: RegistryMetricCreator,
  testCaseName: string
): Promise<void> {
  let didThrow = false;
  try {
    transition();
  } catch {
    didThrow = true;
  }

  await expectNoProgressiveBalancesMismatches(register, testCaseName);
  if (!didThrow) {
    expect.unreachable("Expected state transition to throw");
  }
}
