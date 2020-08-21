import {Gwei, Epoch, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";

import {IProtoBlock, IVoteTracker, HEX_ZERO_HASH, HexRoot} from "./interface";
import {ProtoArray} from "./protoArray";
import {computeDeltas} from "./computeDeltas";

export const DEFAULT_PRUNE_THRESHOLD = 256;

export class ProtoArrayForkChoice {
  public protoArray: ProtoArray;
  public votes: IVoteTracker[];
  public balances: Gwei[];

  constructor({
    finalizedBlockSlot,
    finalizedBlockStateRoot,
    justifiedEpoch,
    finalizedEpoch,
    finalizedBlockRoot,
  }: {
    finalizedBlockSlot: Slot;
    finalizedBlockStateRoot: HexRoot;
    justifiedEpoch: Epoch;
    finalizedEpoch: Epoch;
    finalizedBlockRoot: HexRoot;
  }) {
    this.protoArray = new ProtoArray({
      pruneThreshold: DEFAULT_PRUNE_THRESHOLD,
      justifiedEpoch: justifiedEpoch,
      finalizedEpoch: finalizedEpoch,
    });

    const block: IProtoBlock = {
      slot: finalizedBlockSlot,
      blockRoot: finalizedBlockRoot,
      parentRoot: undefined,
      stateRoot: finalizedBlockStateRoot,
      // We are using the finalizedBlockRoot as the targetRoot, since it always lies on an epoch boundary
      targetRoot: finalizedBlockRoot,
      justifiedEpoch,
      finalizedEpoch,
    };

    this.protoArray.onBlock(block);
    this.votes = [];
    this.balances = [];
  }

  public processAttestation(validatorIndex: ValidatorIndex, blockRoot: HexRoot, targetEpoch: Epoch): void {
    const vote = this.votes[validatorIndex];
    if (!vote) {
      this.votes[validatorIndex] = {
        currentRoot: HEX_ZERO_HASH,
        nextRoot: blockRoot,
        nextEpoch: targetEpoch,
      };
    } else if (targetEpoch > vote.nextEpoch) {
      vote.nextRoot = blockRoot;
      vote.nextEpoch = targetEpoch;
    }
  }

  public processBlock(block: IProtoBlock): void {
    if (!block.parentRoot) {
      throw new Error("Missing parent root");
    }

    this.protoArray.onBlock(block);
  }

  public findHead(
    justifiedEpoch: Epoch,
    justifiedRoot: HexRoot,
    finalizedEpoch: Epoch,
    justifiedStateBalances: Gwei[]
  ): HexRoot {
    const oldBalances = this.balances;
    const newBalances = justifiedStateBalances;

    const deltas = computeDeltas(this.protoArray.indices, this.votes, oldBalances, newBalances);

    this.protoArray.applyScoreChanges(deltas, justifiedEpoch, finalizedEpoch);

    this.balances = newBalances;

    return this.protoArray.findHead(justifiedRoot);
  }

  public maybePrune(finalizedRoot: HexRoot): void {
    this.protoArray.maybePrune(finalizedRoot);
  }

  public setPruneThreshold(pruneThreshold: number): void {
    this.protoArray.pruneThreshold = pruneThreshold;
  }

  public length(): number {
    return this.protoArray.nodes.length;
  }

  public isEmpty(): boolean {
    return this.length() === 0;
  }

  public hasBlock(blockRoot: HexRoot): boolean {
    return this.protoArray.indices.has(blockRoot);
  }

  public getBlock(blockRoot: HexRoot): IProtoBlock | null {
    const blockIndex = this.protoArray.indices.get(blockRoot);
    if (blockIndex === undefined) {
      return null;
    }

    const block = this.protoArray.nodes[blockIndex];
    if (!block) {
      return null;
    }

    const parentNode = block.parent === undefined ? undefined : this.protoArray.nodes[block.parent];
    if (!parentNode) {
      return null;
    }
    return block;
  }

  /**
   * Returns `true` if the `descendant_root` has an ancestor with `ancestor_root`. Always
   * returns `false` if either input roots are unknown.
   *
   * ## Notes
   *
   * Still returns `true` if `ancestor_root` is known and `ancestor_root == descendant_root`.
   */
  public isDescendant(ancestorRoot: HexRoot, descendantRoot: HexRoot): boolean {
    const ancestor = this.protoArray.indices.get(ancestorRoot);
    if (ancestor === undefined) {
      return false;
    }
    const ancestorNode = this.protoArray.nodes[ancestor];
    if (!ancestorNode) {
      return false;
    }
    for (const [root, slot] of this.protoArray.iterateBlockRoots(descendantRoot)) {
      if (slot < ancestorNode.slot) {
        return false;
      }
      if (root === ancestorNode.blockRoot) {
        return true;
      }
    }
    return false;
  }

  public latestMessage(validatorIndex: ValidatorIndex): [HexRoot, Epoch] | null {
    const vote = this.votes[validatorIndex];
    if (!vote) {
      return null;
    }
    return [vote.nextRoot, vote.nextEpoch];
  }
}
