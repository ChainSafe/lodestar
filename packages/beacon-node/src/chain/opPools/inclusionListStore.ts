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
  /** Identical inclusion list already stored. */
  Seen = "Seen",
  /** New equivocation evidence: this validator already has a different inclusion list stored. */
  Equivocating = "Equivocating",
  /** Validator was already marked as an equivocator for this `(slot, dependent_root)`. */
  SubsequentEquivocation = "SubsequentEquivocation",
}

type InclusionListEntry = {
  signedInclusionList: heze.SignedInclusionList;
  /** Positions of the validator in `get_inclusion_list_committee(state, slot)`, several when the committee cycles */
  committeeIndices: number[];
  /** Received before the inclusion list deadline of its slot. */
  timely: boolean;
};

/**
 * Spec `InclusionListStore`: inclusion lists keyed by `(slot, dependent_root)`, one per validator index.
 * The committee position is recorded at insert time (gossip validation resolves it) so the bit-oriented
 * reads need no shuffling lookup. Signed lists are kept so InclusionListsByIndices can serve them.
 * A validator's first list stays stored and an equivocation marks the validator so reads skip it.
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
  /** slot -> dependent_root -> validator index -> count, for the p2p "first or second message" rule */
  private readonly validatorIlCounts = new MapDef<Slot, MapDef<RootHex, Map<ValidatorIndex, number>>>(
    () => new MapDef<RootHex, Map<ValidatorIndex, number>>(() => new Map())
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
   * Late lists are stored with `timely=false` rather than dropped: they still count toward the
   * non-timely view used to validate another node's `inclusion_list_bits`.
   */
  process(
    signedInclusionList: heze.SignedInclusionList,
    committeeIndices: number[],
    timely: boolean
  ): InclusionListInsertOutcome {
    const inclusionList = signedInclusionList.message;
    const {slot, validatorIndex} = inclusionList;

    if (slot < this.lowestPermissibleSlot) {
      return InclusionListInsertOutcome.Old;
    }

    const dependentRoot = toRootHex(inclusionList.dependentRoot);
    const counts = this.validatorIlCounts.getOrDefault(slot).getOrDefault(dependentRoot);
    counts.set(validatorIndex, (counts.get(validatorIndex) ?? 0) + 1);

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

    stored.set(validatorIndex, {signedInclusionList, committeeIndices, timely});
    return InclusionListInsertOutcome.New;
  }

  /** Gossip rule: at most two valid messages per validator for a `(slot, dependent_root)` */
  seenTwice(slot: Slot, dependentRoot: RootHex, validatorIndex: ValidatorIndex): boolean {
    return (this.validatorIlCounts.get(slot)?.get(dependentRoot)?.get(validatorIndex) ?? 0) >= 2;
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
    for (const {committeeIndices} of this.getEligible(slot, dependentRoot, onlyTimely)) {
      for (const committeeIndex of committeeIndices) {
        bits.set(committeeIndex, true);
      }
    }
    return bits;
  }

  /** True iff `bits` has a bit set for every bit set in the local inclusion list bits. */
  isInclusionListBitsInclusive(slot: Slot, dependentRoot: RootHex, bits: BitArray, onlyTimely = true): boolean {
    for (const {committeeIndices} of this.getEligible(slot, dependentRoot, onlyTimely)) {
      if (committeeIndices.some((committeeIndex) => !bits.get(committeeIndex))) {
        return false;
      }
    }
    return true;
  }

  /** Inclusion lists for the given committee positions, to serve InclusionListsByIndices. */
  getByIndices(slot: Slot, dependentRoot: RootHex, indices: BitArray): heze.SignedInclusionList[] {
    const out: heze.SignedInclusionList[] = [];
    for (const {signedInclusionList, committeeIndices} of this.getEligible(slot, dependentRoot, false)) {
      if (committeeIndices.some((committeeIndex) => indices.get(committeeIndex))) {
        out.push(signedInclusionList);
      }
    }
    return out;
  }

  /** Lists are retained for MIN_SLOTS_FOR_INCLUSION_LISTS_REQUESTS slots so InclusionListsByIndices can serve them */
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
    for (const slot of this.validatorIlCounts.keys()) {
      if (slot < horizon) {
        this.validatorIlCounts.delete(slot);
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
