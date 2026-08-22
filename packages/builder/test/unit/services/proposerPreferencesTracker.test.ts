import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";

describe("ProposerPreferencesTracker", () => {
  function preferences(proposalSlot: number, dependentRootByte: number, feeRecipientByte: number) {
    const signed = ssz.gloas.SignedProposerPreferences.defaultValue();
    signed.message.proposalSlot = proposalSlot;
    signed.message.dependentRoot = Buffer.alloc(32, dependentRootByte);
    signed.message.feeRecipient = Buffer.alloc(20, feeRecipientByte);
    return signed;
  }

  it("returns preferences by slot", () => {
    const tracker = new ProposerPreferencesTracker();
    expect(tracker.get(1)).toBeNull();
    tracker.onProposerPreferences(preferences(1, 1, 1));
    expect(tracker.get(1)?.message.feeRecipient).toEqual(Buffer.alloc(20, 1));
  });

  it("returns the most recent entry if multiple dependent roots are known", () => {
    const tracker = new ProposerPreferencesTracker();
    tracker.onProposerPreferences(preferences(1, 1, 1));
    tracker.onProposerPreferences(preferences(1, 2, 2));
    expect(tracker.get(1)?.message.feeRecipient).toEqual(Buffer.alloc(20, 2));
  });

  it("prunes past slots", () => {
    const tracker = new ProposerPreferencesTracker();
    tracker.onProposerPreferences(preferences(1, 1, 1));
    tracker.prune(3);
    expect(tracker.get(1)).not.toBeNull();
    tracker.prune(4);
    expect(tracker.get(1)).toBeNull();
  });
});
