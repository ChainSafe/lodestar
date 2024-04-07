import {ChainForkConfig} from "@lodestar/config";
import {ForkChoice, ForkChoiceOpts, IForkChoiceStore, ProtoArray, ProtoBlock} from "@lodestar/fork-choice";
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
  // these flags to mark if the current call of getHead() is to produce a block
  // the other way to check this is to check the n-th call of getHead() in the same slot, but this is easier
  private calledUpdateHead = false;
  private calledUpdateTime = false;

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
   * Override the getHead() method
   * - produceBlock: to reorg at a given slot and distance.
   * - produceAttestation: to build on the latest node after the reorged slot
   * - importBlock: to return the old branch at the reorged slot to produce the reorg event
   */
  getHead = (): ProtoBlock => {
    const currentSlot = this._fcStore.currentSlot;
    const producingBlock = this.calledUpdateHead && this.calledUpdateTime;
    if (this.reorgedSlot === undefined || this.reorgDistance === undefined) {
      return super.getHead();
    }

    this.calledUpdateTime = false;
    this.calledUpdateHead = false;

    // produceBlock: at reorgedSlot + 1, build new branch
    if (currentSlot === this.reorgedSlot + 1 && producingBlock) {
      const nodes = super.getAllNodes();
      const headSlot = currentSlot - this.reorgDistance;
      const headNode = nodes.find((node) => node.slot === headSlot);
      if (headNode !== undefined) {
        return headNode;
      }
    }

    // this is mainly for producing attestations + produceBlock for latter slots
    if (currentSlot > this.reorgedSlot + 1) {
      // from now on build on latest node which reorged at the given slot
      const nodes = super.getAllNodes();
      return nodes[nodes.length - 1];
    }

    // importBlock flow at "this.reorgedSlot + 1" returns the old branch for oldHead computation which trigger reorg event
    return super.getHead();
  };

  updateTime(currentSlot: Slot): void {
    // set flag to signal produceBlock flow
    this.calledUpdateTime = true;
    super.updateTime(currentSlot);
  }

  /**
   * Override this function to:
   * - produceBlock flow: mark flags to indicate that the current call of getHead() is to produce a block
   * - importBlock: return the new branch after the reorged slot, this is for newHead computation
   */
  updateHead = (): ProtoBlock => {
    if (this.reorgedSlot === undefined || this.reorgDistance === undefined) {
      return super.updateHead();
    }
    // in all produce blocks flow, it always call updateTime() first then recomputeForkChoiceHead()
    if (this.calledUpdateTime) {
      this.calledUpdateHead = true;
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
