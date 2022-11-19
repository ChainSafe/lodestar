import {EIP4844Preset} from "../../interface/eip4844.js";

// https://github.com/ethereum/consensus-specs/blob/dev/presets/minimal/eip4844.yaml

/* eslint-disable @typescript-eslint/naming-convention */
export const eip4844: EIP4844Preset = {
  // `uint64(4096)`
  ////////////////////////////////////////////////////////////////////////
  // TODO EIP-4844: See https://github.com/Inphi/eip4844-interop/issues/65
  // Can't customize this value, but otherwise the interop tests fail
  ////////////////////////////////////////////////////////////////////////
  FIELD_ELEMENTS_PER_BLOB: 4096,
  // `uint64(2**4)` (= 16)
  MAX_BLOBS_PER_BLOCK: 16,
};
