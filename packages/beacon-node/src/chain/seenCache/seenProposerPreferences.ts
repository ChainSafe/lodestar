import {Slot, ValidatorIndex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * Tracks signed proposer preferences we've already seen per (proposal_slot, validator_index).
 */
export class SeenProposerPreferences {
  private readonly validatorIndexesBySlot = new MapDef<Slot, Set<ValidatorIndex>>(() => new Set<ValidatorIndex>());

  isKnown(proposalSlot: Slot, validatorIndex: ValidatorIndex): boolean {
    return this.validatorIndexesBySlot.get(proposalSlot)?.has(validatorIndex) === true;
  }

  add(proposalSlot: Slot, validatorIndex: ValidatorIndex): void {
    this.validatorIndexesBySlot.getOrDefault(proposalSlot).add(validatorIndex);
  }

  /**
   * Entries are only load-bearing while `proposal_slot > state.slot`. Once the slot has passed the
   * `[IGNORE] proposal_slot > state.slot` gossip rule takes over, so drop them on each slot tick.
   */
  prune(currentSlot: Slot): void {
    for (const slot of this.validatorIndexesBySlot.keys()) {
      if (slot < currentSlot) {
        this.validatorIndexesBySlot.delete(slot);
      }
    }
  }
}
