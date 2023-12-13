import {toHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import {BLSPubkey, ssz, ValidatorIndex} from "@lodestar/types";
import {BeaconStateAllForks, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  currentEpochWithDisparity,
  getPubkeysForIndices,
  msToNextEpoch,
  waitForNextClosestEpoch,
} from "../../../../../src/api/impl/validator/utils.js";
import {Clock} from "../../../../../src/util/clock.js";

function slotTimeMs(slot: number): number {
  return slot * config.SECONDS_PER_SLOT * 1000;
}

function epochTimeMs(slot: number): number {
  return SLOTS_PER_EPOCH * slot * config.SECONDS_PER_SLOT * 1000;
}

describe("api / impl / validator / utils", () => {
  let abortController: AbortController;
  let clock: Clock;

  beforeEach(() => {
    // Start the clock at the 500 epoch
    vi.useFakeTimers({now: epochTimeMs(500)});

    abortController = new AbortController();
    // Set the clock to system clock time to start at slot 0 of epoch 0
    clock = new Clock({config, genesisTime: Math.floor(epochTimeMs(500) / 1000), signal: abortController.signal});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    abortController.abort();
  });

  describe("getPubkeysForIndices", () => {
    const vc = 32;

    const pubkeys: BLSPubkey[] = [];
    const indexes: ValidatorIndex[] = [];
    let state: BeaconStateAllForks;

    beforeAll(() => {
      state = ssz.phase0.BeaconState.defaultViewDU();
      const validator = ssz.phase0.Validator.defaultValue();
      const validators = state.validators;
      for (let i = 0; i < vc; i++) {
        indexes.push(i);
        const pubkey = Buffer.alloc(48, i);
        pubkeys.push(pubkey);
        validators.push(ssz.phase0.Validator.toViewDU({...validator, pubkey}));
      }
    });

    it("should return valid pub keys", () => {
      const pubkeysRes = getPubkeysForIndices(state.validators, indexes);

      expect(pubkeysRes.map(toHexString)).toEqual(pubkeys.map(toHexString));
    });
  });

  describe("msToNextEpoch", () => {
    it("should return valid ms to next epoch if we are at first slot of zero epoch", () => {
      const currentSlot = clock.currentSlot;
      const startSlotOfNextEpoch = computeStartSlotAtEpoch(clock.currentEpoch + 1);
      const totalSlots = startSlotOfNextEpoch - currentSlot;

      expect(msToNextEpoch(clock)).toEqual(slotTimeMs(totalSlots));
    });

    it("should return valid ms to next epoch if we are at first slot of any epoch", () => {
      // advance 5 epochs
      vi.advanceTimersByTime(epochTimeMs(5));

      const currentSlot = clock.currentSlot;
      const startSlotOfNextEpoch = computeStartSlotAtEpoch(clock.currentEpoch + 1);
      const totalSlots = startSlotOfNextEpoch - currentSlot;

      expect(msToNextEpoch(clock)).toEqual(slotTimeMs(totalSlots));
    });

    it("should return valid ms to next epoch if we are at last slot of zero epoch", () => {
      // Advance to the last slot of current epoch
      vi.advanceTimersByTime(epochTimeMs(1) - slotTimeMs(1));

      expect(msToNextEpoch(clock)).toEqual(slotTimeMs(1));
    });

    it("should return valid ms to next epoch if we are at last slot of any epoch", () => {
      // Advance to the last slot of 5th epoch
      vi.advanceTimersByTime((SLOTS_PER_EPOCH * 5 - 1) * config.SECONDS_PER_SLOT * 1000);

      expect(msToNextEpoch(clock)).toEqual(slotTimeMs(1));
    });
  });

  describe("waitForNextClosestEpoch", () => {
    it("should wait for the right epoch based on current epoch when disparity is set to infinity", async () => {
      const currentEpoch = clock.currentEpoch;
      vi.spyOn(clock, "waitForSlot").mockResolvedValue();

      await waitForNextClosestEpoch({clock, maxClockDisparityMs: Infinity});

      expect(clock.waitForSlot).toHaveBeenCalledOnce();
      expect(clock.waitForSlot).toHaveBeenCalledWith(computeStartSlotAtEpoch(currentEpoch + 1));
    });

    it("should wait for the right epoch based on current epoch within disparity range", async () => {
      const currentEpoch = clock.currentEpoch;
      vi.spyOn(clock, "waitForSlot").mockResolvedValue();

      // Advance timer to last slot of the epoch
      vi.advanceTimersByTime(epochTimeMs(1) - slotTimeMs(1));

      // call with 1 slot disparity
      await waitForNextClosestEpoch({clock, maxClockDisparityMs: config.SECONDS_PER_SLOT * 1000});

      expect(clock.waitForSlot).toHaveBeenCalledOnce();
      expect(clock.waitForSlot).toHaveBeenCalledWith(computeStartSlotAtEpoch(currentEpoch + 1));
    });

    it("should not wait for for the epoch if current slot time not within disparity range", async () => {
      vi.spyOn(clock, "waitForSlot").mockResolvedValue();

      // Advance timer to last slot of the epoch (with 1ms less)
      vi.advanceTimersByTime(epochTimeMs(1) - slotTimeMs(1) - 1);

      // call with 1 slot disparity
      await waitForNextClosestEpoch({clock, maxClockDisparityMs: config.SECONDS_PER_SLOT * 1000});

      expect(clock.waitForSlot).not.toHaveBeenCalledOnce();
    });
  });

  describe("currentEpochWithDisparity", () => {
    it("should return valid epoch for the zero epoch if disparity is set to infinity", () => {
      expect(
        currentEpochWithDisparity({
          clock,
          maxClockDisparityMs: Infinity,
        })
      ).toEqual(0);
    });

    it("should return valid epoch for the zero epoch if disparity is a small value", () => {
      expect(
        currentEpochWithDisparity({
          clock,
          maxClockDisparityMs: 500,
        })
      ).toEqual(0);
    });

    it("should return valid epoch if current clock time is behind disparity range", () => {
      // Advance to the 5th epoch with 600ms behind
      vi.advanceTimersByTime(epochTimeMs(5) - 600);

      expect(
        currentEpochWithDisparity({
          clock,
          maxClockDisparityMs: 500,
        })
      ).toEqual(4);
    });

    it("should return valid epoch if current clock time is within disparity range", () => {
      // Advance to the 5th epoch with 400ms behind
      vi.advanceTimersByTime(epochTimeMs(5) - 400);

      expect(
        currentEpochWithDisparity({
          clock,
          maxClockDisparityMs: 500,
        })
      ).toEqual(5);
    });
  });
});
