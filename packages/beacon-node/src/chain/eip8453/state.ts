import {ForkSeq} from "@lodestar/params";
import {BeaconStateView, CachedBeaconStateEip8453, IBeaconStateView} from "@lodestar/state-transition";

/**
 * The EIP-8453 helpers of state-transition take the cached state. The beacon node holds states as views; the
 * TypeScript view wraps a cached state, the native (lodestar-z) view does not support EIP-8453.
 */
export function asCachedStateEip8453(state: IBeaconStateView): CachedBeaconStateEip8453 {
  if (!(state instanceof BeaconStateView)) {
    throw Error("EIP-8453 needs the TypeScript state view (native state transition is not supported)");
  }
  if (state.cachedState.config.getForkSeq(state.slot) < ForkSeq.eip8453) {
    throw Error(`State at slot ${state.slot} is before the EIP-8453 fork`);
  }
  return state.cachedState as CachedBeaconStateEip8453;
}
