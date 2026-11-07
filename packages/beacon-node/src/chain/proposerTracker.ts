import {MIN_ATTESTATION_INCLUSION_DELAY} from "@lodestar/params";
import {Slot} from "@lodestar/types";

/**
 * Track upcoming block proposals of validators connected to this node, and the vote slots those blocks can include,
 * to only then insert single attestations into the SingleAttestationPool
 */
export class ProposerTracker {
  /** Local proposal slots that have not passed yet */
  private readonly proposalSlots = new Set<Slot>();
  /** Vote slots `proposalSlot - singleAttestationSlotsBeforeProposal ... proposalSlot - 1` of tracked proposals */
  private readonly collectableVoteSlots = new Set<Slot>();

  /**
   * @param singleAttestationSlotsBeforeProposal validated to be in `[0, SLOTS_PER_EPOCH]`, 0 disables the tracker
   */
  constructor(private readonly singleAttestationSlotsBeforeProposal: number) {}

  /**
   * Idempotent, a known proposal is ignored
   * @returns true if the proposal was not tracked before
   */
  addProposal(proposalSlot: Slot): boolean {
    if (this.singleAttestationSlotsBeforeProposal === 0 || this.proposalSlots.has(proposalSlot)) {
      return false;
    }

    this.proposalSlots.add(proposalSlot);
    for (
      let voteSlot = proposalSlot - this.singleAttestationSlotsBeforeProposal;
      voteSlot <= proposalSlot - MIN_ATTESTATION_INCLUSION_DELAY;
      voteSlot++
    ) {
      this.collectableVoteSlots.add(voteSlot);
    }
    return true;
  }

  shouldCollect(attestationSlot: Slot): boolean {
    return this.collectableVoteSlots.has(attestationSlot);
  }

  /**
   * Drop proposals that have passed. A proposal is kept during its own slot so that its single attestations stay
   * available until the block is produced. Vote slots are dropped once no remaining proposal can include them.
   */
  prune(clockSlot: Slot): void {
    for (const proposalSlot of this.proposalSlots) {
      if (proposalSlot < clockSlot) {
        this.proposalSlots.delete(proposalSlot);
      }
    }

    if (this.proposalSlots.size === 0) {
      this.collectableVoteSlots.clear();
      return;
    }

    // Each remaining proposal covers its own vote slots, so a vote slot below the lowest one is covered by none
    const lowestCollectableVoteSlot = Math.min(...this.proposalSlots) - this.singleAttestationSlotsBeforeProposal;
    for (const voteSlot of this.collectableVoteSlots) {
      if (voteSlot < lowestCollectableVoteSlot) {
        this.collectableVoteSlots.delete(voteSlot);
      }
    }
  }
}
