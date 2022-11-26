import {CapellaPreset} from "../../interface/capella.js";

/* eslint-disable @typescript-eslint/naming-convention */
export const capella: CapellaPreset = {
  // Remove these two when new spec tests vectors are released
  MAX_PARTIAL_WITHDRAWALS_PER_EPOCH: 256,
  WITHDRAWAL_QUEUE_LIMIT: 1099511627776,

  MAX_BLS_TO_EXECUTION_CHANGES: 16,
  MAX_WITHDRAWALS_PER_PAYLOAD: 16,
};
