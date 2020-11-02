import {VoluntaryExit, SignedVoluntaryExit} from "@chainsafe/lodestar-types";

export function generateEmptyVoluntaryExit(): VoluntaryExit {
  return {
    epoch: 0,
    validatorIndex: 0,
  };
}

export function generateEmptySignedVoluntaryExit(): SignedVoluntaryExit {
  return {
    message: generateEmptyVoluntaryExit(),
    signature: Buffer.alloc(96),
  };
}
