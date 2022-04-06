export * from "./block/index.js";
export * from "./epoch/index.js";
export * from "./upgradeState.js";
export * from "./utils.js";

// re-export bellatrix lodestar types for ergonomic usage downstream
// eg:
//
// import {bellatrix} from "@chainsafe/lodestar-beacon-state-transition";
//
// bellatrix.processExecutionPayload(...)
//
// const x: bellatrix.BeaconState;
export * from "@chainsafe/lodestar-types/bellatrix";
