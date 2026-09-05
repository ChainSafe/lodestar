import {CheckpointWithHex, ForkChoiceError, ForkChoiceErrorCode, IForkChoice} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";

export function isFinalizedCheckpointAncestor(
  forkChoice: Pick<IForkChoice, "getAncestor">,
  blockRoot: RootHex,
  finalizedCheckpoint: CheckpointWithHex
): boolean {
  try {
    return (
      forkChoice.getAncestor(blockRoot, computeStartSlotAtEpoch(finalizedCheckpoint.epoch)).blockRoot ===
      finalizedCheckpoint.rootHex
    );
  } catch (e) {
    // Pruning can leave a conflicting branch whose ancestors before finalization are gone.
    if (e instanceof ForkChoiceError && e.type.code === ForkChoiceErrorCode.UNKNOWN_ANCESTOR) return false;
    throw e;
  }
}
