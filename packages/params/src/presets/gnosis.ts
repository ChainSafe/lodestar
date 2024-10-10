import {BeaconPreset} from "../types.js";
import {mainnetPreset} from "./mainnet.js";

// Gnosis preset
// https://github.com/gnosischain/specs/tree/master/consensus/preset/gnosis

export const gnosisPreset: BeaconPreset = {
  ...mainnetPreset,

  /// NOTE: Only add diff values

  // phase0
  BASE_REWARD_FACTOR: 25,
  SLOTS_PER_EPOCH: 16,

  // altair
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: 512,

  // capella
  MAX_WITHDRAWALS_PER_PAYLOAD: 8,
  MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP: 8192,
};
