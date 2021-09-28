export {processBlock} from "./block";
export {upgradeState} from "./upgradeState";
export * from "./utils";

// re-export merge lodestar types for ergonomic usage downstream
// eg:
//
// import {merge} from "@chainsafe/lodestar-beacon-state-transition";
//
// merge.processExecutionPayload(...)
//
// const x: merge.BeaconState;
export * from "@chainsafe/lodestar-types/merge";
