export * from "./block";
export * from "./epoch";
export * from "./upgradeState";
export * from "./utils";

// re-export bellatrix lodestar types for ergonomic usage downstream
// eg:
//
// import {bellatrix} from "@chainsafe/lodestar-beacon-state-transition";
//
// bellatrix.processExecutionPayload(...)
//
// const x: bellatrix.BeaconState;
export * from "@chainsafe/lodestar-types/bellatrix";
