/* eslint-disable @typescript-eslint/naming-convention */
export type CapellaPreset = {
  // Remove these two when new spec tests are released
  MAX_PARTIAL_WITHDRAWALS_PER_EPOCH: number;
  WITHDRAWAL_QUEUE_LIMIT: number;

  MAX_BLS_TO_EXECUTION_CHANGES: number;
  MAX_WITHDRAWALS_PER_PAYLOAD: number;
};
