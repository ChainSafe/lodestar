import {MIN_ATTESTATION_INCLUSION_DELAY} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {Metrics} from "../metrics/metrics.js";

/**
 * Track upcoming block proposals of validators connected to this node, and the vote slots those blocks can include,
 * to only then insert single attestations into the SingleAttestationPool
 */
export class ProposerTracker {
  /** Local proposal slots that have not passed yet */
  private readonly proposalSlots = new Set<Slot>();
  /** Vote slots of tracked proposals, see `getFirstIncludableVoteSlot` */
  private readonly collectableSlots = new Set<Slot>();
  private clockSlot = 0;

  /**
   * @param ignoreProposalDuty dev only, collect every vote slot a block at the clock slot can include regardless of
   * local proposals
   */
  constructor(
    private readonly ignoreProposalDuty = false,
    metrics: Metrics | null = null
  ) {
    metrics?.proposerTracker.proposalSlots.addCollect(() =>
      metrics.proposerTracker.proposalSlots.set(this.proposalSlots.size)
    );
    metrics?.proposerTracker.collectableSlot.addCollect(() =>
      metrics.proposerTracker.collectableSlot.set(this.shouldCollect(this.clockSlot) ? 1 : 0)
    );
  }

  /**
   * Idempotent, a known proposal is ignored
   * @returns true if the proposal was not tracked before
   */
  addProposal(proposalSlot: Slot): boolean {
    if (this.proposalSlots.has(proposalSlot)) {
      return false;
    }

    this.proposalSlots.add(proposalSlot);
    for (
      let voteSlot = getFirstIncludableVoteSlot(proposalSlot);
      voteSlot <= proposalSlot - MIN_ATTESTATION_INCLUSION_DELAY;
      voteSlot++
    ) {
      this.collectableSlots.add(voteSlot);
    }
    return true;
  }

  shouldCollect(attestationSlot: Slot): boolean {
    if (this.ignoreProposalDuty) {
      // to test block production without proposal duties
      return attestationSlot >= getFirstIncludableVoteSlot(this.clockSlot);
    }
    return this.collectableSlots.has(attestationSlot);
  }

  /**
   * Drop proposals that have passed. A proposal is kept during its own slot so that its single attestations stay
   * available until the block is produced. Vote slots are dropped once no remaining proposal can include them.
   */
  prune(clockSlot: Slot): void {
    this.clockSlot = clockSlot;
    for (const proposalSlot of this.proposalSlots) {
      if (proposalSlot < clockSlot) {
        this.proposalSlots.delete(proposalSlot);
      }
    }

    if (this.proposalSlots.size === 0) {
      this.collectableSlots.clear();
      return;
    }

    // Each remaining proposal covers its own vote slots, so a vote slot below the lowest one is covered by none
    const lowestCollectableVoteSlot = getFirstIncludableVoteSlot(Math.min(...this.proposalSlots));
    for (const voteSlot of this.collectableSlots) {
      if (voteSlot < lowestCollectableVoteSlot) {
        this.collectableSlots.delete(voteSlot);
      }
    }
  }
}

/**
 * Since deneb (EIP-7045) a block includes attestations of its current and previous epoch, so the first vote slot it can
 * include is the start of the previous epoch, 32 to 63 slots before it on mainnet
 */
function getFirstIncludableVoteSlot(blockSlot: Slot): Slot {
  return computeStartSlotAtEpoch(Math.max(computeEpochAtSlot(blockSlot) - 1, 0));
}
