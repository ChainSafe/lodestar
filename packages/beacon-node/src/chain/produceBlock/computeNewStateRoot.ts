import {
  CachedBeaconStateAllForks,
  DataAvailableStatus,
  ExecutionPayloadStatus,
  StateHashTreeRootSource,
  stateTransition,
} from "@lodestar/state-transition";
import {BeaconBlock, BlindedBeaconBlock, Gwei, Root} from "@lodestar/types";
import {ZERO_HASH} from "../../constants/index.js";
import {Metrics} from "../../metrics/index.js";
import {HashComputationGroup} from "@chainsafe/persistent-merkle-tree";

/**
 * Data in a BeaconBlock is bounded so we can use a single HashComputationGroup for all blocks
 */
const blockHCGroup = new HashComputationGroup();

/**
 * Instead of running fastStateTransition(), only need to process block since
 * state is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
export function computeNewStateRoot(
  metrics: Metrics | null,
  state: CachedBeaconStateAllForks,
  block: BeaconBlock | BlindedBeaconBlock
): {newStateRoot: Root; proposerReward: Gwei} {
  // Set signature to zero to re-use stateTransition() function which requires the SignedBeaconBlock type
  const blockEmptySig = {message: block, signature: ZERO_HASH};

  const postState = stateTransition(
    state,
    blockEmptySig,
    {
      // ExecutionPayloadStatus.valid: Assume payload valid, it has been produced by a trusted EL
      executionPayloadStatus: ExecutionPayloadStatus.valid,
      // DataAvailableStatus.available: Assume the blobs to be available, have just been produced by trusted EL
      dataAvailableStatus: DataAvailableStatus.available,
      // verifyStateRoot: false  | the root in the block is zero-ed, it's being computed here
      verifyStateRoot: false,
      // verifyProposer: false   | as the block signature is zero-ed
      verifyProposer: false,
      // verifySignatures: false | since the data to assemble the block is trusted
      verifySignatures: false,
      // Preserve cache in source state, since the resulting state is not added to the state cache
      dontTransferCache: true,
    },
    metrics
  );

  const {attestations, syncAggregate, slashing} = postState.proposerRewards;
  const proposerReward = BigInt(attestations + syncAggregate + slashing);

  const hashTreeRootTimer = metrics?.stateHashTreeRootTime.startTimer({
    source: StateHashTreeRootSource.computeNewStateRoot,
  });
  // state root is computed inside stateTransition(), so it should take no time here
  const newStateRoot = postState.batchHashTreeRoot(blockHCGroup);
  hashTreeRootTimer?.();

  return {newStateRoot, proposerReward};
}
