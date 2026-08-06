import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex, phase0} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/** Two distinct block roots signed by the same proposer for the same slot are sufficient to establish an equivocation */
const MAX_BLOCK_ROOTS_PER_PROPOSAL = 2;

/**
 * Keeps a cache to filter block proposals from the same validator in the same slot.
 *
 * Block roots with a signature verified against the block's proposer index are tracked separately from proposals
 * accepted by gossip validation or block import. A root from a block signed by its declared proposer is potential
 * equivocation evidence, but the block may still fail other validation. Such a block must not mark the proposal as
 * known, since that would cause a later valid block for the same slot and proposer to be ignored as a repeat proposal.
 *
 * The signed block header of each observed root is kept so a proposer slashing can be produced from the two
 * conflicting headers once an equivocation is established.
 *
 * The cache is pruned on finalization and bounds the number of roots stored per proposer and slot
 */
export class SeenBlockProposers {
  private readonly proposerIndexesBySlot = new MapDef<Slot, Set<ValidatorIndex>>(() => new Set<ValidatorIndex>());
  private readonly blockRootsBySlot = new MapDef<
    Slot,
    MapDef<ValidatorIndex, Map<RootHex, phase0.SignedBeaconBlockHeader>>
  >(() => new MapDef<ValidatorIndex, Map<RootHex, phase0.SignedBeaconBlockHeader>>(() => new Map()));
  private finalizedSlot: Slot = 0;

  isKnown(blockSlot: Slot, proposerIndex: ValidatorIndex): boolean {
    return this.proposerIndexesBySlot.get(blockSlot)?.has(proposerIndex) === true;
  }

  hasBlockRoot(blockSlot: Slot, proposerIndex: ValidatorIndex, blockRoot: RootHex): boolean {
    return this.blockRootsBySlot.get(blockSlot)?.get(proposerIndex)?.has(blockRoot) === true;
  }

  isEquivocating(blockSlot: Slot, proposerIndex: ValidatorIndex): boolean {
    return (this.blockRootsBySlot.get(blockSlot)?.get(proposerIndex)?.size ?? 0) >= MAX_BLOCK_ROOTS_PER_PROPOSAL;
  }

  getConflictingBlockRoots(blockSlot: Slot, proposerIndex: ValidatorIndex, blockRoot: RootHex): RootHex[] {
    const roots = this.blockRootsBySlot.get(blockSlot)?.get(proposerIndex);
    return roots === undefined ? [] : Array.from(roots.keys()).filter((root) => root !== blockRoot);
  }

  /** Return the two signed block headers that establish an equivocation, or null if there is none */
  getEquivocationHeaders(
    blockSlot: Slot,
    proposerIndex: ValidatorIndex
  ): [phase0.SignedBeaconBlockHeader, phase0.SignedBeaconBlockHeader] | null {
    const headers = this.blockRootsBySlot.get(blockSlot)?.get(proposerIndex);
    if (headers === undefined || headers.size < MAX_BLOCK_ROOTS_PER_PROPOSAL) {
      return null;
    }
    const [signedHeader1, signedHeader2] = headers.values();
    return [signedHeader1, signedHeader2];
  }

  /** Record a block only after its proposer signature has been verified */
  observeBlockRoot(
    blockSlot: Slot,
    proposerIndex: ValidatorIndex,
    blockRoot: RootHex,
    signedBlockHeader: phase0.SignedBeaconBlockHeader
  ): void {
    if (blockSlot < this.finalizedSlot) {
      throw Error(`blockSlot ${blockSlot} < finalizedSlot ${this.finalizedSlot}`);
    }

    const blockRoots = this.blockRootsBySlot.getOrDefault(blockSlot).getOrDefault(proposerIndex);
    if (blockRoots.size < MAX_BLOCK_ROOTS_PER_PROPOSAL && !blockRoots.has(blockRoot)) {
      blockRoots.set(blockRoot, signedBlockHeader);
    }
  }

  /** Mark a block as known from gossip or another block import path */
  add(blockSlot: Slot, proposerIndex: ValidatorIndex): void {
    if (blockSlot < this.finalizedSlot) {
      throw Error(`blockSlot ${blockSlot} < finalizedSlot ${this.finalizedSlot}`);
    }

    this.proposerIndexesBySlot.getOrDefault(blockSlot).add(proposerIndex);
  }

  prune(finalizedSlot: Slot): void {
    this.finalizedSlot = finalizedSlot;
    for (const slot of this.proposerIndexesBySlot.keys()) {
      if (slot < finalizedSlot) {
        this.proposerIndexesBySlot.delete(slot);
      }
    }
    for (const slot of this.blockRootsBySlot.keys()) {
      if (slot < finalizedSlot) {
        this.blockRootsBySlot.delete(slot);
      }
    }
  }

  seenAtEpoch(epoch: Epoch, index: ValidatorIndex): boolean {
    const fromSlot = computeStartSlotAtEpoch(epoch);
    const toSlot = computeStartSlotAtEpoch(epoch + 1);

    for (let slot = fromSlot; slot < toSlot; slot++) {
      if (this.proposerIndexesBySlot.get(slot)?.has(index) === true) {
        return true;
      }
    }

    return false;
  }
}
