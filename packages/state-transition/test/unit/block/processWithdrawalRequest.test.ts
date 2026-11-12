import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {ForkSeq} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {processWithdrawalRequest} from "../../../src/block/processWithdrawalRequest.js";
import {generateCachedElectraState} from "../../utils/state.js";

const futureValidatorPubkey = fromHexString(
  "0xa41726266b1d83ef609d759ba7796d54cfe549154e01e4730a3378309bc81a7638140d7e184b33593c072595f23f032d"
);

describe("processWithdrawalRequest", () => {
  it("ignores a validator present only in the shared pubkey cache", () => {
    const state = generateCachedElectraState();
    const futureState = state.clone();
    const futureValidatorIndex = state.validators.length;
    futureState.epochCtx.addPubkey(futureValidatorIndex, futureValidatorPubkey);

    const request = ssz.electra.WithdrawalRequest.defaultValue();
    request.validatorPubkey = futureValidatorPubkey;

    expect(state.epochCtx.getValidatorIndex(futureValidatorPubkey)).toBe(futureValidatorIndex);
    expect(() => processWithdrawalRequest(ForkSeq.electra, state, request)).not.toThrow();
    expect(state.pendingPartialWithdrawals.length).toBe(0);
  });
});
