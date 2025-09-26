import {ChainForkConfig} from "@lodestar/config";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {Slot, ValidatorIndex, bellatrix, eip7805} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {byteArrayEquals} from "../../util/bytes.js";
import {IClock} from "../../util/clock.js";
import {OpPoolError, OpPoolErrorCode} from "./types.js";
import {pruneBySlot} from "./utils.js";

/**
 *
 */
const SLOTS_RETAINED = 2; // TODO EIP-7805: do we even need to retain previous slot?

/**
 * The maximum number of distinct `SignedInclusionList` that will be stored in each slot.
 *
 * This is a DoS protection measure.
 */
const MAX_INCLUSION_LISTS_PER_SLOT = INCLUSION_LIST_COMMITTEE_SIZE * 2;

type CachedInclusionList = {
  transactions: bellatrix.Transactions;
  seenTwice: boolean;
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
  SeenTwice = "SeenTwice",
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

  add(inclusionList: eip7805.SignedInclusionList): InclusionListInsertOutcome {
    const {slot, validatorIndex, transactions} = inclusionList.message;
    const fork = this.config.getForkName(slot);

    // Reject any inclusion lists that are too old.
    if (slot < this.lowestPermissibleSlot) {
      return InclusionListInsertOutcome.Old;
    }

    // Reject inclusion lists in the current slot but come to this pool very late
    // TODO EIP-7805: review if this is correct
    if (this.clock.msFromSlot(slot) > this.config.getProposerInclusionListCutoffMs(fork)) {
      return InclusionListInsertOutcome.Late;
    }

    // Limit object per slot
    const inclusionListsByValidator = this.inclusionListByValidatorBySlot.getOrDefault(slot);
    if (inclusionListsByValidator.size >= MAX_INCLUSION_LISTS_PER_SLOT) {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    }

    // Track equivocations
    const inclusionListByValidator = inclusionListsByValidator.get(validatorIndex);
    if (inclusionListByValidator) {
      inclusionListByValidator.seenTwice = true;
      return InclusionListInsertOutcome.SeenTwice;
    }

    // Create new inclusion list
    inclusionListsByValidator.set(validatorIndex, {transactions, seenTwice: false});
    return InclusionListInsertOutcome.New;
  }

  /**
   * Return a list of unique inclusion list transactions for the given slot
   */
  getTransactions(slot: Slot): bellatrix.Transactions {
    const uniqueTransactions: bellatrix.Transactions = [];

    const inclusionListsByValidator = this.inclusionListByValidatorBySlot.get(slot);
    if (!inclusionListsByValidator) {
      return uniqueTransactions;
    }

    for (const {transactions, seenTwice} of inclusionListsByValidator.values()) {
      if (seenTwice) {
        continue;
      }

      for (const transaction of transactions) {
        const duplicate = uniqueTransactions.some((existing) => byteArrayEquals(transaction, existing));

        if (!duplicate) {
          uniqueTransactions.push(transaction);
        }
      }
    }

    return uniqueTransactions;
  }

  seenTwice(slot: Slot, validatorIndex: ValidatorIndex): boolean {
    return this.inclusionListByValidatorBySlot.get(slot)?.get(validatorIndex)?.seenTwice === true;
  }

  /**
   *
   */
  prune(clockSlot: Slot): void {
    pruneBySlot(this.inclusionListByValidatorBySlot, clockSlot, SLOTS_RETAINED);
    this.lowestPermissibleSlot = Math.max(clockSlot - SLOTS_RETAINED, 0);
  }
}
