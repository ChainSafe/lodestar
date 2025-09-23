import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {CachedBeaconStateEip7805, computeEpochAtSlot} from "@lodestar/state-transition";
import {Slot, ValidatorIndex, bellatrix, eip7805} from "@lodestar/types";
import {Transactions} from "@lodestar/types/bellatrix";
import {MapDef, toRootHex} from "@lodestar/utils";
import {byteArrayArrayEquals, byteArrayEquals} from "../../util/bytes.js";
import {IClock} from "../../util/clock.js";
import {IBeaconChain} from "../index.js";
import {pruneBySlot} from "./utils.js";

/**
 *
 */
const SLOTS_RETAINED = 2; // TODO EIP-7805: do we even need to retain previous slot?

/** Hex string of Inclusion List Committee root */
type CommitteeRootHex = string;

export enum InclusionListInsertOutcome {
  /**  */
  New = "New",
  /** Not existing in the pool but it's too old to add. No changes were made. */
  Old = "Old",
  /** The pool has reached its limit. No changes were made. */
  ReachLimit = "ReachLimit",
  /**  */
  Late = "Late",
  /** The same inclusion list has already been seen */
  Seen = "Seen",
  /** Equivocation detected */
  Equivocating = "Equivocating",
  /** Equivocation already detected in previous insertion */
  SubsequentEquivocation = "SubsequentEquivocation",
}

/**
 * This is an implementation of `InclusionListStore` as defined in EIP-7805.
 * Although it is called a store, it behaves more in line with other pools and not
 * forkchoice store.
 */
export class InclusionListStore {
  // Equivalent to InclusionListStore.inclusion_lists
  private readonly transactionsByValidatorIndexByCommitteeBySlot = new MapDef<
    Slot,
    MapDef<CommitteeRootHex, Map<ValidatorIndex, Transactions>>
  >(
    () => new MapDef<CommitteeRootHex, Map<ValidatorIndex, Transactions>>(() => new Map<ValidatorIndex, Transactions>())
  );
  private readonly equivocators = new MapDef<Slot, MapDef<CommitteeRootHex, Set<ValidatorIndex>>>(
    () => new MapDef<CommitteeRootHex, Set<ValidatorIndex>>(() => new Set<ValidatorIndex>())
  );

  private lowestPermissibleSlot = 0;

  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: ChainForkConfig,
    private readonly clock: IClock
  ) {}

  get size(): number {
    // TODO EIP-7805: See what makes sense for metrics
    const count = 0;
    return count;
  }

  // Process inclusion list and add it to the store if valid
  processInclusionList(inclusionList: eip7805.InclusionList): InclusionListInsertOutcome {
    const {slot, validatorIndex, inclusionListCommitteeRoot, transactions} = inclusionList;
    const inclusionListCommitteeRootHex = toRootHex(inclusionListCommitteeRoot);

    // Reject any inclusion lists that are too old.
    if (slot < this.lowestPermissibleSlot) {
      return InclusionListInsertOutcome.Old;
    }

    // Reject inclusion lists in the current slot but come to this pool very late
    if (this.clock.secFromSlot(slot) > this.config.PROPOSER_INCLUSION_LIST_CUT_OFF) {
      return InclusionListInsertOutcome.Late;
    }

    // Ignore `inclusion_list` from equivocators.
    // Avoid calling getOrDefault(). We don't want to create new map if not exist
    const storedEquivocators = this.equivocators.get(slot)?.get(inclusionListCommitteeRootHex);
    if (storedEquivocators?.has(validatorIndex)) {
      return InclusionListInsertOutcome.SubsequentEquivocation;
    }

    const transactionsByValidatorIndexByCommittee =
      this.transactionsByValidatorIndexByCommitteeBySlot.getOrDefault(slot);
    const transationsByValidatorIndex =
      transactionsByValidatorIndexByCommittee.getOrDefault(inclusionListCommitteeRootHex);

    const storedTransactions = transationsByValidatorIndex.get(validatorIndex);

    if (storedTransactions === undefined) {
      transationsByValidatorIndex.set(validatorIndex, transactions);
      return InclusionListInsertOutcome.New;
    }

    // Check equivocations
    if (!byteArrayArrayEquals(storedTransactions, transactions)) {
      this.equivocators.getOrDefault(slot).getOrDefault(inclusionListCommitteeRootHex).add(validatorIndex);
      transationsByValidatorIndex.delete(validatorIndex);
      return InclusionListInsertOutcome.Equivocating;
    }
    return InclusionListInsertOutcome.Seen;
  }

  /**
   * Return a list of unique inclusion list transactions for the given slot
   */
  getInclusionListTransactions(slot: Slot, state: CachedBeaconStateEip7805): bellatrix.Transactions {
    const uniqueTransactions: bellatrix.Transactions = [];
    const epoch = computeEpochAtSlot(slot);
    const decisionRoot = state.epochCtx.getShufflingDecisionRoot(epoch);
    const shuffling = this.chain.shufflingCache.getSync(epoch, decisionRoot);

    if (shuffling === null) {
      return uniqueTransactions;
    }

    const inclusionListCommitteeRoot = shuffling.inclusionListCommitteeRoots[slot % SLOTS_PER_EPOCH];
    const inclusionListCommitteeRootHex = toRootHex(inclusionListCommitteeRoot);

    const transactionsByValidatorIndex = this.transactionsByValidatorIndexByCommitteeBySlot
      .get(slot)
      ?.get(inclusionListCommitteeRootHex);

    if (!transactionsByValidatorIndex) {
      return uniqueTransactions;
    }

    const transactions = Array.from(transactionsByValidatorIndex.values()).flat();
    for (const transaction of transactions) {
      const duplicate = uniqueTransactions.some((existing) => byteArrayEquals(transaction, existing));

      if (!duplicate) {
        uniqueTransactions.push(transaction);
      }
    }

    return uniqueTransactions;
  }

  /**
   *
   */
  prune(clockSlot: Slot): void {
    pruneBySlot(this.transactionsByValidatorIndexByCommitteeBySlot, clockSlot, SLOTS_RETAINED);
    this.lowestPermissibleSlot = Math.max(clockSlot - SLOTS_RETAINED, 0);
  }
}
