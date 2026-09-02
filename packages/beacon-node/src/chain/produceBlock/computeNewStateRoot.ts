import {EMPTY_SIGNATURE, IBeaconStateView} from "@lodestar/state-transition";
import {SignedBeaconBlock , SignedBlindedBeaconBlock, Gwei, Root} from "@lodestar/types";
import {Metrics} from "../../metrics/index.js";

/**
 * Instead of running fastStateTransition(), only need to process block since
 * state is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
export function computeNewStateRoot(
  metrics: Metrics | null,
  state: IBeaconStateView,
  block: SignedBeaconBlock | SignedBlindedBeaconBlock,
  blockBytes?: Uint8Array,
): {newStateRoot: Root; proposerReward: Gwei; postState: IBeaconStateView} {
  // Set signature to zero to re-use stateTransition() function which requires the SignedBeaconBlock type
  const signedBlock = {message: block, signature: EMPTY_SIGNATURE};
  return state.computeNewStateRoot({block: signedBlock, ssz: blockBytes}, {metrics});
}
