import {Slot, ValidatorIndex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * Tracks signed proposer preferences we've already seen per (proposal_slot, validator_index).
 *
 * Enforces the gossip rule:
 *   [IGNORE] The `signed_proposer_preferences` is the first valid message received
 *   from the validator with index `preferences.validator_index` and the given slot
 *   `preferences.proposal_slot`.
 *
 * Entries are only load-bearing while `proposal_slot > state.slot`. Once the slot
 * has passed, the `[IGNORE] preferences.proposal_slot > state.slot` rule takes over
 * and this cache is no longer consulted for that slot.
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
   * Drop entries for slots that have already passed. Called on clock slot tick.
   */
  prune(currentSlot: Slot): void {
    for (const slot of this.validatorIndexesBySlot.keys()) {
      if (slot < currentSlot) {
        this.validatorIndexesBySlot.delete(slot);
      }
    }
  }
}
