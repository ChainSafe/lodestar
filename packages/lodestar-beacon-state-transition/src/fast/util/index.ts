import {BeaconState} from "@chainsafe/lodestar-types";
import {EpochContext} from "../index";

export * from "./attesterStatus";
export * from "./epochContext";
export * from "./epochProcess";
export * from "./epochShuffling";
export * from "./epochStakeSummary";
export * from "./flatValidator";
export * from "./interface";

export interface IStateContext {
  state: BeaconState;
  epochCtx: EpochContext;
}
