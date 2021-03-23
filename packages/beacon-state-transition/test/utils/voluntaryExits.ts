import {phase0} from "@chainsafe/lodestar-types";

export function generateEmptyVoluntaryExit(): phase0.VoluntaryExit {
  return {
    epoch: 0,
    validatorIndex: 0,
  };
}

export function generateEmptySignedVoluntaryExit(): phase0.SignedVoluntaryExit {
  return {
    message: generateEmptyVoluntaryExit(),
    signature: Buffer.alloc(96),
  };
}
