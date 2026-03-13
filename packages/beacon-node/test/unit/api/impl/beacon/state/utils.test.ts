import {describe, expect, it, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkSeq} from "@lodestar/params";
import {getStateResponseWithRegen, getStateValidatorIndex} from "../../../../../../src/api/impl/beacon/state/utils.js";
import {generateCachedAltairState} from "../../../../../utils/state.js";

describe("beacon state api utils", () => {
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

describe("getStateResponseWithRegen", () => {
  it("falls back to original checkpoint payload status if forced EMPTY lookup misses", async () => {
    const finalizedCheckpoint = {
      epoch: 123,
      rootHex: "0xabc",
      payloadStatus: PayloadStatus.FULL,
      payloadPresent: true,
    };

    const expectedResponse = {
      state: new Uint8Array([1, 2, 3]),
      executionOptimistic: false,
      finalized: true,
    };

    const getStateOrBytesByCheckpointFn = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(expectedResponse);

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
      getStateOrBytesByCheckpoint: getStateOrBytesByCheckpointFn,
    } as never;

    const response = await getStateResponseWithRegen(chain, "finalized");

    expect(response).toBe(expectedResponse);
    expect(getStateOrBytesByCheckpointFn).toHaveBeenNthCalledWith(1, {
      ...finalizedCheckpoint,
      payloadStatus: PayloadStatus.EMPTY,
    });
    expect(getStateOrBytesByCheckpointFn).toHaveBeenNthCalledWith(2, finalizedCheckpoint);
  });
});

describe("getStateResponseWithRegen — post-Gloas missed-slot checkpoint serving", () => {
  /**
   * Scenario: epoch boundary slot 0 is MISSED (no block at epoch boundary).
   *
   * In this case:
   * - getCheckpointPayloadStatus() correctly returns EMPTY (processSlot clears the bit)
   * - Fork choice finalized checkpoint has payloadStatus = EMPTY
   * - The checkpoint state in cache was populated by prepareNextSlot using the head's
   *   FULL payloadPresent (head block had payload processed), so only the FULL variant exists
   * - API forces EMPTY lookup -> cache miss
   * - Defensive fallback retries original checkpoint (also EMPTY) -> cache miss
   * - Result: 404 even though the state exists as FULL variant
   *
   * Fix: fallback should also try the OPPOSITE payload variant (FULL when EMPTY misses).
   */
  it("serves finalized state when slot-0 is missed and only FULL variant exists in cache", async () => {
    const finalizedCheckpoint = {
      epoch: 100,
      rootHex: "0xabc",
      payloadStatus: PayloadStatus.EMPTY, // correct for missed slot - processSlot cleared the bit
    };

    const expectedResponse = {
      state: new Uint8Array([1, 2, 3]),
      executionOptimistic: false,
      finalized: true,
    };

    const getStateOrBytesByCheckpoint = vi
      .fn()
      .mockResolvedValueOnce(null) // EMPTY lookup
      .mockResolvedValueOnce(null) // fallback to original (also EMPTY)
      .mockResolvedValueOnce(expectedResponse); // FULL variant

    const chain = {
      forkChoice: {
        getFinalizedCheckpoint: vi.fn().mockReturnValue(finalizedCheckpoint),
        getFinalizedBlock: vi.fn().mockReturnValue({slot: 3200}),
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
    // Should have tried: EMPTY, original EMPTY, then FULL as last resort
    expect(getStateOrBytesByCheckpoint).toHaveBeenCalledTimes(3);
  });

  it("serves finalized state when slot-0 has a block (normal case, EMPTY variant exists)", async () => {
    const finalizedCheckpoint = {
      epoch: 100,
      rootHex: "0xdef",
      payloadStatus: PayloadStatus.FULL, // normal: envelope was processed
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
        getFinalizedBlock: vi.fn().mockReturnValue({slot: 3200}),
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
    // Should find it on first try (EMPTY variant)
    expect(getStateOrBytesByCheckpoint).toHaveBeenCalledTimes(1);
    expect(getStateOrBytesByCheckpoint).toHaveBeenCalledWith({
      ...finalizedCheckpoint,
      payloadStatus: PayloadStatus.EMPTY,
    });
  });

  it("serves justified state correctly for post-Gloas", async () => {
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
        getFinalizedBlock: vi.fn().mockReturnValue({slot: 3100}),
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
