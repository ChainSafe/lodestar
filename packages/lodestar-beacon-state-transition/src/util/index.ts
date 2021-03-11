/**
 * @module chain/stateTransition/util
 */

import {phase0, lightclient} from "@chainsafe/lodestar-types";

export * from "./epoch";
export * from "./fork";
export * from "./domain";
export * from "./blockRoot";
export * from "./block";
export * from "./validator";
export * from "./seed";
export * from "./signingRoot";
export * from "./committee";
export * from "./attestation";
export * from "./proposer";
export * from "./balance";
export * from "./validatorStatus";
export * from "./duties";
export * from "./slot";
export * from "./activation";
export * from "./shuffle";
export * from "./genesis";

export type BeaconState = phase0.BeaconState | lightclient.BeaconState;
