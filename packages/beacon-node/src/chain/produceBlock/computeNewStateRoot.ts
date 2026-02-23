import {
  CachedBeaconStateAllForks,
  CachedBeaconStateGloas,
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  G2_POINT_AT_INFINITY,
  StateHashTreeRootSource,
  stateTransition,
} from "@lodestar/state-transition";
import {processExecutionPayloadEnvelope} from "@lodestar/state-transition/block";
import {BeaconBlock, BlindedBeaconBlock, Gwei, Root, gloas} from "@lodestar/types";
import {ZERO_HASH} from "../../constants/index.js";
import {Metrics} from "../../metrics/index.js";

/**
 * Instead of running fastStateTransition(), only need to process block since
 * state is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
export function computeNewStateRoot(
  metrics: Metrics | null,
  state: CachedBeaconStateAllForks,
  block: BeaconBlock | BlindedBeaconBlock
): {newStateRoot: Root; proposerReward: Gwei; postState: CachedBeaconStateAllForks} {
  // Set signature to zero to re-use stateTransition() function which requires the SignedBeaconBlock type
  const blockEmptySig = {message: block, signature: ZERO_HASH};

  const postState = stateTransition(
    state,
    blockEmptySig,
    {
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
    },
    {metrics}
  );

  const {attestations, syncAggregate, slashing} = postState.proposerRewards;
  const proposerReward = BigInt(attestations + syncAggregate + slashing);

  const hashTreeRootTimer = metrics?.stateHashTreeRootTime.startTimer({
    source: StateHashTreeRootSource.computeNewStateRoot,
  });
  const newStateRoot = postState.hashTreeRoot();
  hashTreeRootTimer?.();

  return {newStateRoot, proposerReward, postState};
}

/**
 * Compute the state root after processing an execution payload envelope.
 * Similar to `computeNewStateRoot` but for payload envelope processing.
 *
 * The `postBlockState` is mutated in place, callers must ensure it is not needed afterward.
 */
export function computeEnvelopeStateRoot(
  metrics: Metrics | null,
  postBlockState: CachedBeaconStateGloas,
  envelope: gloas.ExecutionPayloadEnvelope
): Root {
  const signedEnvelope: gloas.SignedExecutionPayloadEnvelope = {
    message: envelope,
    signature: G2_POINT_AT_INFINITY,
  };

  const processEnvelopeTimer = metrics?.blockPayload.executionPayloadEnvelopeProcessingTime.startTimer();
  processExecutionPayloadEnvelope(postBlockState, signedEnvelope, false);
  processEnvelopeTimer?.();

  const hashTreeRootTimer = metrics?.stateHashTreeRootTime.startTimer({
    source: StateHashTreeRootSource.computeEnvelopeStateRoot,
  });
  const stateRoot = postBlockState.hashTreeRoot();
  hashTreeRootTimer?.();

  return stateRoot;
}
