import {VoluntaryExit} from "../../../types";

export function generateEmptyVoluntaryExit(): VoluntaryExit {
  return {
    epoch: 0,
    validatorIndex: 0,
    signature: Buffer.alloc(96)
  };
}
