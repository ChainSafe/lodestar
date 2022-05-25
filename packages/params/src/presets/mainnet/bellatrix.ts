import {BellatrixPreset} from "../../interface/bellatrix.js";

/* eslint-disable @typescript-eslint/naming-convention */
export const bellatrix: BellatrixPreset = {
  INACTIVITY_PENALTY_QUOTIENT_BELLATRIX: 16777216,
  MIN_SLASHING_PENALTY_QUOTIENT_BELLATRIX: 32,
  PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX: 3,

  MAX_BYTES_PER_TRANSACTION: 1073741824,
  MAX_TRANSACTIONS_PER_PAYLOAD: 1048576,
  BYTES_PER_LOGS_BLOOM: 256,
  MAX_EXTRA_DATA_BYTES: 32,
};
