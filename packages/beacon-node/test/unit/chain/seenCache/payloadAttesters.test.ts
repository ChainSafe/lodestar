import {describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {SeenPayloadAttesters} from "../../../../src/chain/seenCache/index.js";

const MAX_SLOTS_IN_CACHE = 3;
const EPOCH_LOOKBACK_LIMIT = 2;

describe("chain / seenCache / SeenPayloadAttesters", () => {
  const validatorIndex = 100;
  const otherValidator = 101;
  // Use a slot late in an epoch so we can test "same epoch, different slot" within one epoch.
  const slot = SLOTS_PER_EPOCH * 10 + 1;
  const epoch = Math.floor(slot / SLOTS_PER_EPOCH);

  it("dedups by (slot, validatorIndex)", () => {
    const cache = new SeenPayloadAttesters();
    expect(cache.isKnown(slot, validatorIndex)).toBe(false);
    cache.add(slot, validatorIndex);
    expect(cache.isKnown(slot, validatorIndex)).toBe(true);
    // Different validator at same slot is independent.
    expect(cache.isKnown(slot, otherValidator)).toBe(false);
  });

  it("accepts the same validator at different slots in the same epoch", () => {
    const cache = new SeenPayloadAttesters();
    const slot1 = slot;
    const slot2 = slot + 1;
    expect(Math.floor(slot1 / SLOTS_PER_EPOCH)).toBe(Math.floor(slot2 / SLOTS_PER_EPOCH));

    cache.add(slot1, validatorIndex);
    expect(cache.isKnown(slot1, validatorIndex)).toBe(true);
    // Same validator, different slot in the same epoch: must NOT be deduped.
    expect(cache.isKnown(slot2, validatorIndex)).toBe(false);

    cache.add(slot2, validatorIndex);
    expect(cache.isKnown(slot2, validatorIndex)).toBe(true);
  });

  it("populates the epoch liveness map when add() is called", () => {
    const cache = new SeenPayloadAttesters();
    expect(cache.isKnownAtEpoch(epoch, validatorIndex)).toBe(false);
    cache.add(slot, validatorIndex);
    expect(cache.isKnownAtEpoch(epoch, validatorIndex)).toBe(true);
    expect(cache.isKnownAtEpoch(epoch + 1, validatorIndex)).toBe(false);
  });

  it("prune(slot) evicts old slot entries but preserves epoch liveness", () => {
    const cache = new SeenPayloadAttesters();
    cache.add(slot, validatorIndex);
    expect(cache.isKnown(slot, validatorIndex)).toBe(true);

    cache.prune(slot + MAX_SLOTS_IN_CACHE + 1);
    // Slot map evicted.
    expect(cache.isKnown(slot, validatorIndex)).toBe(false);
    // Epoch map outlives the slot map.
    expect(cache.isKnownAtEpoch(epoch, validatorIndex)).toBe(true);
  });

  it("prune(slot) keeps slot entries within the lookback window", () => {
    const cache = new SeenPayloadAttesters();
    for (let i = 0; i < MAX_SLOTS_IN_CACHE; i++) {
      cache.add(slot + i, validatorIndex);
    }
    // prune at the highest slot in the window: oldest (`slot`) should still be retained
    // because the prune condition is `slot < clockSlot - MAX_SLOTS_IN_CACHE`.
    cache.prune(slot + MAX_SLOTS_IN_CACHE);
    expect(cache.isKnown(slot, validatorIndex)).toBe(true);
    expect(cache.isKnown(slot + MAX_SLOTS_IN_CACHE - 1, validatorIndex)).toBe(true);
  });

  it("pruneEpoch(epoch) evicts epoch entries outside the lookback window", () => {
    const cache = new SeenPayloadAttesters();
    cache.add(slot, validatorIndex);
    expect(cache.isKnownAtEpoch(epoch, validatorIndex)).toBe(true);

    cache.pruneEpoch(epoch + EPOCH_LOOKBACK_LIMIT + 1);
    expect(cache.isKnownAtEpoch(epoch, validatorIndex)).toBe(false);
  });

  it("pruneEpoch(epoch) keeps epoch entries within the lookback window", () => {
    const cache = new SeenPayloadAttesters();
    cache.add(slot, validatorIndex);

    cache.pruneEpoch(epoch + EPOCH_LOOKBACK_LIMIT);
    expect(cache.isKnownAtEpoch(epoch, validatorIndex)).toBe(true);
  });

  it("prune and pruneEpoch operate on independent maps", () => {
    const cache = new SeenPayloadAttesters();
    cache.add(slot, validatorIndex);

    // Heavy slot prune does not touch epoch liveness.
    cache.prune(slot + MAX_SLOTS_IN_CACHE + 100);
    expect(cache.isKnown(slot, validatorIndex)).toBe(false);
    expect(cache.isKnownAtEpoch(epoch, validatorIndex)).toBe(true);

    // Epoch prune does not resurrect slot entries.
    cache.pruneEpoch(epoch + EPOCH_LOOKBACK_LIMIT + 1);
    expect(cache.isKnown(slot, validatorIndex)).toBe(false);
    expect(cache.isKnownAtEpoch(epoch, validatorIndex)).toBe(false);
  });
});
