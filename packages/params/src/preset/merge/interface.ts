/* eslint-disable @typescript-eslint/naming-convention */

export interface IMergePreset {
  INACTIVITY_PENALTY_QUOTIENT_MERGE: number;
  MIN_SLASHING_PENALTY_QUOTIENT_MERGE: number;
  PROPORTIONAL_SLASHING_MULTIPLIER_MERGE: number;
  MAX_BYTES_PER_TRANSACTION: number;
  MAX_TRANSACTIONS_PER_PAYLOAD: number;
  BYTES_PER_LOGS_BLOOM: number;
  MAX_EXTRA_DATA_BYTES: number;
}
