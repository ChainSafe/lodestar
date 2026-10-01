import {ChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {toHex} from "@lodestar/utils";
import {StateInitializationError, StateInitializationErrorCode} from "./errors.js";

export function assertAnchorStateForkMatchesConfig(config: ChainForkConfig, anchorState: BeaconStateAllForks): void {
  const expectedFork = config.getForkInfo(computeStartSlotAtEpoch(anchorState.fork.epoch));
  const expectedForkVersion = toHex(expectedFork.version);
  const stateFork = toHex(anchorState.fork.currentVersion);
  if (stateFork !== expectedForkVersion) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.ANCHOR_STATE_FORK_MISMATCH},
      `State current fork version ${stateFork} not equal to current config ${expectedForkVersion}. Maybe caused by importing a state from a different network`
    );
  }
}
