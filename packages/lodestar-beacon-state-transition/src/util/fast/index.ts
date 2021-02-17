import {BeaconState} from "@chainsafe/lodestar-types";
import {CachedValidatorsBeaconState} from "./cachedValidatorBeaconState";
import {EpochContext} from "..";

export * from "./cachedValidatorBeaconState";
export * from "./epochContext";
export * from "./flatValidator";

/**
 * Exchange Interface of StateContext
 */
export interface IStateContext<TState extends BeaconState = BeaconState> {
  state: CachedValidatorsBeaconState & TState;
  epochCtx: EpochContext;
}
