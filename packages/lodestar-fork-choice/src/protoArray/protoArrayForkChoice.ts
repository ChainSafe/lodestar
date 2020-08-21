import {toHexString, fromHexString} from "@chainsafe/ssz";
import {Gwei, Epoch, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";

import {IProtoBlock, IVoteTracker, HEX_ZERO_HASH} from "./interface";
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
    finalizedBlockStateRoot: Root;
    justifiedEpoch: Epoch;
    finalizedEpoch: Epoch;
    finalizedBlockRoot: Root;
  }) {
    this.protoArray = new ProtoArray({
      pruneThreshold: DEFAULT_PRUNE_THRESHOLD,
      justifiedEpoch: justifiedEpoch,
      finalizedEpoch: finalizedEpoch,
    });

    const block: IProtoBlock = {
      slot: finalizedBlockSlot,
      blockRoot: toHexString(finalizedBlockRoot),
      parentRoot: undefined,
      stateRoot: toHexString(finalizedBlockStateRoot),
      // We are using the finalizedBlockRoot as the targetRoot, since it always lies on an epoch boundary
      targetRoot: toHexString(finalizedBlockRoot),
      justifiedEpoch,
      finalizedEpoch,
    };

    this.protoArray.onBlock(block);
    this.votes = [];
    this.balances = [];
  }

  public processAttestation(validatorIndex: ValidatorIndex, blockRoot: Root, targetEpoch: Epoch): void {
    const vote = this.votes[validatorIndex];
    if (!vote) {
      this.votes[validatorIndex] = {
        currentRoot: HEX_ZERO_HASH,
        nextRoot: toHexString(blockRoot),
        nextEpoch: targetEpoch,
      };
    } else if (targetEpoch > vote.nextEpoch) {
      vote.nextRoot = toHexString(blockRoot);
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
    justifiedRoot: Root,
    finalizedEpoch: Epoch,
    justifiedStateBalances: Gwei[]
  ): Root {
    const oldBalances = this.balances;
    const newBalances = justifiedStateBalances;

    const deltas = computeDeltas(this.protoArray.indices, this.votes, oldBalances, newBalances);

    this.protoArray.applyScoreChanges(deltas, justifiedEpoch, finalizedEpoch);

    this.balances = newBalances;

    return fromHexString(this.protoArray.findHead(toHexString(justifiedRoot)));
  }

  public maybePrune(finalizedRoot: Root): void {
    this.protoArray.maybePrune(toHexString(finalizedRoot));
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

  public hasBlock(blockRoot: Root): boolean {
    return this.protoArray.indices.has(toHexString(blockRoot));
  }

  public getBlock(blockRoot: Root): IProtoBlock | null {
    const blockIndex = this.protoArray.indices.get(toHexString(blockRoot));
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
  public isDescendant(ancestorRoot: Root, descendantRoot: Root): boolean {
    const ancestor = this.protoArray.indices.get(toHexString(ancestorRoot));
    if (ancestor === undefined) {
      return false;
    }
    const ancestorNode = this.protoArray.nodes[ancestor];
    if (!ancestorNode) {
      return false;
    }
    for (const [root, slot] of this.protoArray.iterateBlockRoots(toHexString(descendantRoot))) {
      if (slot < ancestorNode.slot) {
        return false;
      }
      if (root === ancestorNode.blockRoot) {
        return true;
      }
    }
    return false;
  }

  public latestMessage(validatorIndex: ValidatorIndex): [Root, Epoch] | null {
    const vote = this.votes[validatorIndex];
    if (!vote) {
      return null;
    }
    return [fromHexString(vote.nextRoot), vote.nextEpoch];
  }
}
