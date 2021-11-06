/* eslint-disable @typescript-eslint/naming-convention */
import {IMergePreset} from "../../preset";

export const merge: IMergePreset = {
  MAX_BYTES_PER_TRANSACTION: 1073741824,
  MAX_TRANSACTIONS_PER_PAYLOAD: 1048576,
  BYTES_PER_LOGS_BLOOM: 256,
  MAX_EXTRA_DATA_BYTES: 32,
};
