import {expect} from "vitest";
import * as nativeMetrics from "@chainsafe/lodestar-z/metrics";
import {
  BeaconStateTransitionMetrics,
  BeaconStateView,
  IBeaconStateView,
  beforeProcessEpoch,
  getMetrics,
} from "@lodestar/state-transition";
import {Metrics, RegistryMetricCreator, createMetrics} from "../../../src/metrics/index.js";
import {nativeStateTransition} from "./stateTransition.js";

export const progressiveBalancesMismatchesMetricName = "lodestar_stfn_progressive_balances_mismatches_total";
const nativeBaselines = new WeakMap<RegistryMetricCreator, number>();

/** A registered counter may have no label samples until the first mismatch. */
export function readNativeProgressiveBalancesMismatches(scrape: string): number {
  const lines = scrape.split("\n");
  if (!lines.includes(`# TYPE ${progressiveBalancesMismatchesMetricName} counter`)) {
    throw Error(`Native metrics did not register ${progressiveBalancesMismatchesMetricName}`);
  }
  let total = 0;
  for (const line of lines) {
    if (!line.startsWith(`${progressiveBalancesMismatchesMetricName}{`)) continue;
    const value = Number(line.slice(line.lastIndexOf("}") + 1).trim());
    if (!Number.isSafeInteger(value) || value < 0) {
      throw Error(`Invalid native mismatch counter: ${line}`);
    }
    total += value;
  }
  return total;
}

export function createSpecTestMetrics(): {metrics: BeaconStateTransitionMetrics; register: RegistryMetricCreator} {
  const register = new RegistryMetricCreator();
  const metrics = getMetrics(register);
  if (nativeStateTransition) {
    nativeMetrics.init();
    nativeBaselines.set(register, readNativeProgressiveBalancesMismatches(nativeMetrics.scrapeMetrics()));
  }

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
  if (nativeStateTransition) {
    nativeMetrics.init();
    nativeBaselines.set(metrics.register, readNativeProgressiveBalancesMismatches(nativeMetrics.scrapeMetrics()));
  }
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
  if (metric === undefined) throw Error(`Missing ${progressiveBalancesMismatchesMetricName}`);
  const mismatches = metric.values.reduce((sum, {value}) => sum + value, 0);

  expect(mismatches, `${testCaseName} incremented ${progressiveBalancesMismatchesMetricName}`).toBe(0);
  if (nativeStateTransition) {
    const baseline = nativeBaselines.get(register);
    if (baseline === undefined) throw Error("Native mismatch counter baseline was not captured");
    const current = readNativeProgressiveBalancesMismatches(nativeMetrics.scrapeMetrics());
    expect(current - baseline, `${testCaseName} incremented native ${progressiveBalancesMismatchesMetricName}`).toBe(0);
  }
}

export function expectValidProgressiveBalances(
  state: IBeaconStateView,
  metrics: BeaconStateTransitionMetrics | null
): void {
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
  } catch (error) {
    if (
      error instanceof Error &&
      /\b(?:OutOfMemory|PoolExhausted|RefCountOverflow|InvalidPoolCapacity|SystemResources|ThreadQuotaExceeded|ConcurrencyUnavailable)\b/.test(
        error.message
      )
    ) {
      throw error;
    }
    didThrow = true;
  }

  await expectNoProgressiveBalancesMismatches(register, testCaseName);
  if (!didThrow) {
    expect.unreachable("Expected state transition to throw");
  }
}
