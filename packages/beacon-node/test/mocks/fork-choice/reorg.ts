import {ChainForkConfig} from "@lodestar/config";
import {ForkChoice, ForkChoiceOpts, IForkChoiceStore, ProtoArray, ProtoBlock} from "@lodestar/fork-choice";
import {NotReorgedReason} from "@lodestar/fork-choice/lib/forkChoice/interface.js";
import {Slot} from "@lodestar/types";

/**
 * Specific implementation of ForkChoice that reorg at a given slot and distance.
 *                                    (n+1)
 *                     -----------------|
 *                    /
 *         |---------|---------|
 *                   ^         ^
 *                 (n+1-x)   reorgedSlot n
 *                   ^
 *               commonAncestor
 *                   |<--reorgDistance-->|
 **/
export class ReorgedForkChoice extends ForkChoice {
  /**
   * These need to be in the constructor, however we want to keep the constructor signature the same.
   * So they are set after construction in the test instead.
   */
  reorgedSlot: Slot | undefined;
  reorgDistance: number | undefined;
  private readonly _fcStore: IForkChoiceStore;

  constructor(
    config: ChainForkConfig,
    fcStore: IForkChoiceStore,
    /** The underlying representation of the block DAG. */
    protoArray: ProtoArray,
    opts?: ForkChoiceOpts
  ) {
    super(config, fcStore, protoArray, opts);
    this._fcStore = fcStore;
  }

  /**
   * Override to trigger reorged event at `reorgedSlot + 1`
   */
  getProposerHead(
    headBlock: ProtoBlock,
    secFromSlot: number,
    slot: Slot
  ): {proposerHead: ProtoBlock; isHeadTimely: boolean; notReorgedReason?: NotReorgedReason} {
    const currentSlot = this._fcStore.currentSlot;
    if (this.reorgedSlot !== undefined && this.reorgDistance !== undefined && currentSlot === this.reorgedSlot + 1) {
      const nodes = super.getAllNodes();
      const headSlot = currentSlot - this.reorgDistance;
      const headNode = nodes.find((node) => node.slot === headSlot);
      if (headNode !== undefined) {
        return {proposerHead: headNode, isHeadTimely: true};
      }
    }

    return super.getProposerHead(headBlock, secFromSlot, slot);
  }

  /**
   * Override the getHead() method
   * - produceAttestation: to build on the latest node after the reorged slot
   * - importBlock: to return the old branch at the reorged slot to produce the reorg event
   */
  getHead = (): ProtoBlock => {
    const currentSlot = this._fcStore.currentSlot;
    if (this.reorgedSlot === undefined || this.reorgDistance === undefined) {
      return super.getHead();
    }

    // this is mainly for producing attestations + produceBlock for latter slots
    // at `reorgedSlot + 1` should return the old head to trigger reorg event
    if (currentSlot > this.reorgedSlot + 1) {
      // from now on build on latest node which reorged at the given slot
      const nodes = super.getAllNodes();
      return nodes[nodes.length - 1];
    }

    // importBlock flow at "this.reorgedSlot + 1" returns the old branch for oldHead computation which trigger reorg event
    return super.getHead();
  };

  /**
   * Override this function to:
   * - produceBlock flow: mark flags to indicate that the current call of getHead() is to produce a block
   * - importBlock: return the new branch after the reorged slot, this is for newHead computation
   */
  updateHead = (): ProtoBlock => {
    if (this.reorgedSlot === undefined || this.reorgDistance === undefined) {
      return super.updateHead();
    }
    const currentSlot = this._fcStore.currentSlot;
    if (currentSlot <= this.reorgedSlot) {
      return super.updateHead();
    }

    // since reorgSlot, always return the latest node
    const nodes = super.getAllNodes();
    const head = nodes[nodes.length - 1];
    super.updateHead();
    return head;
  };
}
