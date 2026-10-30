import {BeaconConfig} from "@lodestar/config";
import {Slot} from "@lodestar/types";
import {AnchorSummary} from "./beaconEngine/initialization.js";

/** Main-thread startup policy. Only bytes and engine results cross the engine boundary. */
export type StateInitialization = {
  stateBytes: Uint8Array;
  /** Count at the selected state's epoch. */
  activeValidatorCount: number;
  config: BeaconConfig;
  isFinalized: boolean;
  shouldPersist: boolean;
  validate(anchor: AnchorSummary): void;
  /** Source: unstable@2593063a82 CLI StateInitialization; consumes detached anchor metadata. */
  initializeEarliestAvailableSlot(anchor: AnchorSummary): Promise<Slot>;
  log(anchor: AnchorSummary, nativeStateTransition: boolean): void;
};
