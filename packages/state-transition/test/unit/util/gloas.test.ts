import {describe, expect, it} from "vitest";
import {
  BUILDER_PAYMENT_THRESHOLD_DENOMINATOR,
  BUILDER_PAYMENT_THRESHOLD_NUMERATOR,
  EFFECTIVE_BALANCE_INCREMENT,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {CachedBeaconStateGloas} from "../../../src/types.js";
import {getBuilderPaymentQuorumThreshold} from "../../../src/util/gloas.js";

describe("getBuilderPaymentQuorumThreshold", () => {
  function refQuorum(totalActiveBalanceIncrements: number): bigint {
    const totalGwei = BigInt(totalActiveBalanceIncrements) * BigInt(EFFECTIVE_BALANCE_INCREMENT);
    return (
      ((totalGwei / BigInt(SLOTS_PER_EPOCH)) * BigInt(BUILDER_PAYMENT_THRESHOLD_NUMERATOR)) /
      BigInt(BUILDER_PAYMENT_THRESHOLD_DENOMINATOR)
    );
  }

  function makeStateStub(totalActiveBalanceIncrements: number): CachedBeaconStateGloas {
    return {epochCtx: {totalActiveBalanceIncrements}} as unknown as CachedBeaconStateGloas;
  }

  // Stake levels chosen to bracket the f64 precision boundary: 9_007_199 ETH increments
  // multiplied by EFFECTIVE_BALANCE_INCREMENT (1e9) equals 2^53 - 1.
  it.each([
    {label: "tiny devnet (~50k ETH)", totalActiveBalanceIncrements: 50_000},
    {label: "below f64 boundary (~9M ETH)", totalActiveBalanceIncrements: 9_000_000},
    {label: "mainnet today (~35M ETH)", totalActiveBalanceIncrements: 35_000_000},
    {label: "MaxEB worst case (~64M ETH)", totalActiveBalanceIncrements: 64_000_000},
  ])("matches bigint reference at $label", ({totalActiveBalanceIncrements}) => {
    const got = getBuilderPaymentQuorumThreshold(makeStateStub(totalActiveBalanceIncrements));
    expect(got).toEqual(refQuorum(totalActiveBalanceIncrements));
  });
});
