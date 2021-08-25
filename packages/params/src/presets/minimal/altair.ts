/* eslint-disable @typescript-eslint/naming-convention */

import {IAltairPreset} from "../../preset";

export const altair: IAltairPreset = {
  SYNC_COMMITTEE_SIZE: 32,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: 8,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR: 50331648,
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: 64,
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: 2,
};
