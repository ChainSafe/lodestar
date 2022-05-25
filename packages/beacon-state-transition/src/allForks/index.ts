export * from "./signatureSets/index.js";
export * from "./stateTransition.js";
export * from "./block/index.js";
export * from "./epoch/index.js";

// re-export allForks lodestar types for ergonomic usage downstream
// eg:
//
// import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
//
// allForks.processDeposit(...)
//
// const x: allForks.BeaconState;
export * from "@chainsafe/lodestar-types/allForks";
