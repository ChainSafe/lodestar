export * from "./naive";
export * from "./state_accessor";
export * from "./state_mutators";
export * as fast from "./fast";

// re-export phase0 lodestar types for ergonomic usage downstream
// eg:
//
// import {altair} from "@chainsafe/lodestar-beacon-state-transition";
//
// altair.processDeposit(...)
//
// const x: altair.BeaconState;
export * from "@chainsafe/lodestar-types/altair";
