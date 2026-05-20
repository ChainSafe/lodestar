import {ChainForkConfig} from "@lodestar/config";
import {
  ForkChoice,
  ForkChoiceOpts,
  IForkChoiceStore,
  NotReorgedReason,
  ProtoArray,
  ProtoBlock,
} from "@lodestar/fork-choice";
import {Slot} from "@lodestar/types";

/**
 * Specific implementation of ForkChoice that reorgs at a given slot and distance.
 *
 *                                    (n+1)
 *                     -----------------|
 *                    /
 *         |---------|---------|
 *                   ^         ^
 *                 (n+1-x)   reorgedSlot n
 *                   ^
 *               commonAncestor
 *                   |<--reorgDistance-->|
 *
 */
export class ReorgedForkChoice extends ForkChoice {
  /**
   * These need to be in the constructor, however we want to keep the constructor signature
   * the same. So they are set after construction in the test instead.
   */
  reorgedSlot: Slot | undefined;
  reorgDistance: number | undefined;

  /**
   * Stored separately because the base `ForkChoice` keeps `fcStore` private, but several
   * overrides need to read `currentSlot` to gate reorg behavior.
   */
  private readonly _fcStore: IForkChoiceStore;

  constructor(
    config: ChainForkConfig,
    fcStore: IForkChoiceStore,
    /** The underlying representation of the block DAG. */
    protoArray: ProtoArray,
    validatorCount: number,
    opts?: ForkChoiceOpts
  ) {
    super(config, fcStore, protoArray, validatorCount, null, opts);
    this._fcStore = fcStore;
  }

  /**
   * The base ForkChoice's `getProposerHead` returns the canonical head (= the orphan
   * block at slot `reorgedSlot`). With our override, the proposer at slot `reorgedSlot+1`
   * builds on slot `reorgedSlot+1-reorgDistance`, skipping the orphan and creating the
   * reorg the test wants to exercise.
   */
  getProposerHead(
    headBlock: ProtoBlock,
    secFromSlot: number,
    slot: Slot
  ): {proposerHead: ProtoBlock; isHeadTimely: boolean; notReorgedReason?: NotReorgedReason} {
    if (this.reorgedSlot !== undefined && this._fcStore.currentSlot === this.reorgedSlot + 1) {
      const commonAncestor = this.getCommonAncestorBlock();
      if (commonAncestor !== undefined) {
        return {proposerHead: commonAncestor, isHeadTimely: true};
      }
    }
    return super.getProposerHead(headBlock, secFromSlot, slot);
  }

  /**
   * Tell `PrepareNextSlotScheduler` to anticipate the upcoming reorg so the execution
   * layer pre-builds the right payload for slot `reorgedSlot+1`.
   */
  predictProposerHead(headBlock: ProtoBlock, secFromSlot: number, currentSlot: Slot): ProtoBlock {
    if (currentSlot === this.reorgedSlot) {
      const commonAncestor = this.getCommonAncestorBlock();
      if (commonAncestor !== undefined) {
        return commonAncestor;
      }
    }
    return super.predictProposerHead(headBlock, secFromSlot, currentSlot);
  }

  /**
   * Behaves identically to `super.updateHead()` except for one thing: post-reorg, we
   * force-overwrite the base class's private `this.head` field to point at the new chain
   * instead of the orphan.
   */
  updateHead = (): ProtoBlock => {
    super.updateHead();
    if (this.reorgedSlot !== undefined && this._fcStore.currentSlot > this.reorgedSlot) {
      const newChainTip = super.getAllNodes().at(-1);
      if (newChainTip !== undefined && newChainTip.slot > this.reorgedSlot) {
        // `this.head` is private in the base class; force-patch it onto the new chain.
        (this as unknown as {head: ProtoBlock}).head = newChainTip;
      }
    }
    return super.getHead();
  };

  /**
   * Returns the ProtoBlock at slot `reorgedSlot+1-reorgDistance` — the `commonAncestor`
   * labeled in the class diagram. Both the old chain (through the orphan at
   * `reorgedSlot`) and the new chain (which skips it) descend from this block.
   *
   * The proposer of slot `reorgedSlot+1` builds directly on top of it (see
   * `getProposerHead`), and `predictProposerHead` returns it so `PrepareNextSlotScheduler`
   * can have the EL pre-build the matching payload (parent = commonAncestor's payload).
   */
  private getCommonAncestorBlock(): ProtoBlock | undefined {
    if (this.reorgedSlot === undefined || this.reorgDistance === undefined) return undefined;
    const commonAncestorSlot = this.reorgedSlot + 1 - this.reorgDistance;
    return super.getAllNodes().find((n) => n.slot === commonAncestorSlot);
  }
}
