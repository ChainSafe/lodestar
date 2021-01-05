import {EpochContext} from "./epochContext";
import {IEpochProcess} from "./epochProcess";
import {CachedValidatorsBeaconState} from "./interface";

export * from "./block";
export * from "./attesterStatus";
export {EpochContext} from "./epochContext";
export * from "./epochProcess";
export * from "./epochShuffling";
export * from "./epochStakeSummary";
export * from "./flatValidator";
export * from "./interface";

/**
 * Exchange Interface of StateContext
 */
export interface IStateContext {
  state: CachedValidatorsBeaconState;
  epochCtx: EpochContext;
  epochProcess?: IEpochProcess;
}
