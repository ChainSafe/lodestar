import {BitArray} from "@chainsafe/ssz";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import type {IBeaconStateViewHeze} from "@lodestar/state-transition";
import {RootHex, Slot, ValidatorIndex, bellatrix, heze, ssz} from "@lodestar/types";
import {MapDef, byteArrayEquals, toRootHex} from "@lodestar/utils";

const SLOTS_RETAINED = 2;

/** Maximum number of distinct `SignedInclusionList`s stored per (slot, committee_root). DoS guard. */
const MAX_INCLUSION_LISTS_PER_KEY = INCLUSION_LIST_COMMITTEE_SIZE * 2;

export enum InclusionListInsertOutcome {
  /** Stored as a new entry. */
  New = "New",
  /** Slot is older than the prune horizon. */
  Old = "Old",
  /** Pool is full for this (slot, committee_root). */
  ReachLimit = "ReachLimit",
  /** Identical inclusion list already stored. */
  Seen = "Seen",
  /** New equivocation evidence: validator already had a different IL stored under the same key. */
  Equivocating = "Equivocating",
  /** Validator was already marked as equivocator at this key. */
  SubsequentEquivocation = "SubsequentEquivocation",
}

/** Composite key: `${slot}-${committeeRootHex}`. */
type CommitteeKey = string;
type InclusionListRootHex = RootHex;

function makeKey(slot: Slot, committeeRoot: Uint8Array | RootHex): CommitteeKey {
  const rootHex = typeof committeeRoot === "string" ? committeeRoot : toRootHex(committeeRoot);
  return `${slot}-${rootHex}`;
}

/**
 * Implements `InclusionListStore` from heze/inclusion-list.md.
 *
 * Spec helpers exposed:
 * - `processInclusionList(il, isTimely)`
 * - `getInclusionListTransactions(state, slot, onlyTimely)`
 * - `getInclusionListBits(state, slot, onlyTimely)`
 * - `isInclusionListBitsInclusive(state, slot, bits, onlyTimely)`
 */
export class InclusionListStore {
  // (slot, committee_root) -> il_root -> InclusionList
  private readonly inclusionLists = new MapDef<CommitteeKey, Map<InclusionListRootHex, heze.InclusionList>>(
    () => new Map<InclusionListRootHex, heze.InclusionList>()
  );
  // il_root -> isTimely
  private readonly inclusionListTimeliness = new Map<InclusionListRootHex, boolean>();
  // (slot, committee_root) -> equivocator validator indices
  private readonly equivocators = new MapDef<CommitteeKey, Set<ValidatorIndex>>(() => new Set<ValidatorIndex>());
  // slot -> set of (slot, committee_root) keys for fast pruning
  private readonly keysBySlot = new MapDef<Slot, Set<CommitteeKey>>(() => new Set<CommitteeKey>());
  // slot -> validatorIndex -> count, for "seen at most twice" gossip rule
  private readonly validatorIlCountBySlot = new MapDef<Slot, Map<ValidatorIndex, number>>(
    () => new Map<ValidatorIndex, number>()
  );

  private lowestPermissibleSlot = 0;

  get size(): number {
    let count = 0;
    for (const ils of this.inclusionLists.values()) count += ils.size;
    return count;
  }

  /**
   * Add a `SignedInclusionList` along with the locally observed timeliness.
   * Spec: `process_inclusion_list` in heze/inclusion-list.md.
   */
  add(signedInclusionList: heze.SignedInclusionList, isTimely: boolean): InclusionListInsertOutcome {
    return this.processInclusionList(signedInclusionList.message, isTimely);
  }

  /**
   * Spec heze/inclusion-list.md `process_inclusion_list`.
   * Pruning + per-key DoS guard added on top of spec semantics. Late ILs (after the gossip
   * deadline) are stored with `is_timely=false` per spec; the gossip-layer slot filter ensures
   * we never see ILs outside the current slot window.
   */
  processInclusionList(inclusionList: heze.InclusionList, isTimely: boolean): InclusionListInsertOutcome {
    const {slot, validatorIndex, inclusionListCommitteeRoot} = inclusionList;

    if (slot < this.lowestPermissibleSlot) {
      return InclusionListInsertOutcome.Old;
    }

    // Spec p2p heze: "the message is either the first or second valid message received
    // from the validator". Bump count on every gossip-validated arrival past the time gates.
    const counts = this.validatorIlCountBySlot.getOrDefault(slot);
    counts.set(validatorIndex, (counts.get(validatorIndex) ?? 0) + 1);

    const key = makeKey(slot, inclusionListCommitteeRoot);

    // Spec: ignore if validator is already a known equivocator at this (slot, committee_root).
    const equivocators = this.equivocators.getOrDefault(key);
    if (equivocators.has(validatorIndex)) {
      return InclusionListInsertOutcome.SubsequentEquivocation;
    }

    const stored = this.inclusionLists.getOrDefault(key);
    const newRoot = toRootHex(ssz.heze.InclusionList.hashTreeRoot(inclusionList));

    // Spec: walk stored ILs for this key. If a different message is already stored
    // for this validatorIndex, mark equivocation (and do NOT store this one).
    for (const [existingRoot, existing] of stored) {
      if (existing.validatorIndex !== validatorIndex) continue;
      if (existingRoot === newRoot) {
        return InclusionListInsertOutcome.Seen;
      }
      equivocators.add(validatorIndex);
      return InclusionListInsertOutcome.Equivocating;
    }

    if (stored.size >= MAX_INCLUSION_LISTS_PER_KEY) {
      return InclusionListInsertOutcome.ReachLimit;
    }

    stored.set(newRoot, inclusionList);
    this.inclusionListTimeliness.set(newRoot, isTimely);
    this.keysBySlot.getOrDefault(slot).add(key);

    return InclusionListInsertOutcome.New;
  }

  /**
   * Used by gossip validation to enforce: "the message is either the first or second valid
   * message received from the validator with index validator_index" for the slot.
   */
  seenTwice(slot: Slot, validatorIndex: ValidatorIndex): boolean {
    return (this.validatorIlCountBySlot.get(slot)?.get(validatorIndex) ?? 0) >= 2;
  }

  /**
   * Spec heze/inclusion-list.md `get_inclusion_list_transactions`.
   * Returns deduplicated transactions from valid, non-equivocating ILs at the slot.
   */
  getInclusionListTransactions(state: IBeaconStateViewHeze, slot: Slot, onlyTimely = true): bellatrix.Transactions {
    const key = this.localCommitteeKey(state, slot);
    const stored = this.inclusionLists.get(key);
    if (!stored || stored.size === 0) return [];
    const equivocators = this.equivocators.get(key);

    const out: bellatrix.Transactions = [];
    for (const [ilRoot, il] of stored) {
      if (equivocators?.has(il.validatorIndex)) continue;
      if (onlyTimely && !this.inclusionListTimeliness.get(ilRoot)) continue;
      for (const tx of il.transactions) {
        if (!out.some((existing) => byteArrayEquals(existing, tx))) {
          out.push(tx);
        }
      }
    }
    return out;
  }

  /**
   * Spec heze/inclusion-list.md `get_inclusion_list_bits`.
   * Bit i is set iff the ith committee member submitted a valid, non-equivocating IL at `slot`.
   */
  getInclusionListBits(state: IBeaconStateViewHeze, slot: Slot, onlyTimely = true): BitArray {
    const committee = state.getInclusionListCommittee(slot);
    const key = makeKey(slot, ssz.heze.InclusionListCommittee.hashTreeRoot([...committee]));

    const submitted = new Set<ValidatorIndex>();
    const stored = this.inclusionLists.get(key);
    if (stored) {
      const equivocators = this.equivocators.get(key);
      for (const [ilRoot, il] of stored) {
        if (equivocators?.has(il.validatorIndex)) continue;
        if (onlyTimely && !this.inclusionListTimeliness.get(ilRoot)) continue;
        submitted.add(il.validatorIndex);
      }
    }

    const bits = BitArray.fromBitLen(INCLUSION_LIST_COMMITTEE_SIZE);
    for (let i = 0; i < committee.length; i++) {
      if (submitted.has(committee[i])) bits.set(i, true);
    }
    return bits;
  }

  /**
   * Spec heze/inclusion-list.md `is_inclusion_list_bits_inclusive`.
   * Returns true iff `bits` is a superset of the locally observed bits.
   */
  isInclusionListBitsInclusive(state: IBeaconStateViewHeze, slot: Slot, bits: BitArray, onlyTimely = true): boolean {
    const local = this.getInclusionListBits(state, slot, onlyTimely);
    for (let i = 0; i < INCLUSION_LIST_COMMITTEE_SIZE; i++) {
      if (local.get(i) && !bits.get(i)) return false;
    }
    return true;
  }

  /** Drop entries older than `clockSlot - SLOTS_RETAINED`. */
  prune(clockSlot: Slot): void {
    const horizon = clockSlot - SLOTS_RETAINED;
    for (const [slot, keys] of this.keysBySlot) {
      if (slot >= horizon) continue;
      for (const key of keys) {
        const ils = this.inclusionLists.get(key);
        if (ils) {
          for (const ilRoot of ils.keys()) {
            this.inclusionListTimeliness.delete(ilRoot);
          }
          this.inclusionLists.delete(key);
        }
        this.equivocators.delete(key);
      }
      this.keysBySlot.delete(slot);
      this.validatorIlCountBySlot.delete(slot);
    }
    this.lowestPermissibleSlot = Math.max(horizon, 0);
  }

  private localCommitteeKey(state: IBeaconStateViewHeze, slot: Slot): CommitteeKey {
    const committee = state.getInclusionListCommittee(slot);
    return makeKey(slot, ssz.heze.InclusionListCommittee.hashTreeRoot([...committee]));
  }
}
