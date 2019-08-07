import {VoluntaryExit} from "@chainsafe/eth2.0-types";

export function generateEmptyVoluntaryExit(): VoluntaryExit {
  return {
    epoch: 0,
    validatorIndex: 0,
    signature: Buffer.alloc(96)
  };
}
