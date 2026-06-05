import {RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * Tracks signed proposer preferences we've already seen per (dependent_root, proposal_slot, validator_index).
 */
export class SeenProposerPreferences {
  private readonly validatorByDependentRootBySlot = new MapDef<Slot, Map<RootHex, ValidatorIndex>>(
    () => new Map<RootHex, ValidatorIndex>()
  );

  isKnown(dependentRoot: RootHex, proposalSlot: Slot, validatorIndex: ValidatorIndex): boolean {
    return this.validatorByDependentRootBySlot.get(proposalSlot)?.get(dependentRoot) === validatorIndex;
  }

  add(dependentRoot: RootHex, proposalSlot: Slot, validatorIndex: ValidatorIndex): void {
    this.validatorByDependentRootBySlot.getOrDefault(proposalSlot).set(dependentRoot, validatorIndex);
  }

  /**
   * Entries are only load-bearing while `proposal_slot > current_slot`. Once the slot has
   * passed the `[IGNORE] proposal_slot > current_slot` gossip rule takes over, so drop them
   * on each slot tick.
   */
  prune(currentSlot: Slot): void {
    for (const slot of this.validatorByDependentRootBySlot.keys()) {
      if (slot < currentSlot) {
        this.validatorByDependentRootBySlot.delete(slot);
      }
    }
  }
}
