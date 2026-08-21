import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {electra} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
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

  // BLS KeyValidate edge cases from consensus-specs#5541. Those spec tests exercise
  // process_deposit / apply_pending_deposit / process_builder_deposit_request, which all route
  // through isValidDepositSignature() — the single-deposit path that parses with validation.
  // verifyDepositSignatures() is a separate batch helper (used by the pre-Gloas scanner) that
  // parses without validation, so the spec tests never reach it. Cover it here.
  const keyValidatePubkeys = {
    "outside the prime-order subgroup": "0x80" + "00".repeat(46) + "04",
    "the point at infinity": "0xc0" + "00".repeat(47),
    "not on the curve": "0x80" + "00".repeat(46) + "01",
    "failing G1 decompression": "0xc010" + "00".repeat(46),
  };

  for (const [what, pubkey] of Object.entries(keyValidatePubkeys)) {
    it(`marks a pubkey ${what} invalid without affecting valid deposits`, () => {
      const [a, b] = generateBuilderPendingDeposits(config, 2, 4000);
      const malformed: electra.PendingDeposit = {...b, pubkey: fromHex(pubkey)};
      expect(verifyDepositSignatures(config, [a, malformed]), `pubkey ${what}`).toEqual([true, false]);
    });
  }

  it("marks the infinity pubkey invalid even paired with the infinity signature", () => {
    // The degenerate pair a naive implementation can accept against any message.
    const [a, b] = generateBuilderPendingDeposits(config, 2, 5000);
    const malformed: electra.PendingDeposit = {
      ...b,
      pubkey: fromHex("0xc0" + "00".repeat(47)),
      signature: fromHex("0xc0" + "00".repeat(95)),
    };
    expect(verifyDepositSignatures(config, [a, malformed])).toEqual([true, false]);
  });

  it("marks a malformed signature invalid without affecting valid deposits", () => {
    const [a, b] = generateBuilderPendingDeposits(config, 2, 3000);
    // all-zero bytes fail to parse (caught in the parse phase); the valid deposit still verifies
    const malformed: electra.PendingDeposit = {...b, signature: Buffer.alloc(96)};
    expect(verifyDepositSignatures(config, [a, malformed])).toEqual([true, false]);
  });
});
