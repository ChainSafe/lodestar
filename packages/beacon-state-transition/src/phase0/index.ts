export * from "./block/index.js";
export * from "./epoch/index.js";

// re-export phase0 lodestar types for ergonomic usage downstream
// eg:
//
// import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
//
// phase0.processDeposit(...)
//
// const x: phase0.BeaconState;
export * from "@chainsafe/lodestar-types/phase0";
