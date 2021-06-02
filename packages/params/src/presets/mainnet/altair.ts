/* eslint-disable @typescript-eslint/naming-convention */
import {IAltairPreset} from "../../preset";

export const altair: IAltairPreset = {
  // 2**10 (=1,024)
  SYNC_COMMITTEE_SIZE: 1024,
  /*
  INACTIVITY_SCORE_BIAS: 4,
  */

  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: 512,

  /*
  ALTAIR_FORK_VERSION: "0x01000000",
  ALTAIR_FORK_EPOCH: "0xffffffffffffffff",
  */

  INACTIVITY_PENALTY_QUOTIENT_ALTAIR: BigInt(50331648),
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: BigInt(64),
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: BigInt(2),
};
