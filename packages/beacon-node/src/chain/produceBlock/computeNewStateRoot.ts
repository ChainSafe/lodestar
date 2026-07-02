import {BeaconConfig} from "@lodestar/config";
import {
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  IBeaconStateView,
  StateHashTreeRootSource,
} from "@lodestar/state-transition";
import {
  BeaconBlock,
  BlindedBeaconBlock,
  Gwei,
  Root,
  SignedBeaconBlock,
  SignedBlindedBeaconBlock,
  isBlindedBeaconBlock,
} from "@lodestar/types";
import {Metrics} from "../../metrics/index.js";

/**
 * Instead of running fastStateTransition(), only need to process block since
 * state is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
export function computeNewStateRoot(
  config: BeaconConfig,
  metrics: Metrics | null,
  state: IBeaconStateView,
  block: BeaconBlock | BlindedBeaconBlock
): {newStateRoot: Root; proposerReward: Gwei; postState: IBeaconStateView} {
  // Set signature to zero to re-use stateTransition() while signature verification is disabled.
  const blockEmptySig = {message: block, signature: new Uint8Array(96)};
  const isBlinded = isBlindedBeaconBlock(block);
  const blockBytes = isBlinded
    ? config
        .getPostBellatrixForkTypes(block.slot)
        .SignedBlindedBeaconBlock.serialize(blockEmptySig as SignedBlindedBeaconBlock)
    : config.getForkTypes(block.slot).SignedBeaconBlock.serialize(blockEmptySig as SignedBeaconBlock);

  const postState = state.stateTransition(
    blockBytes,
    isBlinded,
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
