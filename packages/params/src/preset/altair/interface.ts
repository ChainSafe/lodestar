/* eslint-disable @typescript-eslint/naming-convention */

export interface IAltairPreset {
  SYNC_COMMITTEE_SIZE: number;
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: number;
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR: bigint;
  MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: bigint;
  PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: bigint;
}
