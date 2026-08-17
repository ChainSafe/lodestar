import {BitArray} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import type {IBeaconStateViewHeze} from "@lodestar/state-transition";
import {RootHex, Slot, ValidatorIndex, bellatrix, heze, ssz} from "@lodestar/types";
import {MapDef, toHex, toRootHex} from "@lodestar/utils";

/**
 * Maximum number of distinct inclusion lists retained per committee root.
 *
 * process() stores at most one inclusion list per validator, so the natural bound is
 * INCLUSION_LIST_COMMITTEE_SIZE. Gossip validation already rejects inclusion lists from
 * validators outside the committee, but on_inclusion_list has no such check yet, so keep a
 * headroom bound here as a DoS guard rather than trusting the caller.
 */
const MAX_INCLUSION_LISTS_PER_COMMITTEE = INCLUSION_LIST_COMMITTEE_SIZE * 2;

export enum InclusionListInsertOutcome {
  /** Stored as a new entry. */
  New = "New",
  /** Slot is older than the prune horizon. */
  Old = "Old",
  /** Committee root is at capacity. */
  ReachLimit = "ReachLimit",
  /** Identical inclusion list already stored. */
  Seen = "Seen",
  /** New equivocation evidence: this validator already has a different inclusion list stored. */
  Equivocating = "Equivocating",
  /** Validator was already marked as an equivocator for this committee root. */
  SubsequentEquivocation = "SubsequentEquivocation",
}

/**
 * Pool of inclusion lists, keyed by `inclusion_list_committee_root`.
 *
 * The committee root is the spec key and already pins down the slot, so slot is not part of it.
 * `committeeRootsBySlot` exists only so prune() can find the roots belonging to a passed slot.
 *
 * Signed inclusion lists are retained rather than unwrapped messages so InclusionListsByIndices
 * can serve them back to peers.
 *
 * Equivocators are tracked per committee root instead of being removed from `inclusionLists`,
 * because the read paths filter by validator index: once a validator equivocates, every
 * inclusion list it sent for that committee root stops counting, including the one already
 * stored.
 */
export class InclusionListStore {
  /** committee_root -> inclusion_list_root -> SignedInclusionList */
  private readonly inclusionLists = new MapDef<RootHex, Map<RootHex, heze.SignedInclusionList>>(
    () => new Map<RootHex, heze.SignedInclusionList>()
  );
  /** inclusion_list_root -> was received before the gossip deadline */
  private readonly inclusionListTimeliness = new Map<RootHex, boolean>();
  /** committee_root -> equivocating validator indices */
  private readonly equivocators = new MapDef<RootHex, Set<ValidatorIndex>>(() => new Set<ValidatorIndex>());
  /** slot -> committee roots seen at that slot, for pruning */
  private readonly committeeRootsBySlot = new MapDef<Slot, Set<RootHex>>(() => new Set<RootHex>());
  /** slot -> validator index -> count, for the p2p "first or second message" rule */
  private readonly validatorIlCountBySlot = new MapDef<Slot, Map<ValidatorIndex, number>>(
    () => new Map<ValidatorIndex, number>()
  );

  private lowestPermissibleSlot = 0;

  constructor(private readonly config: BeaconConfig) {}

  get size(): number {
    let count = 0;
    for (const inclusionLists of this.inclusionLists.values()) {
      count += inclusionLists.size;
    }
    return count;
  }

  /**
   * Store a signed inclusion list along with the locally observed timeliness.
   *
   * Late inclusion lists are stored with `isTimely=false` rather than dropped: they still count
   * toward the non-timely view used when validating another node's `inclusion_list_bits`.
   */
  process(signedInclusionList: heze.SignedInclusionList, isTimely: boolean): InclusionListInsertOutcome {
    const inclusionList = signedInclusionList.message;
    const {slot, validatorIndex, inclusionListCommitteeRoot} = inclusionList;

    if (slot < this.lowestPermissibleSlot) {
      return InclusionListInsertOutcome.Old;
    }

    const counts = this.validatorIlCountBySlot.getOrDefault(slot);
    counts.set(validatorIndex, (counts.get(validatorIndex) ?? 0) + 1);

    const committeeRoot = toRootHex(inclusionListCommitteeRoot);

    const equivocators = this.equivocators.getOrDefault(committeeRoot);
    if (equivocators.has(validatorIndex)) {
      return InclusionListInsertOutcome.SubsequentEquivocation;
    }

    const stored = this.inclusionLists.getOrDefault(committeeRoot);
    const inclusionListRoot = toRootHex(ssz.heze.InclusionList.hashTreeRoot(inclusionList));

    for (const [storedRoot, storedInclusionList] of stored) {
      if (storedInclusionList.message.validatorIndex !== validatorIndex) {
        continue;
      }
      if (storedRoot === inclusionListRoot) {
        return InclusionListInsertOutcome.Seen;
      }
      equivocators.add(validatorIndex);
      return InclusionListInsertOutcome.Equivocating;
    }

    if (stored.size >= MAX_INCLUSION_LISTS_PER_COMMITTEE) {
      return InclusionListInsertOutcome.ReachLimit;
    }

    stored.set(inclusionListRoot, signedInclusionList);
    this.inclusionListTimeliness.set(inclusionListRoot, isTimely);
    this.committeeRootsBySlot.getOrDefault(slot).add(committeeRoot);

    return InclusionListInsertOutcome.New;
  }

  /**
   * Used by gossip validation to enforce "the message is either the first or second valid message
   * received from the validator with index validator_index" for the slot.
   */
  seenTwice(slot: Slot, validatorIndex: ValidatorIndex): boolean {
    return (this.validatorIlCountBySlot.get(slot)?.get(validatorIndex) ?? 0) >= 2;
  }

  /** Deduplicated transactions from valid, non-equivocating inclusion lists at `slot`. */
  getInclusionListTransactions(state: IBeaconStateViewHeze, slot: Slot, onlyTimely = true): bellatrix.Transactions {
    const transactions: bellatrix.Transactions = [];
    const seen = new Set<string>();

    for (const signedInclusionList of this.getEligible(state, slot, onlyTimely)) {
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
  getInclusionListBits(state: IBeaconStateViewHeze, slot: Slot, onlyTimely = true): BitArray {
    const submitted = new Set<ValidatorIndex>();
    for (const signedInclusionList of this.getEligible(state, slot, onlyTimely)) {
      submitted.add(signedInclusionList.message.validatorIndex);
    }

    const committee = state.getInclusionListCommittee(slot);
    const bits = BitArray.fromBitLen(INCLUSION_LIST_COMMITTEE_SIZE);
    for (let i = 0; i < committee.length; i++) {
      if (submitted.has(committee[i])) {
        bits.set(i, true);
      }
    }
    return bits;
  }

  /** True iff `bits` has a bit set for every bit set in the local inclusion list bits. */
  isInclusionListBitsInclusive(state: IBeaconStateViewHeze, slot: Slot, bits: BitArray, onlyTimely = true): boolean {
    const local = this.getInclusionListBits(state, slot, onlyTimely);
    for (let i = 0; i < INCLUSION_LIST_COMMITTEE_SIZE; i++) {
      if (local.get(i) && !bits.get(i)) {
        return false;
      }
    }
    return true;
  }

  /** Inclusion lists for the given committee indices, to serve InclusionListsByIndices. */
  getByIndices(
    state: IBeaconStateViewHeze,
    slot: Slot,
    committeeRoot: RootHex,
    indices: BitArray
  ): heze.SignedInclusionList[] {
    const stored = this.inclusionLists.get(committeeRoot);
    if (!stored || stored.size === 0) {
      return [];
    }

    const committee = state.getInclusionListCommittee(slot);
    const requested = new Set<ValidatorIndex>();
    for (const i of indices.getTrueBitIndexes()) {
      if (i < committee.length) {
        requested.add(committee[i]);
      }
    }

    const equivocators = this.equivocators.get(committeeRoot);
    const out: heze.SignedInclusionList[] = [];
    for (const signedInclusionList of stored.values()) {
      const {validatorIndex} = signedInclusionList.message;
      if (equivocators?.has(validatorIndex) || !requested.has(validatorIndex)) {
        continue;
      }
      out.push(signedInclusionList);
    }
    return out;
  }

  /**
   * Inclusion lists MUST be retained for at least MIN_SLOTS_FOR_INCLUSION_LISTS_REQUESTS slots
   * beyond their slot so InclusionListsByIndices can still serve them.
   */
  prune(clockSlot: Slot): void {
    const horizon = clockSlot - this.config.MIN_SLOTS_FOR_INCLUSION_LISTS_REQUESTS;

    for (const [slot, committeeRoots] of this.committeeRootsBySlot) {
      if (slot >= horizon) {
        continue;
      }
      for (const committeeRoot of committeeRoots) {
        const stored = this.inclusionLists.get(committeeRoot);
        if (stored) {
          for (const inclusionListRoot of stored.keys()) {
            this.inclusionListTimeliness.delete(inclusionListRoot);
          }
          this.inclusionLists.delete(committeeRoot);
        }
        this.equivocators.delete(committeeRoot);
      }
      this.committeeRootsBySlot.delete(slot);
      this.validatorIlCountBySlot.delete(slot);
    }

    this.lowestPermissibleSlot = Math.max(horizon, 0);
  }

  /**
   * Inclusion lists at `slot` that count toward the local view: stored under the committee root
   * implied by the local state, from a non-equivocating validator, and timely when required.
   */
  private *getEligible(
    state: IBeaconStateViewHeze,
    slot: Slot,
    onlyTimely: boolean
  ): Generator<heze.SignedInclusionList> {
    const committee = state.getInclusionListCommittee(slot);
    const committeeRoot = toRootHex(ssz.heze.InclusionListCommittee.hashTreeRoot(Array.from(committee)));

    const stored = this.inclusionLists.get(committeeRoot);
    if (!stored || stored.size === 0) {
      return;
    }
    const equivocators = this.equivocators.get(committeeRoot);

    for (const [inclusionListRoot, signedInclusionList] of stored) {
      if (equivocators?.has(signedInclusionList.message.validatorIndex)) {
        continue;
      }
      if (onlyTimely && !this.inclusionListTimeliness.get(inclusionListRoot)) {
        continue;
      }
      yield signedInclusionList;
    }
  }
}
