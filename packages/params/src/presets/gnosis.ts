import {BeaconPreset} from "../interface.js";
import {mainnetPreset} from "./mainnet.js";

/* eslint-disable @typescript-eslint/naming-convention */
export const gnosisPreset: BeaconPreset = {
  ...mainnetPreset,

  /// NOTE: Only add diff values

  // phase0
  BASE_REWARD_FACTOR: 25,
  SLOTS_PER_EPOCH: 16,

  // altair
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: 512,
};
