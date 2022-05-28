import {AltairPreset} from "../../interface/altair.js";

/* eslint-disable @typescript-eslint/naming-convention */
export const altair: AltairPreset = {
  SYNC_COMMITTEE_SIZE: 32,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: 8,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR: 50331648,
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: 64,
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: 2,
  MIN_SYNC_COMMITTEE_PARTICIPANTS: 1,
  UPDATE_TIMEOUT: 64,
};
