import {BeaconConfig} from "@lodestar/config";
import {AnchorSummary} from "./beaconEngine/initialization.js";

/** Main-thread startup policy. Only bytes and engine results cross the engine boundary. */
export type StateInitialization = {
  stateBytes: Uint8Array;
  config: BeaconConfig;
  isFinalized: boolean;
  shouldPersist: boolean;
  validate(anchor: AnchorSummary): void;
  log(anchor: AnchorSummary): void;
};
