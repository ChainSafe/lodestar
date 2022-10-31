import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot, ValidatorIndex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * Keeps a cache to filter block proposals from the same validator in the same slot.
 *
 * This cache is not bounded and for extremely long periods of non-finality it can grow a lot. However it's practically
 * limited by the possible shufflings in those epochs, and the stored data is very cheap
 */
export class SeenBlockProposers {
  private readonly proposerIndexesBySlot = new MapDef<Slot, Set<ValidatorIndex>>(() => new Set<ValidatorIndex>());
  private finalizedSlot: Epoch = 0;

  isKnown(blockSlot: Slot, proposerIndex: ValidatorIndex): boolean {
    return this.proposerIndexesBySlot.get(blockSlot)?.has(proposerIndex) === true;
  }

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
  }

  seenAtEpoch(epoch: Slot, index: ValidatorIndex): boolean {
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
