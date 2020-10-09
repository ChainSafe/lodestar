import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {Checkpoint} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {BeaconChain} from "..";

export async function handleForkChoiceJustified(this: BeaconChain, cp: Checkpoint): Promise<void> {
  this.logger.verbose("Fork choice justified", this.config.types.Checkpoint.toJson(cp));
}

export async function handleForkChoiceFinalized(this: BeaconChain, cp: Checkpoint): Promise<void> {
  this.logger.verbose("Fork choice finalized", this.config.types.Checkpoint.toJson(cp));
}

export async function handleForkChoiceHead(this: BeaconChain, head: IBlockSummary): Promise<void> {
  this.logger.verbose("New chain head", {
    headSlot: head.slot,
    headRoot: toHexString(head.blockRoot),
  });
}

export async function handleForkChoiceReorg(
  this: BeaconChain,
  head: IBlockSummary,
  oldHead: IBlockSummary,
  depth: number
): Promise<void> {
  this.logger.verbose("Chain reorg", {
    depth,
  });
}
