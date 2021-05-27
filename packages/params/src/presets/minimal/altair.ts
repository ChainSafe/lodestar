/* eslint-disable @typescript-eslint/naming-convention */

import {IAltairPreset} from "../../preset";

export const altair: IAltairPreset = {
  SYNC_COMMITTEE_SIZE: 32,
  SYNC_PUBKEYS_PER_AGGREGATE: 16,
  /*
  INACTIVITY_SCORE_BIAS: 4,
  */

  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: 8,

  /*
  ALTAIR_FORK_VERSION: "0x01000001",
  ALTAIR_FORK_EPOCH: "0xffffffffffffffff",
  */

  INACTIVITY_PENALTY_QUOTIENT_ALTAIR: BigInt(50331648),
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: BigInt(64),
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: BigInt(2),
};
