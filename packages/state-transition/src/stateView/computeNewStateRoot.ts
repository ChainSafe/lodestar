import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../block/externalData.js";
import {StateTransitionOpts} from "../stateTransition.js";
import {ComputeNewStateRootResult, IBeaconStateView} from "./interface.js";

/** State transition options for computing the state root of a locally produced block. */
export const computeNewStateRootStateTransitionOpts: StateTransitionOpts = {
  // ExecutionPayloadStatus.valid: Assume payload valid, it has been produced by a trusted EL
  executionPayloadStatus: ExecutionPayloadStatus.valid,
  // DataAvailabilityStatus.available: Assume the blobs to be available, have just been produced by trusted EL
  dataAvailabilityStatus: DataAvailabilityStatus.Available,
  // verifyStateRoot: false  | the root in the block is zero-ed, it's being computed here
  verifyStateRoot: false,
  // verifyProposer: false   | as the block signature is zero-ed
  verifyProposer: false,
  // verifySignatures: false | since the data to assemble the block is trusted
  verifySignatures: false,
  // Preserve cache in source state, since the resulting state is not added to the state cache
  dontTransferCache: true,
};

export function getComputeNewStateRootResult(postState: IBeaconStateView): ComputeNewStateRootResult {
  const {attestations, syncAggregate, slashing} = postState.proposerRewards;
  const proposerReward = BigInt(attestations + syncAggregate + slashing);

  const start = Date.now();
  const newStateRoot = postState.hashTreeRoot();
  const hashTreeRootTime = (Date.now() - start) / 1000;

  return {newStateRoot, proposerReward, postState, hashTreeRootTime};
}
