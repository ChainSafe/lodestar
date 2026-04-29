import {RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * Tracks signed proposer preferences we've already seen per (dependent_root, proposal_slot, validator_index).
 */
export class SeenProposerPreferences {
  private readonly bySlotByDependentRoot = new MapDef<RootHex, Map<Slot, ValidatorIndex>>(
    () => new Map<Slot, ValidatorIndex>()
  );

  isKnown(dependentRoot: RootHex, proposalSlot: Slot, validatorIndex: ValidatorIndex): boolean {
    return this.bySlotByDependentRoot.get(dependentRoot)?.get(proposalSlot) === validatorIndex;
  }

  add(dependentRoot: RootHex, proposalSlot: Slot, validatorIndex: ValidatorIndex): void {
    this.bySlotByDependentRoot.getOrDefault(dependentRoot).set(proposalSlot, validatorIndex);
  }

  /**
   * Entries are only load-bearing while `proposal_slot > current_slot`. Once the slot has
   * passed the `[IGNORE] proposal_slot > current_slot` gossip rule takes over, so drop them
   * on each slot tick.
   */
  prune(currentSlot: Slot): void {
    for (const [dependentRoot, slotMap] of this.bySlotByDependentRoot.entries()) {
      for (const slot of slotMap.keys()) {
        if (slot < currentSlot) {
          slotMap.delete(slot);
        }
      }
      if (slotMap.size === 0) {
        this.bySlotByDependentRoot.delete(dependentRoot);
      }
    }
  }
}
