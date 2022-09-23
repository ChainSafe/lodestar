import {CachedBeaconStateAllForks, stateTransition} from "@lodestar/state-transition";
import {allForks, Root} from "@lodestar/types";
import {ZERO_HASH} from "../../constants/index.js";
import {IMetrics} from "../../metrics/index.js";
import {BlockType, AssembledBlockType} from "./produceBlockBody.js";

export {BlockType, AssembledBlockType};

/**
 * Instead of running fastStateTransition(), only need to process block since
 * state is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
export function computeNewStateRoot(
  metrics: IMetrics | null,
  state: CachedBeaconStateAllForks,
  block: allForks.FullOrBlindedBeaconBlock
): Root {
  // Set signature to zero to re-use stateTransition() function which requires the SignedBeaconBlock type
  const blockEmptySig = {message: block, signature: ZERO_HASH} as allForks.FullOrBlindedSignedBeaconBlock;

  const postState = stateTransition(
    state,
    blockEmptySig,
    // verifyStateRoot: false  | the root in the block is zero-ed, it's being computed here
    // verifyProposer: false   | as the block signature is zero-ed
    // verifySignatures: false | since the data to assemble the block is trusted
    {verifyStateRoot: false, verifyProposer: false, verifySignatures: false},
    metrics
  );

  return postState.hashTreeRoot();
}
