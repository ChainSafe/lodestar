import {ChainForkConfig} from "@lodestar/config";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {Slot, ValidatorIndex, focil} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {IClock} from "../../util/clock.js";
import {OpPoolError, OpPoolErrorCode} from "./types.js";
import {pruneBySlot} from "./utils.js";

/**
 *
 */
const SLOTS_RETAINED = 2; // TODO FOCIL: do we even need to retain previous slots?

/**
 * The maximum number of distinct `SignedInclusionList` that will be stored in each slot.
 *
 * This is a DoS protection measure.
 */
const MAX_INCLUSION_LISTS_PER_SLOT = INCLUSION_LIST_COMMITTEE_SIZE * 2;

type CachedInclusionList = {
  // TODO FOCIL: we might cache transactions here
  inclusionList: focil.SignedInclusionList;
  equivocated: boolean;
};

export enum InclusionListInsertOutcome {
  /**  */
  New = "New",
  /** Not existing in the pool but it's too old to add. No changes were made. */
  Old = "Old",
  /** The pool has reached its limit. No changes were made. */
  ReachLimit = "ReachLimit",
  /**  */
  Late = "Late",
  /** */
  Equivocated = "Equivocated",
}

/**
 *
 */
export class InclusionListPool {
  private readonly inclusionListByValidatorBySlot = new MapDef<Slot, Map<ValidatorIndex, CachedInclusionList>>(
    () => new Map<ValidatorIndex, CachedInclusionList>()
  );

  private lowestPermissibleSlot = 0;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly clock: IClock
  ) {}

  get size(): number {
    let count = 0;
    for (const inclusionListsByValidator of this.inclusionListByValidatorBySlot.values()) {
      count += Array.from(inclusionListsByValidator.values()).length;
    }
    return count;
  }

  add(inclusionList: focil.SignedInclusionList): InclusionListInsertOutcome {
    const {slot, validatorIndex} = inclusionList.message;

    // Reject any inclusion lists that are too old.
    if (slot < this.lowestPermissibleSlot) {
      return InclusionListInsertOutcome.Old;
    }

    // Reject inclusion lists in the current slot but come to this pool very late
    // TODO FOCIL: review if this is correct
    if (this.clock.secFromSlot(slot) > this.config.PROPOSER_INCLUSION_LIST_CUT_OFF) {
      return InclusionListInsertOutcome.Late;
    }

    // Limit object per slot
    const inclusionListsByValidator = this.inclusionListByValidatorBySlot.getOrDefault(slot);
    if (inclusionListsByValidator.size >= MAX_INCLUSION_LISTS_PER_SLOT) {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    }

    // Track equivocations
    const inclusionListByValidator = inclusionListsByValidator.get(inclusionList.message.validatorIndex);
    if (inclusionListByValidator) {
      inclusionListByValidator.equivocated = true;
      return InclusionListInsertOutcome.Equivocated;
    }

    // Create new inclusion list
    inclusionListsByValidator.set(validatorIndex, {inclusionList, equivocated: false});
    return InclusionListInsertOutcome.New;
  }

  /**
   *
   */
  get(slot: Slot): focil.SignedInclusionList[] {
    const inclusionLists: focil.SignedInclusionList[] = [];

    for (const inclusionListByValidator of [this.inclusionListByValidatorBySlot.get(slot)]) {
      if (inclusionListByValidator) {
        for (const {inclusionList, equivocated} of inclusionListByValidator.values()) {
          if (!equivocated) {
            inclusionLists.push(inclusionList);
          }
        }
      }
    }

    return inclusionLists;
  }

  getEntry(slot: Slot, validatorIndex: ValidatorIndex): CachedInclusionList | undefined {
    return this.inclusionListByValidatorBySlot.get(slot)?.get(validatorIndex);
  }

  /**
   *
   */
  prune(clockSlot: Slot): void {
    pruneBySlot(this.inclusionListByValidatorBySlot, clockSlot, SLOTS_RETAINED);
    this.lowestPermissibleSlot = Math.max(clockSlot - SLOTS_RETAINED, 0);
  }
}
