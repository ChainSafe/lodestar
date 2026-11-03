export type {
  ProcessSlotsOpts,
  SignedVoluntaryExit,
  TransitionOpts,
  VoluntaryExit,
  VoluntaryExitValidity,
} from "./index.js";
export {BeaconConfig, BeaconStateView} from "./index.js";

/** Callers must exclude STF operations in this thread until teardown returns. */
export declare function deinitReusedEpochTransitionCache(): void;
