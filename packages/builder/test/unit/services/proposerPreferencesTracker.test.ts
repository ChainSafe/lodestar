import {describe, expect, it} from "vitest";
import type {RootHex} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";

describe("ProposerPreferencesTracker", () => {
  it("returns preferences only for the exact slot and dependent root", () => {
    const tracker = new ProposerPreferencesTracker();
    const signed = preferences(4, 1, 2);

    expect(tracker.onProposerPreferences(signed)).toBe(true);
    expect(tracker.get(4, root(1))).toBe(signed);
    expect(tracker.get(5, root(1))).toBeNull();
    expect(tracker.get(4, root(2))).toBeNull();
  });

  it("retains separate branch preferences for one proposal slot", () => {
    const tracker = new ProposerPreferencesTracker();
    const first = preferences(4, 1, 2);
    const second = preferences(4, 2, 3);

    tracker.onProposerPreferences(first);
    tracker.onProposerPreferences(second);

    expect(tracker.get(4, root(1))).toBe(first);
    expect(tracker.get(4, root(2))).toBe(second);
  });

  it("preserves the first validated preferences for a duplicate identity", () => {
    const tracker = new ProposerPreferencesTracker();
    const first = preferences(4, 1, 2);
    const duplicate = preferences(4, 1, 3);

    expect(tracker.onProposerPreferences(first)).toBe(true);
    expect(tracker.onProposerPreferences(duplicate)).toBe(false);
    expect(tracker.get(4, root(1))).toBe(first);
  });

  it("prunes past proposal slots while retaining current and future preferences", () => {
    const tracker = new ProposerPreferencesTracker();
    tracker.onProposerPreferences(preferences(3, 1, 2));
    tracker.onProposerPreferences(preferences(4, 2, 3));
    tracker.onProposerPreferences(preferences(5, 3, 4));

    expect(tracker.prune(4)).toBe(1);
    expect(tracker.get(3, root(1))).toBeNull();
    expect(tracker.get(4, root(2))).not.toBeNull();
    expect(tracker.get(5, root(3))).not.toBeNull();
    expect(tracker.prune(4)).toBe(0);
  });
});

function preferences(
  proposalSlot: number,
  dependentRootByte: number,
  feeRecipientByte: number
): ReturnType<typeof ssz.gloas.SignedProposerPreferences.defaultValue> {
  const signed = ssz.gloas.SignedProposerPreferences.defaultValue();
  signed.message.proposalSlot = proposalSlot;
  signed.message.dependentRoot = Uint8Array.from({length: 32}, () => dependentRootByte);
  signed.message.feeRecipient = Uint8Array.from({length: 20}, () => feeRecipientByte);
  return signed;
}

function root(byte: number): RootHex {
  return toRootHex(Uint8Array.from({length: 32}, () => byte));
}
