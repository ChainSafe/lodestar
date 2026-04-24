import {Slot, ValidatorIndex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * Proposer preferences are valid for the current or next epoch, so keep a small
 * buffer of past slots to protect against clock skew around slot boundaries.
 */
const SLOTS_RETAINED = 2;

/**
 * Tracks signed proposer preferences we've already seen per (proposal_slot, validator_index).
 *
 * Enforces the gossip rule:
 *   [IGNORE] The `signed_proposer_preferences` is the first valid message received
 *   from the validator with index `preferences.validator_index` and the given slot
 *   `preferences.proposal_slot`.
 */
export class SeenProposerPreferences {
  private readonly validatorIndexesBySlot = new MapDef<Slot, Set<ValidatorIndex>>(() => new Set<ValidatorIndex>());
  private lowestPermissibleSlot: Slot = 0;

  isKnown(proposalSlot: Slot, validatorIndex: ValidatorIndex): boolean {
    return this.validatorIndexesBySlot.get(proposalSlot)?.has(validatorIndex) === true;
  }

  add(proposalSlot: Slot, validatorIndex: ValidatorIndex): void {
    if (proposalSlot < this.lowestPermissibleSlot) {
      throw Error(`proposalSlot ${proposalSlot} < lowestPermissibleSlot ${this.lowestPermissibleSlot}`);
    }
    this.validatorIndexesBySlot.getOrDefault(proposalSlot).add(validatorIndex);
  }

  prune(currentSlot: Slot): void {
    this.lowestPermissibleSlot = Math.max(currentSlot - SLOTS_RETAINED, 0);
    for (const slot of this.validatorIndexesBySlot.keys()) {
      if (slot < this.lowestPermissibleSlot) {
        this.validatorIndexesBySlot.delete(slot);
      }
    }
  }
}
