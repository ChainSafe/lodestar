import {expect} from "vitest";
import {getMetrics} from "@lodestar/state-transition";
import {RegistryMetricCreator} from "../../../src/metrics/index.js";

export const progressiveBalancesMismatchesMetricName = "lodestar_stfn_progressive_balances_mismatches_total";

export function createSpecTestMetrics() {
  const register = new RegistryMetricCreator();
  const metrics = getMetrics(register);

  return {metrics, register};
}

export async function expectNoProgressiveBalancesMismatches(
  register: RegistryMetricCreator,
  testCaseName: string
): Promise<void> {
  const metric = await register.getSingleMetricAsString(progressiveBalancesMismatchesMetricName);
  const match = metric.match(new RegExp(`^${progressiveBalancesMismatchesMetricName} (\\d+)$`, "m"));
  const mismatches = match ? Number(match[1]) : 0;

  expect(mismatches, `${testCaseName} incremented ${progressiveBalancesMismatchesMetricName}`).toBe(0);
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
