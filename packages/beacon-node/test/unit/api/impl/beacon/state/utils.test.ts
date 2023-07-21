import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import {toHexString} from "@chainsafe/ssz";
import {phase0} from "@lodestar/types";
import {getValidatorStatus, getStateValidatorIndex} from "../../../../../../src/api/impl/beacon/state/utils.js";
import {generateCachedAltairState} from "../../../../../utils/state.js";

use(chaiAsPromised);

describe("beacon state api utils", function () {
  describe("getValidatorStatus", function () {
    it("should return PENDING_INITIALIZED", function () {
      const validator = {
        activationEpoch: 1,
        activationEligibilityEpoch: Infinity,
      } as phase0.Validator;
      const currentEpoch = 0;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("pending_initialized");
    });
    it("should return PENDING_QUEUED", function () {
      const validator = {
        activationEpoch: 1,
        activationEligibilityEpoch: 101010101101010,
      } as phase0.Validator;
      const currentEpoch = 0;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("pending_queued");
    });
    it("should return ACTIVE_ONGOING", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: Infinity,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("active_ongoing");
    });
    it("should return ACTIVE_SLASHED", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: 101010101101010,
        slashed: true,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("active_slashed");
    });
    it("should return ACTIVE_EXITING", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: 101010101101010,
        slashed: false,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("active_exiting");
    });
    it("should return EXITED_SLASHED", function () {
      const validator = {
        exitEpoch: 1,
        withdrawableEpoch: 3,
        slashed: true,
      } as phase0.Validator;
      const currentEpoch = 2;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("exited_slashed");
    });
    it("should return EXITED_UNSLASHED", function () {
      const validator = {
        exitEpoch: 1,
        withdrawableEpoch: 3,
        slashed: false,
      } as phase0.Validator;
      const currentEpoch = 2;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("exited_unslashed");
    });
    it("should return WITHDRAWAL_POSSIBLE", function () {
      const validator = {
        withdrawableEpoch: 1,
        effectiveBalance: 32,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("withdrawal_possible");
    });
    it("should return WITHDRAWAL_DONE", function () {
      const validator = {
        withdrawableEpoch: 1,
        effectiveBalance: 0,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("withdrawal_done");
    });
    it("should error", function () {
      const validator = {} as phase0.Validator;
      const currentEpoch = 0;
      try {
        getValidatorStatus(validator, currentEpoch);
      } catch (error) {
        expect(error).to.have.property("message", "ValidatorStatus unknown");
      }
    });
  });

  describe("getStateValidatorIndex", async function () {
    const state = generateCachedAltairState();
    const pubkey2index = state.epochCtx.pubkey2index;

    it("should return valid: false on invalid input", () => {
      expect(getStateValidatorIndex("foo", state, pubkey2index).valid, "invalid validator id number").to.equal(false);
      expect(getStateValidatorIndex("0xfoo", state, pubkey2index).valid, "invalid hex").to.equal(false);
    });

    it("should return valid: false on validator indices / pubkeys not in the state", () => {
      expect(
        getStateValidatorIndex(String(state.validators.length), state, pubkey2index).valid,
        "validator id not in state"
      ).to.equal(false);
      expect(getStateValidatorIndex("0xabcd", state, pubkey2index).valid, "validator pubkey not in state").to.equal(
        false
      );
    });

    it("should return valid: true on validator indices / pubkeys in the state", () => {
      const index = state.validators.length - 1;
      const resp1 = getStateValidatorIndex(String(index), state, pubkey2index);
      if (resp1.valid) {
        expect(resp1.validatorIndex).to.equal(index);
      } else {
        expect.fail("validator index should be found - validator index input");
      }
      const pubkey = state.validators.get(index).pubkey;
      const resp2 = getStateValidatorIndex(pubkey, state, pubkey2index);
      if (resp2.valid) {
        expect(resp2.validatorIndex).to.equal(index);
      } else {
        expect.fail("validator index should be found - Uint8Array input");
      }
      const resp3 = getStateValidatorIndex(toHexString(pubkey), state, pubkey2index);
      if (resp3.valid) {
        expect(resp3.validatorIndex).to.equal(index);
      } else {
        expect.fail("validator index should be found - Uint8Array input");
      }
    });
  });
});
