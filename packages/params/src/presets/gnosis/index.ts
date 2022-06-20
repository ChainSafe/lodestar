import {BeaconPreset} from "../../interface/index.js";
import {preset as presetMainnet} from "../mainnet/index.js";

// Note: 1.0.0 has no meaning and is a placeholder
export const commit = "v1.0.0";

/* eslint-disable @typescript-eslint/naming-convention */
export const preset: BeaconPreset = {
  ...presetMainnet,

  /// NOTE: Only add diff values

  // phase0
  BASE_REWARD_FACTOR: 25,
  SLOTS_PER_EPOCH: 16,

  // altair
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: 512,
};
