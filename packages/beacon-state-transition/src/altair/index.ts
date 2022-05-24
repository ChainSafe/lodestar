export * from "./block/index.js";
export * from "./epoch/index.js";
export * from "./upgradeState.js";

// re-export altair lodestar types for ergonomic usage downstream
// eg:
//
// import {altair} from "@chainsafe/lodestar-beacon-state-transition";
//
// altair.processSyncAggregate(...)
//
// const x: altair.BeaconState;
export * from "@chainsafe/lodestar-types/altair";
