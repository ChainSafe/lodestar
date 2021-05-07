import {phase0, altair} from "@chainsafe/lodestar-types";
import {NUM_SLOTS_IN_CACHE, slotRootKey, SlotRootKey} from "./repositories/utils/syncCommittee";

type ContriButionsBySlotRoot = Map<SlotRootKey, altair.SyncCommitteeContribution[]>;
type SeenCacheKey = string;

/**
 * Cache SyncCommitteeContribution and seen ContributionAndProof.
 * This is used for SignedContributionAndProof validation and block factory.
 * This stays in-memory and should be pruned per slot.
 */
export class SeenSyncCommitteeContributionCache {
  private contributionsCache: Map<phase0.Slot, ContriButionsBySlotRoot> = new Map<
    phase0.Slot,
    ContriButionsBySlotRoot
  >();
  private seenCache: Map<phase0.Slot, Map<SeenCacheKey, boolean>> = new Map<phase0.Slot, Map<SeenCacheKey, boolean>>();

  /**
   * Only call this once we pass all validation.
   */
  addContributionAndProof(contributionAndProof: altair.ContributionAndProof): void {
    // contributionsCache
    const {contribution} = contributionAndProof;
    const {slot} = contribution;
    let contributionsBySlotRoot = this.contributionsCache.get(slot);
    if (!contributionsBySlotRoot) {
      contributionsBySlotRoot = new Map<SlotRootKey, altair.SyncCommitteeContribution[]>();
      this.contributionsCache.set(slot, contributionsBySlotRoot);
    }
    let key = slotRootKey(contribution);
    let contributions = contributionsBySlotRoot.get(key);
    if (!contributions) {
      contributions = [];
      contributionsBySlotRoot.set(key, contributions);
    }
    contributions.push(contribution);
    // seenCache
    let seenContributions = this.seenCache.get(slot);
    if (!seenContributions) {
      seenContributions = new Map<SeenCacheKey, boolean>();
      this.seenCache.set(slot, seenContributions);
    }
    key = seenCacheKey(contributionAndProof);
    seenContributions.set(key, true);
  }

  /**
   * This is for the validation.
   */
  hasContributionAndProof(contributionAndProof: altair.ContributionAndProof): boolean {
    const slot = contributionAndProof.contribution.slot;
    const seenContributions = this.seenCache.get(slot);
    if (seenContributions) {
      const key = seenCacheKey(contributionAndProof);
      return seenContributions.has(key);
    }
    return false;
  }

  /**
   * This is for the block factory
   */
  getSyncCommitteeContributions(slot: phase0.Slot, beaconBlockRoot: phase0.Root): altair.SyncCommitteeContribution[] {
    const contributionsBySlotRoot = this.contributionsCache.get(slot);
    if (contributionsBySlotRoot) {
      const key = slotRootKey({slot, beaconBlockRoot});
      return contributionsBySlotRoot.get(key) || [];
    }
    return [];
  }

  /**
   * Prune per clock slot.
   */
  prune(): void {
    const slots = Array.from(this.contributionsCache.keys());
    // object keys are stored in insertion order
    for (const slot of slots.slice(0, slots.length - NUM_SLOTS_IN_CACHE)) {
      this.contributionsCache.delete(slot);
      this.seenCache.delete(slot);
    }
  }
}

function seenCacheKey(contributionAndProof: altair.ContributionAndProof): SeenCacheKey {
  const {aggregatorIndex, contribution} = contributionAndProof;
  const {slot, subCommitteeIndex} = contribution;
  return "" + slot + "_" + aggregatorIndex + "_" + subCommitteeIndex;
}
