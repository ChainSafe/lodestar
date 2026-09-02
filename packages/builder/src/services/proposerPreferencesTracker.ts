import type {RootHex, Slot, gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";

/** Retains validated proposer preferences by the branch-specific identity used for bid validation. */
export class ProposerPreferencesTracker {
  private readonly byDependentRootBySlot = new Map<Slot, Map<RootHex, gloas.SignedProposerPreferences>>();

  onProposerPreferences(signedProposerPreferences: gloas.SignedProposerPreferences): boolean {
    const {proposalSlot, dependentRoot} = signedProposerPreferences.message;
    const dependentRootHex = toRootHex(dependentRoot);
    let byDependentRoot = this.byDependentRootBySlot.get(proposalSlot);
    if (byDependentRoot === undefined) {
      byDependentRoot = new Map();
      this.byDependentRootBySlot.set(proposalSlot, byDependentRoot);
    }

    if (byDependentRoot.has(dependentRootHex)) {
      return false;
    }

    byDependentRoot.set(dependentRootHex, signedProposerPreferences);
    return true;
  }

  get(slot: Slot, dependentRoot: RootHex): gloas.SignedProposerPreferences | null {
    return this.byDependentRootBySlot.get(slot)?.get(dependentRoot) ?? null;
  }

  prune(currentSlot: Slot): number {
    let removed = 0;
    for (const [slot, byDependentRoot] of this.byDependentRootBySlot) {
      if (slot >= currentSlot) {
        continue;
      }

      removed += byDependentRoot.size;
      this.byDependentRootBySlot.delete(slot);
    }
    return removed;
  }
}
