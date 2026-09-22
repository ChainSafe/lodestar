import bindings from "@chainsafe/lodestar-z";
import {ChainForkConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {
  BeaconStateAllForks,
  BeaconStateView,
  IBeaconStateView,
  createBeaconStateView,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";

/**
 * Creates the state-view implementation used by state-transition spec tests.
 *
 * When `LODESTAR_NATIVE_STF=true`, this wraps the fixture state bytes in a
 * `NativeBeaconStateView` and uses the native view for `stateTransition` and
 * `processSlots` instance methods.
 *
 * Otherwise it returns the normal Lodestar `BeaconStateView` backed by a test cached state.
 */
export function createBeaconStateViewForTest(
  fork: ForkName,
  state: BeaconStateAllForks,
  chainConfig: ChainForkConfig = getConfig(fork)
): IBeaconStateView {
  const cachedState = createCachedBeaconStateTest(state, chainConfig);
  if (useNativeStateTransition) {
    bindings.config.set(cachedState.config, cachedState.genesisValidatorsRoot);
    return createBeaconStateView({useNative: true, config: cachedState.config, stateBytes: cachedState.serialize()});
  }

  return new BeaconStateView(cachedState);
}

/**
 * Converts a spec-test state view back into the SSZ tree-view shape expected by
 * `expectEqualBeaconState()`.
 *
 * The native and non-native runners both operate through `IBeaconStateView`,
 * but the spec-test comparison utilities still compare `BeaconStateAllForks`
 * values.
 **/
export function stateViewToBeaconState(fork: ForkName, state: IBeaconStateView): BeaconStateAllForks {
  try {
    return ssz[fork].BeaconState.deserializeToViewDU(state.serialize()) as BeaconStateAllForks;
  } finally {
    state.release();
  }
}

/**
 * Creates a replacement state view and releases the input view.
 *
 * State transition methods return a new view without releasing the input view.
 * The caller owns the returned view and must release that view separately.
 * Do not use `state` after this function returns or throws.
 */
export function replaceStateViewForTest(
  state: IBeaconStateView,
  createNextState: (state: IBeaconStateView) => IBeaconStateView
): IBeaconStateView {
  try {
    return createNextState(state);
  } finally {
    state.release();
  }
}

/**
 * Spec-test-only native transition toggle.
 *
 * Production native selection is made by constructing the initial `IBeaconStateView`
 * at boot. Spec tests still start from SSZ fixtures so we need an environment variable to opt
 * into the native runner.
 */
export const useNativeStateTransition = process.env.LODESTAR_NATIVE_STF === "true";
