export * from "./block";
export * from "./epoch";
export * from "./upgradeState";

// re-export altair lodestar types for ergonomic usage downstream
// eg:
//
// import {altair} from "@chainsafe/lodestar-beacon-state-transition";
//
// altair.processSyncAggregate(...)
//
// const x: altair.BeaconState;
export * from "@chainsafe/lodestar-types/altair";
