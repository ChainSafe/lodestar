import {SLOTS_PER_EPOCH} from "@lodestar/params";
import type {RootHex, Slot, gloas} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";

/** Retains validated proposer preferences by the branch-specific identity used for bid validation. */
export class ProposerPreferencesTracker {
  private readonly byDependentRootBySlot = new MapDef<Slot, Map<RootHex, gloas.SignedProposerPreferences>>(
    () => new Map()
  );

  onProposerPreferences(signedProposerPreferences: gloas.SignedProposerPreferences): boolean {
    const {proposalSlot, dependentRoot} = signedProposerPreferences.message;
    const dependentRootHex = toRootHex(dependentRoot);
    const byDependentRoot = this.byDependentRootBySlot.getOrDefault(proposalSlot);

    if (byDependentRoot.has(dependentRootHex)) {
      return false;
    }

    byDependentRoot.set(dependentRootHex, signedProposerPreferences);
    return true;
  }

  get(slot: Slot, dependentRoot: RootHex): gloas.SignedProposerPreferences | null {
    return this.byDependentRootBySlot.get(slot)?.get(dependentRoot) ?? null;
  }

  count(slot: Slot): number {
    return this.byDependentRootBySlot.get(slot)?.size ?? 0;
  }

  snapshot(currentSlot: Slot): gloas.SignedProposerPreferences[] {
    const until = (Math.floor(currentSlot / SLOTS_PER_EPOCH) + 2) * SLOTS_PER_EPOCH;
    const result: gloas.SignedProposerPreferences[] = [];
    for (const [slot, byRoot] of this.byDependentRootBySlot) {
      if (slot < currentSlot || slot >= until) continue;
      let count = 0;
      for (const signed of byRoot.values()) {
        result.push(signed);
        if (++count === 4) break;
      }
    }
    return result;
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
