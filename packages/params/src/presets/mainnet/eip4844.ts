import {EIP4844Preset} from "../../interface/eip4844.js";

/* eslint-disable @typescript-eslint/naming-convention */
export const eip4844: EIP4844Preset = {
  // https://github.com/ethereum/consensus-specs/blob/dev/presets/mainnet/eip4844.yaml
  FIELD_ELEMENTS_PER_BLOB: 4096,
  MAX_BLOBS_PER_BLOCK: 16,
};
