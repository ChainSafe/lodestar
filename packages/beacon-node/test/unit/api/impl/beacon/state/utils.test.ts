import {describe, expect, it, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkSeq} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {getStateResponseWithRegen, getStateValidatorIndex} from "../../../../../../src/api/impl/beacon/state/utils.js";
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
});

describe("getStateResponseWithRegen", () => {
  it("returns 404 if forced EMPTY lookup misses and does not fall back to FULL", async () => {
    const finalizedCheckpoint = {
      epoch: 123,
      rootHex: "0xabc",
      payloadStatus: PayloadStatus.FULL,
      payloadPresent: true,
    };

    const getStateOrBytesByCheckpoint = vi.fn().mockResolvedValue(null);

    const chain = {
      forkChoice: {
        getFinalizedCheckpoint: vi.fn().mockReturnValue(finalizedCheckpoint),
      },
      config: {
        getForkSeqAtEpoch: vi.fn().mockReturnValue(ForkSeq.gloas),
      },
      clock: {
        currentSlot: 1000,
      },
      getStateByStateRoot: vi.fn(),
      getStateBySlot: vi.fn(),
      getHistoricalStateBySlot: vi.fn(),
      getStateOrBytesByCheckpoint,
    } as never;

    await expect(getStateResponseWithRegen(chain, "finalized")).rejects.toThrow("State not found");
    expect(getStateOrBytesByCheckpoint).toHaveBeenCalledTimes(1);
    expect(getStateOrBytesByCheckpoint).toHaveBeenCalledWith({
      ...finalizedCheckpoint,
      payloadStatus: PayloadStatus.EMPTY,
    });
  });

  it("serves finalized state from the EMPTY checkpoint variant post-Gloas", async () => {
    const finalizedCheckpoint = {
      epoch: 100,
      rootHex: "0xdef",
      payloadStatus: PayloadStatus.FULL,
    };
    const expectedResponse = {
      state: new Uint8Array([4, 5, 6]),
      executionOptimistic: false,
      finalized: true,
    };
    const getStateOrBytesByCheckpoint = vi.fn().mockResolvedValueOnce(expectedResponse);

    const chain = {
      forkChoice: {
        getFinalizedCheckpoint: vi.fn().mockReturnValue(finalizedCheckpoint),
      },
      config: {
        getForkSeqAtEpoch: vi.fn().mockReturnValue(ForkSeq.gloas),
      },
      clock: {
        currentSlot: 3300,
      },
      getStateByStateRoot: vi.fn(),
      getStateBySlot: vi.fn(),
      getHistoricalStateBySlot: vi.fn(),
      getStateOrBytesByCheckpoint,
    } as never;

    const response = await getStateResponseWithRegen(chain, "finalized");

    expect(response).toBe(expectedResponse);
    expect(getStateOrBytesByCheckpoint).toHaveBeenCalledTimes(1);
    expect(getStateOrBytesByCheckpoint).toHaveBeenCalledWith({
      ...finalizedCheckpoint,
      payloadStatus: PayloadStatus.EMPTY,
    });
  });

  it("serves justified state from the EMPTY checkpoint variant post-Gloas", async () => {
    const justifiedCheckpoint = {
      epoch: 99,
      rootHex: "0x123",
      payloadStatus: PayloadStatus.FULL,
    };
    const expectedResponse = {
      state: new Uint8Array([7, 8, 9]),
      executionOptimistic: false,
      finalized: false,
    };
    const getStateOrBytesByCheckpoint = vi.fn().mockResolvedValueOnce(expectedResponse);

    const chain = {
      forkChoice: {
        getJustifiedCheckpoint: vi.fn().mockReturnValue(justifiedCheckpoint),
      },
      config: {
        getForkSeqAtEpoch: vi.fn().mockReturnValue(ForkSeq.gloas),
      },
      clock: {
        currentSlot: 3300,
      },
      getStateByStateRoot: vi.fn(),
      getStateBySlot: vi.fn(),
      getHistoricalStateBySlot: vi.fn(),
      getStateOrBytesByCheckpoint,
    } as never;

    const response = await getStateResponseWithRegen(chain, "justified");

    expect(response).toBe(expectedResponse);
    expect(getStateOrBytesByCheckpoint).toHaveBeenCalledWith({
      ...justifiedCheckpoint,
      payloadStatus: PayloadStatus.EMPTY,
    });
  });
});
