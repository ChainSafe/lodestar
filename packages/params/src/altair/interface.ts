/* eslint-disable @typescript-eslint/naming-convention */

export interface IAltairParams {
  SYNC_COMMITTEE_SIZE: number;
  SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE: number;
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: number;
  DOMAIN_SYNC_COMMITTEE: Buffer;
  ALTAIR_FORK_VERSION: Buffer;
  ALTAIR_FORK_SLOT: number;
  HF1_INACTIVITY_PENALTY_QUOTIENT: bigint;
  HF1_MIN_SLASHING_PENALTY_QUOTIENT: number;
  HF1_PROPORTIONAL_SLASHING_MULTIPLIER: number;
}
