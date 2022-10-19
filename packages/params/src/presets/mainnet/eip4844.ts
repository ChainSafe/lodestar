import {EIP4844Preset} from "../../interface/eip4844.js";

// https://github.com/ethereum/consensus-specs/blob/dev/presets/mainnet/eip4844.yaml

/* eslint-disable @typescript-eslint/naming-convention */
export const eip4844: EIP4844Preset = {
  // `uint64(4096)`
  FIELD_ELEMENTS_PER_BLOB: 4096,
  // `uint64(2**4)` (= 16)
  MAX_BLOBS_PER_BLOCK: 16,
};
