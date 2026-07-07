import {RootHex, Slot, gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";

/**
 * Pool of validated `SignedProposerPreferences` indexed by `(slot, dependent_root)`.
 *
 * The primary consumer is `validateExecutionPayloadBid`, which looks up the matching
 * preferences via `get(bid.slot, dependent_root)` to enforce the IGNORE-existence and
 * REJECT-equality rules from the gloas spec. The beacon API `/pool/proposer_preferences`
 * GET endpoint reads from the same pool via `getAll`.
 *
 * `validator_index` is intentionally not part of the key: gossip validation enforces
 * `proposers[proposalSlot % SLOTS_PER_EPOCH] === validatorIndex` against the shuffling
 * implied by `dependent_root`, so once a preference has been validated `(slot, dependent_root)`
 * already pins down the validator.
 */
export class ProposerPreferencesPool {
  private readonly bySlot = new Map<Slot, Map<RootHex, gloas.SignedProposerPreferences>>();

  /** Lookup for bid validation: matches `(bid.slot, get_shuffling_dependent_root(store, bid.parent_block_root, epoch))`. */
  get(slot: Slot, dependentRootHex: RootHex): gloas.SignedProposerPreferences | null {
    return this.bySlot.get(slot)?.get(dependentRootHex) ?? null;
  }

  add(signed: gloas.SignedProposerPreferences): void {
    const {proposalSlot, dependentRoot} = signed.message;
    const rootHex = toRootHex(dependentRoot);
    let byRoot = this.bySlot.get(proposalSlot);
    if (!byRoot) {
      byRoot = new Map();
      this.bySlot.set(proposalSlot, byRoot);
    }
    byRoot.set(rootHex, signed);
  }

  /** API read-out: flatten across branches, optionally filtered by slot. */
  getAll(slot?: Slot): gloas.SignedProposerPreferences[] {
    if (slot !== undefined) {
      const byRoot = this.bySlot.get(slot);
      return byRoot ? Array.from(byRoot.values()) : [];
    }
    const out: gloas.SignedProposerPreferences[] = [];
    for (const byRoot of this.bySlot.values()) {
      for (const v of byRoot.values()) out.push(v);
    }
    return out;
  }

  /**
   * Entries are only load-bearing while `proposal_slot >= current_slot`. Once the slot has
   * passed the `[IGNORE] proposal_slot > current_slot` gossip rule takes over, so drop them
   * on each slot tick.
   */
  prune(currentSlot: Slot): void {
    for (const slot of this.bySlot.keys()) {
      if (slot < currentSlot) this.bySlot.delete(slot);
    }
  }
}
