/* eslint-disable @typescript-eslint/naming-convention */

export interface IAltairPreset {
  SYNC_COMMITTEE_SIZE: number;
  /*
  INACTIVITY_SCORE_BIAS: bigint;
  */
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: number;
  /*
  ALTAIR_FORK_VERSION: Buffer;
  ALTAIR_FORK_EPOCH: number;
  */
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR: bigint;
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: bigint;
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: bigint;
}
