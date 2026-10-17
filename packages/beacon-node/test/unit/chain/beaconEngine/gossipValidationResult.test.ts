import {describe, expect, it} from "vitest";
import {
  GossipValidationStatus,
  accept,
  fromResult,
  runGossipValidation,
} from "../../../../src/chain/beaconEngine/gossipValidationResult.js";
import {AttestationError, AttestationErrorCode} from "../../../../src/chain/errors/attestationError.js";
import {GossipAction} from "../../../../src/chain/errors/gossipValidation.js";

describe("gossip validation results", () => {
  it.each([
    [GossipAction.IGNORE, GossipValidationStatus.Ignore],
    [GossipAction.REJECT, GossipValidationStatus.Reject],
  ])("preserves typed %s failures through both adapters", async (action, status) => {
    const error = new AttestationError(action, {code: AttestationErrorCode.INVALID_SIGNATURE});
    const result = await runGossipValidation(async () => {
      throw error;
    });

    expect(result).toEqual(fromResult({err: error}));
    expect(result.err?.error).toBe(error);
    expect(result.err).toEqual({status, code: error.type.code, data: error.type, error});
  });

  it("keeps unexpected exceptions distinct from per-item batch failures", async () => {
    const error = new Error("unexpected validation failure");

    await expect(
      runGossipValidation(async () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(fromResult({err: error}).err).toEqual({
      status: GossipValidationStatus.Ignore,
      code: "UNEXPECTED_ERROR",
      data: undefined,
      error,
    });
  });

  it("retains the accepted value", () => {
    const value = {skippedSlots: 1};
    const result = accept(value);

    expect(result).toEqual(fromResult({err: null, result: value}));
    expect(result).toEqual({err: null, result: value});
  });
});
