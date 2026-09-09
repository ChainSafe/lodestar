import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {electra} from "@lodestar/types";
import {verifyDepositSignatures} from "../../../src/block/processDeposit.js";
import {generateBuilderPendingDeposits} from "../../../src/testUtils/util.js";

const config = createBeaconConfig(getConfig(ForkName.fulu), Buffer.alloc(32));

describe("verifyDepositSignatures", () => {
  it("returns true for a fully valid batch (aggregate path)", () => {
    const deposits = generateBuilderPendingDeposits(config, 3, 1000);
    expect(verifyDepositSignatures(config, deposits)).toEqual([true, true, true]);
  });

  it("falls back to per-item verification when the batch contains an invalid signature", () => {
    const [a, b, c] = generateBuilderPendingDeposits(config, 3, 2000);
    // Baseline: all three are individually valid, so the failure below is due to the swap alone.
    expect(verifyDepositSignatures(config, [a, b, c])).toEqual([true, true, true]);
    // `invalidB` keeps a valid (on-curve, in-subgroup) signature but for the wrong message, so the
    // aggregate verify fails and the individual fallback loop runs — which must still identify a and
    // c as valid rather than marking the whole chunk invalid.
    const invalidB: electra.PendingDeposit = {...b, signature: a.signature};
    expect(verifyDepositSignatures(config, [a, invalidB, c])).toEqual([true, false, true]);
  });

  it("marks a malformed signature invalid without affecting valid deposits", () => {
    const [a, b] = generateBuilderPendingDeposits(config, 2, 3000);
    // all-zero bytes fail to parse (caught in the parse phase); the valid deposit still verifies
    const malformed: electra.PendingDeposit = {...b, signature: Buffer.alloc(96)};
    expect(verifyDepositSignatures(config, [a, malformed])).toEqual([true, false]);
  });
});
