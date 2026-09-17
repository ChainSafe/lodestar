import {BitArray} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {RootHex, Slot, ValidatorIndex, bellatrix, heze, ssz} from "@lodestar/types";
import {MapDef, toHex, toRootHex} from "@lodestar/utils";

export enum InclusionListInsertOutcome {
  /** Stored as a new entry. */
  New = "New",
  /** Slot is older than the prune horizon. */
  Old = "Old",
  /** `(slot, dependent_root)` is at capacity. */
  ReachLimit = "ReachLimit",
  /** Identical inclusion list already stored. */
  Seen = "Seen",
  /** New equivocation evidence: this validator already has a different inclusion list stored. */
  Equivocating = "Equivocating",
  /** Validator was already marked as an equivocator for this `(slot, dependent_root)`. */
  SubsequentEquivocation = "SubsequentEquivocation",
}

type InclusionListEntry = {
  signedInclusionList: heze.SignedInclusionList;
  /** Position of the validator in `get_inclusion_list_committee(state, slot)` for this `(slot, dependent_root)`. */
  committeeIndex: number;
  /** Received before the inclusion list deadline of its slot. */
  timely: boolean;
};

/**
 * Pool of inclusion lists, keyed by `(slot, dependent_root)` with one entry per validator index
 * (spec `InclusionListStore`).
 *
 * The committee of a `(slot, dependent_root)` is fixed, so the validator's committee position is
 * recorded at insert time (gossip validation already resolves the committee) and the bit-oriented
 * read paths need no shuffling lookup.
 *
 * Signed inclusion lists are retained rather than unwrapped messages so InclusionListsByIndices
 * can serve them back to peers.
 *
 * The first inclusion list of a validator stays stored; an equivocation marks the validator so the
 * read paths skip it, as in spec `process_inclusion_list`.
 */
export class InclusionListStore {
  /** slot -> dependent_root -> validator index -> entry */
  private readonly inclusionLists = new MapDef<Slot, MapDef<RootHex, Map<ValidatorIndex, InclusionListEntry>>>(
    () => new MapDef<RootHex, Map<ValidatorIndex, InclusionListEntry>>(() => new Map())
  );
  /** slot -> dependent_root -> equivocating validator indices */
  private readonly equivocators = new MapDef<Slot, MapDef<RootHex, Set<ValidatorIndex>>>(
    () => new MapDef<RootHex, Set<ValidatorIndex>>(() => new Set())
  );
  /** slot -> validator index -> count, for the p2p "first or second message" rule */
  private readonly validatorIlCountBySlot = new MapDef<Slot, Map<ValidatorIndex, number>>(
    () => new Map<ValidatorIndex, number>()
  );

  private lowestPermissibleSlot = 0;

  constructor(private readonly config: BeaconConfig) {}

  get size(): number {
    let count = 0;
    for (const byDependentRoot of this.inclusionLists.values()) {
      for (const entries of byDependentRoot.values()) {
        count += entries.size;
      }
    }
    return count;
  }

  /**
   * Store a signed inclusion list along with the locally observed timeliness.
   *
   * Late inclusion lists are stored with `timely=false` rather than dropped: they still count
   * toward the non-timely view used when validating another node's `inclusion_list_bits`.
   */
  process(
    signedInclusionList: heze.SignedInclusionList,
    committeeIndex: number,
    timely: boolean
  ): InclusionListInsertOutcome {
    const inclusionList = signedInclusionList.message;
    const {slot, validatorIndex} = inclusionList;

    if (slot < this.lowestPermissibleSlot) {
      return InclusionListInsertOutcome.Old;
    }

    const counts = this.validatorIlCountBySlot.getOrDefault(slot);
    counts.set(validatorIndex, (counts.get(validatorIndex) ?? 0) + 1);

    const dependentRoot = toRootHex(inclusionList.dependentRoot);
    const stored = this.inclusionLists.getOrDefault(slot).getOrDefault(dependentRoot);

    const entry = stored.get(validatorIndex);
    if (entry !== undefined) {
      if (ssz.heze.InclusionList.equals(entry.signedInclusionList.message, inclusionList)) {
        return InclusionListInsertOutcome.Seen;
      }
      const equivocators = this.equivocators.getOrDefault(slot).getOrDefault(dependentRoot);
      if (equivocators.has(validatorIndex)) {
        return InclusionListInsertOutcome.SubsequentEquivocation;
      }
      equivocators.add(validatorIndex);
      return InclusionListInsertOutcome.Equivocating;
    }

    if (stored.size >= INCLUSION_LIST_COMMITTEE_SIZE) {
      return InclusionListInsertOutcome.ReachLimit;
    }

    stored.set(validatorIndex, {signedInclusionList, committeeIndex, timely});
    return InclusionListInsertOutcome.New;
  }

  /**
   * Used by gossip validation to enforce "the message is either the first or second valid message
   * received from the validator with index validator_index" for the slot.
   */
  seenTwice(slot: Slot, validatorIndex: ValidatorIndex): boolean {
    return (this.validatorIlCountBySlot.get(slot)?.get(validatorIndex) ?? 0) >= 2;
  }

  /** Deduplicated transactions from valid, non-equivocating inclusion lists at `(slot, dependentRoot)`. */
  getInclusionListTransactions(slot: Slot, dependentRoot: RootHex, onlyTimely = true): bellatrix.Transactions {
    const transactions: bellatrix.Transactions = [];
    const seen = new Set<string>();

    for (const {signedInclusionList} of this.getEligible(slot, dependentRoot, onlyTimely)) {
      for (const transaction of signedInclusionList.message.transactions) {
        const key = toHex(transaction);
        if (!seen.has(key)) {
          seen.add(key);
          transactions.push(transaction);
        }
      }
    }

    return transactions;
  }

  /** Bit `i` is set iff committee member `i` submitted a valid, non-equivocating inclusion list. */
  getInclusionListBits(slot: Slot, dependentRoot: RootHex, onlyTimely = true): BitArray {
    const bits = BitArray.fromBitLen(INCLUSION_LIST_COMMITTEE_SIZE);
    for (const {committeeIndex} of this.getEligible(slot, dependentRoot, onlyTimely)) {
      bits.set(committeeIndex, true);
    }
    return bits;
  }

  /** True iff `bits` has a bit set for every bit set in the local inclusion list bits. */
  isInclusionListBitsInclusive(slot: Slot, dependentRoot: RootHex, bits: BitArray, onlyTimely = true): boolean {
    for (const {committeeIndex} of this.getEligible(slot, dependentRoot, onlyTimely)) {
      if (!bits.get(committeeIndex)) {
        return false;
      }
    }
    return true;
  }

  /** Inclusion lists for the given committee positions, to serve InclusionListsByIndices. */
  getByIndices(slot: Slot, dependentRoot: RootHex, indices: BitArray): heze.SignedInclusionList[] {
    const out: heze.SignedInclusionList[] = [];
    for (const {signedInclusionList, committeeIndex} of this.getEligible(slot, dependentRoot, false)) {
      if (indices.get(committeeIndex)) {
        out.push(signedInclusionList);
      }
    }
    return out;
  }

  /**
   * Inclusion lists MUST be retained for at least MIN_SLOTS_FOR_INCLUSION_LISTS_REQUESTS slots
   * beyond their slot so InclusionListsByIndices can still serve them.
   */
  prune(clockSlot: Slot): void {
    const horizon = clockSlot - this.config.MIN_SLOTS_FOR_INCLUSION_LISTS_REQUESTS;

    for (const slot of this.inclusionLists.keys()) {
      if (slot < horizon) {
        this.inclusionLists.delete(slot);
      }
    }
    for (const slot of this.equivocators.keys()) {
      if (slot < horizon) {
        this.equivocators.delete(slot);
      }
    }
    for (const slot of this.validatorIlCountBySlot.keys()) {
      if (slot < horizon) {
        this.validatorIlCountBySlot.delete(slot);
      }
    }

    this.lowestPermissibleSlot = Math.max(horizon, 0);
  }

  /** Entries at `(slot, dependentRoot)` from non-equivocating validators, timely when required. */
  private *getEligible(slot: Slot, dependentRoot: RootHex, onlyTimely: boolean): Generator<InclusionListEntry> {
    const stored = this.inclusionLists.get(slot)?.get(dependentRoot);
    if (!stored || stored.size === 0) {
      return;
    }
    const equivocators = this.equivocators.get(slot)?.get(dependentRoot);

    for (const [validatorIndex, entry] of stored) {
      if (equivocators?.has(validatorIndex)) {
        continue;
      }
      if (onlyTimely && !entry.timely) {
        continue;
      }
      yield entry;
    }
  }
}
