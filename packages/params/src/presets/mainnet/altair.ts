/* eslint-disable @typescript-eslint/naming-convention */
import {IAltairPreset} from "../../preset";

export const altair: IAltairPreset = {
  SYNC_COMMITTEE_SIZE: 512,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: 512,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR: BigInt(50331648),
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: BigInt(64),
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: BigInt(2),
};
