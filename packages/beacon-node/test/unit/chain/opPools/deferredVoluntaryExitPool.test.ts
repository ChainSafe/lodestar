import {beforeEach, describe, expect, it} from "vitest";
import {IBeaconStateView, VoluntaryExitValidity} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {DeferredVoluntaryExitPool} from "../../../../src/chain/opPools/deferredVoluntaryExitPool.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

function makeStateStub(
  epoch: number,
  validityFn: (exit: phase0.SignedVoluntaryExit) => VoluntaryExitValidity
): IBeaconStateView {
  return {
    epoch,
    getVoluntaryExitValidity: validityFn,
  } as unknown as IBeaconStateView;
}

describe("DeferredVoluntaryExitPool", () => {
  const logger = getMockedLogger();
  const maxSize = 256;
  const maxDeferEpochs = 256;
  const epoch = 1;

  let pool: DeferredVoluntaryExitPool;

  beforeEach(() => {
    pool = new DeferredVoluntaryExitPool(logger, maxSize, maxDeferEpochs);
  });

  describe("insert", () => {
    it("correct empty state", () => {
      expect(pool.size()).toBe(0);
    });

    it("transiently invalid exit insert succeeds", () => {
      const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
      const result = pool.insert(exit, VoluntaryExitValidity.shortTimeActive, epoch);
      expect(result).toBe(true);
      expect(pool.size()).toBe(1);
    });

    it("permanently invalid exit insert fails", () => {
      const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
      const result = pool.insert(exit, VoluntaryExitValidity.invalidSignature, epoch);
      expect(result).toBe(false);
      expect(pool.size()).toBe(0);
    });

    it("valid exit insert fails", () => {
      const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
      const result = pool.insert(exit, VoluntaryExitValidity.valid, epoch);
      expect(result).toBe(false);
      expect(pool.size()).toBe(0);
    });

    it("transiently invalid exit - rejects a duplicate", () => {
      const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
      let result = pool.insert(exit, VoluntaryExitValidity.shortTimeActive, epoch);
      expect(result).toBe(true);
      expect(pool.size()).toBe(1);
      result = pool.insert(exit, VoluntaryExitValidity.shortTimeActive, epoch);
      expect(result).toBe(false);
      expect(pool.size()).toBe(1);
    });

    it("accepts inserts up to maxSize, rejects beyond", () => {
      for (let i = 0; i < maxSize; i++) {
        const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
        exit.message.validatorIndex = i;
        const result = pool.insert(exit, VoluntaryExitValidity.shortTimeActive, epoch);
        expect(result).toBe(true);
        expect(pool.size()).toBe(i + 1);
      }
      const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
      exit.message.validatorIndex = maxSize;
      const result = pool.insert(exit, VoluntaryExitValidity.shortTimeActive, epoch);
      expect(result).toBe(false);
      expect(pool.size()).toBe(maxSize);
    });
  });

  describe("retrieveProcessableExits", () => {
    it("correct empty state", () => {
      const mockState = makeStateStub(epoch, () => VoluntaryExitValidity.valid);
      expect(pool.retrieveProcessableExits(mockState)).toEqual([]);
    });

    it("valid entry is retrieved and removed", () => {
      const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
      const result = pool.insert(exit, VoluntaryExitValidity.shortTimeActive, epoch);
      expect(result).toBe(true);
      expect(pool.size()).toBe(1);
      const mockState = makeStateStub(epoch, () => VoluntaryExitValidity.valid);
      expect(pool.retrieveProcessableExits(mockState)).toEqual([exit]);
      expect(pool.size()).toBe(0);
    });

    it("transiently invalid entry is unprocessed and kept", () => {
      const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
      const result = pool.insert(exit, VoluntaryExitValidity.shortTimeActive, epoch);
      expect(result).toBe(true);
      expect(pool.size()).toBe(1);
      const mockState = makeStateStub(epoch, () => VoluntaryExitValidity.shortTimeActive);
      expect(pool.retrieveProcessableExits(mockState)).toEqual([]);
      expect(pool.size()).toBe(1);
    });

    it("permanently invalid entry is removed", () => {
      const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
      const result = pool.insert(exit, VoluntaryExitValidity.shortTimeActive, epoch);
      expect(result).toBe(true);
      expect(pool.size()).toBe(1);
      const mockState = makeStateStub(epoch, () => VoluntaryExitValidity.invalidSignature);
      expect(pool.retrieveProcessableExits(mockState)).toEqual([]);
      expect(pool.size()).toBe(0);
    });

    it("an entry past deferred ceiling is removed", () => {
      const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
      const result = pool.insert(exit, VoluntaryExitValidity.shortTimeActive, epoch);
      expect(result).toBe(true);
      expect(pool.size()).toBe(1);
      const mockState = makeStateStub(maxDeferEpochs + epoch + 1, () => VoluntaryExitValidity.valid);
      expect(pool.retrieveProcessableExits(mockState)).toEqual([]);
      expect(pool.size()).toBe(0);
    });

    it("does not stop processing when an entry throws", () => {
      const exit1 = ssz.phase0.SignedVoluntaryExit.defaultValue();
      const exit2 = ssz.phase0.SignedVoluntaryExit.defaultValue();
      exit2.message.validatorIndex = 1;

      pool.insert(exit1, VoluntaryExitValidity.shortTimeActive, epoch);
      pool.insert(exit2, VoluntaryExitValidity.shortTimeActive, epoch);

      const validityFn = (exit: phase0.SignedVoluntaryExit): VoluntaryExitValidity => {
        if (exit.message.validatorIndex === 0) {
          throw new Error("boom");
        }
        return VoluntaryExitValidity.valid;
      };

      const mockState = makeStateStub(epoch, validityFn);
      expect(pool.retrieveProcessableExits(mockState)).toEqual([exit2]);
      // Exit1 stays in pool because the throw was caught before delete
      expect(pool.size()).toBe(1);
    });

    it("process 3 different cases of exits at once", () => {
      const exit1 = ssz.phase0.SignedVoluntaryExit.defaultValue();
      const exit2 = ssz.phase0.SignedVoluntaryExit.defaultValue();
      exit2.message.validatorIndex = 1;
      const exit3 = ssz.phase0.SignedVoluntaryExit.defaultValue();
      exit3.message.validatorIndex = 2;

      let result = pool.insert(exit1, VoluntaryExitValidity.shortTimeActive, epoch);
      expect(result).toBe(true);
      result = pool.insert(exit2, VoluntaryExitValidity.shortTimeActive, epoch);
      expect(result).toBe(true);
      result = pool.insert(exit3, VoluntaryExitValidity.shortTimeActive, epoch);
      expect(result).toBe(true);

      expect(pool.size()).toBe(3);

      const validityFn = (exit: phase0.SignedVoluntaryExit) => {
        // This ordering helps us make sure that invalid exits do not prevent
        // the valid test from being retrieved
        switch (exit.message.validatorIndex) {
          case 0:
            return VoluntaryExitValidity.invalidSignature;
          case 1:
            return VoluntaryExitValidity.shortTimeActive;
          default:
            return VoluntaryExitValidity.valid;
        }
      };

      const mockState = makeStateStub(epoch, validityFn);
      // Exit 1 is returned and removed
      // Exit 2 is kept
      // Exit 3 is removed
      expect(pool.retrieveProcessableExits(mockState)).toEqual([exit3]);
      expect(pool.size()).toBe(1);
    });
  });
});
