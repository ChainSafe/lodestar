import {ForkChoice} from "@lodestar/fork-choice";
import {Slot, allForks} from "@lodestar/types";

/**
 * A specific forkchoice implementation to mark some blocks as timely or not.
 */
export class TimelinessForkChoice extends ForkChoice {
  /**
   * These need to be in the constructor, however we want to keep the constructor signature the same.
   * So they are set after construction in the test instead.
   */
  lateSlot: Slot | undefined;

  /**
   * This is to mark the `lateSlot` as not timely.
   */
  protected isBlockTimely(block: allForks.BeaconBlock, blockDelaySec: number): boolean {
    if (block.slot === this.lateSlot) {
      return false;
    }

    return super.isBlockTimely(block, blockDelaySec);
  }
}
