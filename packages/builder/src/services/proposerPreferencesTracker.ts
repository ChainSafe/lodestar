import {RootHex, Slot, gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";

/** Keep preferences for slots up to this many slots in the past, bids for those can no longer be made */
const PRUNE_SLOTS = 2;

/**
 * Tracks SignedProposerPreferences seen by the beacon node. A bid must use the proposer's
 * preferred fee recipient for its slot, otherwise it is not forwarded.
 */
export class ProposerPreferencesTracker {
  private readonly byDependentRootBySlot = new Map<Slot, Map<RootHex, gloas.SignedProposerPreferences>>();

  onProposerPreferences(signed: gloas.SignedProposerPreferences): void {
    const {proposalSlot, dependentRoot} = signed.message;
    let byDependentRoot = this.byDependentRootBySlot.get(proposalSlot);
    if (byDependentRoot === undefined) {
      byDependentRoot = new Map();
      this.byDependentRootBySlot.set(proposalSlot, byDependentRoot);
    }
    byDependentRoot.set(toRootHex(dependentRoot), signed);
  }

  /**
   * Preferences for a slot. If preferences for multiple dependent roots are known (proposer
   * shuffling differs across branches) the most recently seen entry is returned.
   */
  get(slot: Slot): gloas.SignedProposerPreferences | null {
    const byDependentRoot = this.byDependentRootBySlot.get(slot);
    if (byDependentRoot === undefined || byDependentRoot.size === 0) {
      return null;
    }
    let latest: gloas.SignedProposerPreferences | null = null;
    for (const signed of byDependentRoot.values()) {
      latest = signed;
    }
    return latest;
  }

  prune(currentSlot: Slot): void {
    for (const slot of this.byDependentRootBySlot.keys()) {
      if (slot < currentSlot - PRUNE_SLOTS) {
        this.byDependentRootBySlot.delete(slot);
      }
    }
  }

  get size(): number {
    return this.byDependentRootBySlot.size;
  }
}
