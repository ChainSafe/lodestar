import {describe, expect, it} from "vitest";
import {ProposerTracker} from "../../../src/chain/proposerTracker.js";

describe("chain / ProposerTracker", () => {
  it("collects the vote slots proposalSlot - N ... proposalSlot - 1", () => {
    const tracker = new ProposerTracker(8);
    expect(tracker.addProposal(1000)).toBe(true);

    expect(tracker.shouldCollect(991)).toBe(false);
    for (let slot = 992; slot <= 999; slot++) {
      expect(tracker.shouldCollect(slot), `slot ${slot}`).toBe(true);
    }
    expect(tracker.shouldCollect(1000)).toBe(false);
  });

  it("returns true only for a new proposal", () => {
    const tracker = new ProposerTracker(8);
    expect(tracker.addProposal(1000)).toBe(true);
    expect(tracker.addProposal(1000)).toBe(false);
    expect(tracker.addProposal(1001)).toBe(true);
  });

  it("is disabled with 0 slots", () => {
    const tracker = new ProposerTracker(0);
    expect(tracker.addProposal(1000)).toBe(false);
    expect(tracker.shouldCollect(999)).toBe(false);
  });

  it("keeps a proposal during its slot and drops it after", () => {
    const tracker = new ProposerTracker(8);
    tracker.addProposal(1000);

    tracker.prune(1000);
    expect(tracker.shouldCollect(999)).toBe(true);

    tracker.prune(1001);
    expect(tracker.shouldCollect(999)).toBe(false);
    expect(tracker.addProposal(1000)).toBe(true);
  });

  it("keeps vote slots still covered by a later proposal", () => {
    const tracker = new ProposerTracker(8);
    tracker.addProposal(1000);
    tracker.addProposal(1004);

    tracker.prune(1001);
    // only covered by the passed proposal 1000
    for (let slot = 992; slot <= 995; slot++) {
      expect(tracker.shouldCollect(slot), `slot ${slot}`).toBe(false);
    }
    // covered by proposal 1004
    for (let slot = 996; slot <= 1003; slot++) {
      expect(tracker.shouldCollect(slot), `slot ${slot}`).toBe(true);
    }
  });
});
