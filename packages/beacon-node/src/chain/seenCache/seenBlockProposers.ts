import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * Keeps a cache to filter block proposals from the same validator in the same slot.
 *
 * Block roots with a verified proposer signature are tracked separately from proposals that passed gossip validation.
 * This allows proposer equivocations to be detected without letting invalid blocks suppress valid gossip.
 *
 * This cache is not bounded and for extremely long periods of non-finality it can grow a lot. However it's practically
 * limited by the possible shufflings in those epochs, and the stored data is very cheap
 */
export class SeenBlockProposers {
  private readonly proposerIndexesBySlot = new MapDef<Slot, Set<ValidatorIndex>>(() => new Set<ValidatorIndex>());
  private readonly blockRootsBySlot = new MapDef<Slot, MapDef<ValidatorIndex, Set<RootHex>>>(
    () => new MapDef<ValidatorIndex, Set<RootHex>>(() => new Set<RootHex>())
  );
  private finalizedSlot: Slot = 0;

  isKnown(blockSlot: Slot, proposerIndex: ValidatorIndex): boolean {
    return this.proposerIndexesBySlot.get(blockSlot)?.has(proposerIndex) === true;
  }

  hasBlockRoot(blockSlot: Slot, proposerIndex: ValidatorIndex, blockRoot: RootHex): boolean {
    return this.blockRootsBySlot.get(blockSlot)?.get(proposerIndex)?.has(blockRoot) === true;
  }

  getConflictingBlockRoots(blockSlot: Slot, proposerIndex: ValidatorIndex, blockRoot: RootHex): RootHex[] {
    const roots = this.blockRootsBySlot.get(blockSlot)?.get(proposerIndex);
    return roots === undefined ? [] : Array.from(roots).filter((root) => root !== blockRoot);
  }

  /** Record a block only after its proposer signature has been verified. */
  observeBlockRoot(blockSlot: Slot, proposerIndex: ValidatorIndex, blockRoot: RootHex): void {
    if (blockSlot < this.finalizedSlot) {
      throw Error(`blockSlot ${blockSlot} < finalizedSlot ${this.finalizedSlot}`);
    }

    this.blockRootsBySlot.getOrDefault(blockSlot).getOrDefault(proposerIndex).add(blockRoot);
  }

  /** Mark a block as known from gossip or another block import path. */
  add(blockSlot: Slot, proposerIndex: ValidatorIndex): void {
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
