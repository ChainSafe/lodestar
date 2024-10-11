import {describe, it, expect} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {getStateValidatorIndex} from "../../../../../../src/api/impl/beacon/state/utils.js";
import {generateCachedAltairState} from "../../../../../utils/state.js";

describe("beacon state api utils", function () {
  describe("getStateValidatorIndex", () => {
    const state = generateCachedAltairState();
    const pubkey2index = state.epochCtx.pubkey2index;

    it("should return valid: false on invalid input", () => {
      // "invalid validator id number"
      expect(getStateValidatorIndex("foo", state, pubkey2index).valid).toBe(false);
      // "invalid hex"
      expect(getStateValidatorIndex("0xfoo", state, pubkey2index).valid).toBe(false);
    });

    it("should return valid: false on validator indices / pubkeys not in the state", () => {
      // "validator id not in state"
      expect(getStateValidatorIndex(String(state.validators.length), state, pubkey2index).valid).toBe(false);
      // "validator pubkey not in state"
      expect(
        getStateValidatorIndex(
          "0xa99af0913a2834ef4959637e8d7c4e17f0b63adc587d36ab43510452db3102d0771a4554ea4118a33913827d5ee80b76",
          state,
          pubkey2index
        ).valid
      ).toBe(false);
    });

    it("should return valid: true on validator indices / pubkeys in the state", () => {
      const index = state.validators.length - 1;
      const resp1 = getStateValidatorIndex(String(index), state, pubkey2index);
      if (resp1.valid) {
        expect(resp1.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - validator index as string input");
      }
      const resp2 = getStateValidatorIndex(index, state, pubkey2index);
      if (resp2.valid) {
        expect(resp2.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - validator index as number input");
      }
      const pubkey = state.validators.get(index).pubkey;
      const resp3 = getStateValidatorIndex(pubkey, state, pubkey2index);
      if (resp3.valid) {
        expect(resp3.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - Uint8Array input");
      }
      const resp4 = getStateValidatorIndex(toHexString(pubkey), state, pubkey2index);
      if (resp4.valid) {
        expect(resp4.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - Uint8Array input");
      }
    });
  });
});
