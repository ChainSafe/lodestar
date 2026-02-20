import {CheckpointWithHex} from "@lodestar/fork-choice";
import {IBeaconChain} from "../../interface.js";

/**
 * Archives execution payload envelopes from hot DB to archive DB after finalization.
 */
export async function archiveExecutionPayloadEnvelopes(
  chain: IBeaconChain,
  _finalized: CheckpointWithHex
): Promise<void> {
  const finalizedBlock = chain.forkChoice.getFinalizedBlock();
  if (!finalizedBlock) return;

  // TODO GLOAS: Implement payload envelope archival after epbs fork choice changes are merged
}
