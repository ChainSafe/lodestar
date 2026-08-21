import {describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {SeenPayloadAttesters} from "../../../../src/chain/seenCache/seenAttesters.js";

describe("SeenPayloadAttesters", () => {
  const epoch = 4;
  const slot = epoch * SLOTS_PER_EPOCH;
  const validatorIndex = 42;

  it("prunes slot duplicates and epoch liveness with the same epoch window", () => {
    const cache = new SeenPayloadAttesters();
    const previousEpochSlot = (epoch - 1) * SLOTS_PER_EPOCH;
    const futureEpochSlot = (epoch + 1) * SLOTS_PER_EPOCH;

    cache.add(previousEpochSlot, validatorIndex);
    cache.add(slot, validatorIndex);
    cache.add(futureEpochSlot, validatorIndex);
    cache.prune(epoch);

    expect(cache.isKnown(previousEpochSlot, validatorIndex)).toBe(true);
    expect(cache.isKnown(slot, validatorIndex)).toBe(true);
    expect(cache.isKnown(futureEpochSlot, validatorIndex)).toBe(true);
    expect(cache.seenAtEpoch(epoch - 1, validatorIndex)).toBe(true);
    expect(cache.seenAtEpoch(epoch, validatorIndex)).toBe(true);
    expect(cache.seenAtEpoch(epoch + 1, validatorIndex)).toBe(true);

    cache.prune(epoch + 2);

    expect(cache.isKnown(previousEpochSlot, validatorIndex)).toBe(false);
    expect(cache.isKnown(slot, validatorIndex)).toBe(true);
    expect(cache.isKnown(futureEpochSlot, validatorIndex)).toBe(true);
    expect(cache.seenAtEpoch(epoch - 1, validatorIndex)).toBe(false);
    expect(cache.seenAtEpoch(epoch, validatorIndex)).toBe(true);
    expect(cache.seenAtEpoch(epoch + 1, validatorIndex)).toBe(true);
  });
});
