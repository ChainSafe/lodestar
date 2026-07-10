import {describe, expect, it} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {BeaconStateView} from "@lodestar/state-transition";
import {getStateResponseWithRegen, getStateValidatorIndex} from "../../../../../../src/api/impl/beacon/state/utils.js";
import {NodeIsSyncing} from "../../../../../../src/api/impl/errors.js";
import type {IBeaconChain} from "../../../../../../src/chain/index.js";
import {RegenError, RegenErrorCode} from "../../../../../../src/chain/regen/errors.js";
import {generateCachedAltairState} from "../../../../../utils/state.js";

describe("beacon state api utils", () => {
  describe("getStateValidatorIndex", () => {
    const state = new BeaconStateView(generateCachedAltairState());
    const pubkeyCache = state.cachedState.epochCtx.pubkeyCache;

    it("should return valid: false on invalid input", () => {
      // "invalid validator id number"
      expect(getStateValidatorIndex("foo", state, pubkeyCache).valid).toBe(false);
      // "invalid hex"
      expect(getStateValidatorIndex("0xfoo", state, pubkeyCache).valid).toBe(false);
      // "negative validator index"
      expect(getStateValidatorIndex("-1", state, pubkeyCache).valid).toBe(false);
      expect(getStateValidatorIndex(-1, state, pubkeyCache).valid).toBe(false);
    });

    it("should return valid: false on validator indices / pubkeys not in the state", () => {
      // "validator id not in state"
      expect(getStateValidatorIndex(String(state.validatorCount), state, pubkeyCache).valid).toBe(false);
      // "validator pubkey not in state"
      expect(
        getStateValidatorIndex(
          "0xa99af0913a2834ef4959637e8d7c4e17f0b63adc587d36ab43510452db3102d0771a4554ea4118a33913827d5ee80b76",
          state,
          pubkeyCache
        ).valid
      ).toBe(false);
    });

    it("should return valid: true on validator indices / pubkeys in the state", () => {
      const index = state.validatorCount - 1;
      const resp1 = getStateValidatorIndex(String(index), state, pubkeyCache);
      if (resp1.valid) {
        expect(resp1.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - validator index as string input");
      }
      const resp2 = getStateValidatorIndex(index, state, pubkeyCache);
      if (resp2.valid) {
        expect(resp2.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - validator index as number input");
      }
      const pubkey = state.getValidator(index).pubkey;
      const resp3 = getStateValidatorIndex(pubkey, state, pubkeyCache);
      if (resp3.valid) {
        expect(resp3.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - Uint8Array input");
      }
      const resp4 = getStateValidatorIndex(toHexString(pubkey), state, pubkeyCache);
      if (resp4.valid) {
        expect(resp4.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - Uint8Array input");
      }
    });
  });

  describe("getStateResponseWithRegen", () => {
    it("returns 503 (NodeIsSyncing) when the requested slot is too far ahead of head to regenerate", async () => {
      const requestedSlot = 14_734_272;
      const chain = {
        clock: {currentSlot: requestedSlot + 1},
        forkChoice: {getFinalizedBlock: () => ({slot: 0})},
        getStateBySlot: () =>
          Promise.reject(
            new RegenError({code: RegenErrorCode.SLOT_TOO_FAR_FROM_BLOCK, slot: requestedSlot, blockSlot: 14_719_007})
          ),
      } as unknown as IBeaconChain;

      await expect(getStateResponseWithRegen(chain, String(requestedSlot))).rejects.toBeInstanceOf(NodeIsSyncing);
    });

    it("rethrows non-regen errors unchanged", async () => {
      const requestedSlot = 14_734_272;
      const err = new Error("boom");
      const chain = {
        clock: {currentSlot: requestedSlot + 1},
        forkChoice: {getFinalizedBlock: () => ({slot: 0})},
        getStateBySlot: () => Promise.reject(err),
      } as unknown as IBeaconChain;

      await expect(getStateResponseWithRegen(chain, String(requestedSlot))).rejects.toBe(err);
    });

    it("returns 503 (NodeIsSyncing) when regen for a state root is too far ahead of head", async () => {
      const stateRoot = `0x${"00".repeat(32)}`;
      const chain = {
        clock: {currentSlot: 14_734_273},
        forkChoice: {},
        getStateByStateRoot: () =>
          Promise.reject(
            new RegenError({code: RegenErrorCode.SLOT_TOO_FAR_FROM_BLOCK, slot: 14_734_272, blockSlot: 14_719_007})
          ),
      } as unknown as IBeaconChain;

      await expect(getStateResponseWithRegen(chain, stateRoot)).rejects.toBeInstanceOf(NodeIsSyncing);
    });
  });
});
