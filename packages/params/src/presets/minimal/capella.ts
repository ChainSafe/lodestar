import {CapellaPreset} from "../../interface/capella.js";

/* eslint-disable @typescript-eslint/naming-convention */
export const capella: CapellaPreset = {
  MAX_BLS_TO_EXECUTION_CHANGES: 16,
  // Change this to 4 when new spec test vectors are released
  MAX_WITHDRAWALS_PER_PAYLOAD: 4,
};
