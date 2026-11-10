import {describe, expect, it} from "vitest";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ProposerTracker} from "../../../src/chain/proposerTracker.js";

describe("chain / ProposerTracker", () => {
  it("collects the vote slots from the start of the previous epoch to proposalSlot - 1", () => {
    const tracker = new ProposerTracker();
    const proposalSlot = computeStartSlotAtEpoch(10) + 3;
    const firstVoteSlot = computeStartSlotAtEpoch(9);
    expect(tracker.addProposal(proposalSlot)).toBe(true);

    expect(tracker.shouldCollect(firstVoteSlot - 1)).toBe(false);
    for (let slot = firstVoteSlot; slot < proposalSlot; slot++) {
      expect(tracker.shouldCollect(slot), `slot ${slot}`).toBe(true);
    }
    expect(tracker.shouldCollect(proposalSlot)).toBe(false);
  });

  it("returns true only for a new proposal", () => {
    const tracker = new ProposerTracker();
    expect(tracker.addProposal(1000)).toBe(true);
    expect(tracker.addProposal(1000)).toBe(false);
    expect(tracker.addProposal(1001)).toBe(true);
  });

  it("keeps a proposal during its slot and drops it after", () => {
    const tracker = new ProposerTracker();
    tracker.addProposal(1000);

    tracker.prune(1000);
    expect(tracker.shouldCollect(999)).toBe(true);

    tracker.prune(1001);
    expect(tracker.shouldCollect(999)).toBe(false);
    expect(tracker.addProposal(1000)).toBe(true);
  });

  it("keeps vote slots still covered by a later proposal", () => {
    const tracker = new ProposerTracker();
    const proposalSlot = computeStartSlotAtEpoch(10) + 1;
    const laterProposalSlot = computeStartSlotAtEpoch(11) + 1;
    tracker.addProposal(proposalSlot);
    tracker.addProposal(laterProposalSlot);

    tracker.prune(proposalSlot + 1);
    // epoch 9 is only covered by the passed proposal
    for (let slot = computeStartSlotAtEpoch(9); slot < computeStartSlotAtEpoch(10); slot++) {
      expect(tracker.shouldCollect(slot), `slot ${slot}`).toBe(false);
    }
    // covered by the later proposal
    for (let slot = computeStartSlotAtEpoch(10); slot < laterProposalSlot; slot++) {
      expect(tracker.shouldCollect(slot), `slot ${slot}`).toBe(true);
    }
  });

  it("collects every includable vote slot regardless of proposals with ignoreProposalDuty", () => {
    const tracker = new ProposerTracker(true);
    tracker.prune(computeStartSlotAtEpoch(10) + 2);
    expect(tracker.shouldCollect(computeStartSlotAtEpoch(9) - 1)).toBe(false);
    expect(tracker.shouldCollect(computeStartSlotAtEpoch(9))).toBe(true);
  });
});
