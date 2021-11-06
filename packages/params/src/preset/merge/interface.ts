/* eslint-disable @typescript-eslint/naming-convention */

export interface IMergePreset {
  MAX_BYTES_PER_TRANSACTION: number;
  MAX_TRANSACTIONS_PER_PAYLOAD: number;
  BYTES_PER_LOGS_BLOOM: number;
  MAX_EXTRA_DATA_BYTES: number;
}
