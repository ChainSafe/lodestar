// fast
export * from "./block";
export * from "./epoch";
export * from "./upgradeState";
// naive
export * as naive from "../naive/altair";
export * from "./state_accessor";
export * from "./state_mutators";

// re-export phase0 lodestar types for ergonomic usage downstream
// eg:
//
// import {altair} from "@chainsafe/lodestar-beacon-state-transition";
//
// altair.processDeposit(...)
//
// const x: altair.BeaconState;
export * from "@chainsafe/lodestar-types/altair";
